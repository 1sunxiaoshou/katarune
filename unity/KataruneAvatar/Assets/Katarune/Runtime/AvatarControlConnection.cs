using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace Katarune.Avatar
{
    public sealed class AvatarControlConnection : MonoBehaviour
    {
        [Serializable] private sealed class Request { public string type; public StreamEvent @event; public string id; public string operation; public string value; public bool allowSpeech = true; public string toolCallId; public string runId; public string dialogueId; public bool speechEnabled; public bool failed; public bool streaming; public bool enabled; public string phase; public string error; public float level; public string text; public AvatarSpeechSegment[] segments; public string profilePath; public int epoch; }
        [Serializable] private sealed class StreamEvent { public string type; public string id; public string delta; public string toolCallId; public string toolName; }
        private sealed class SubtitleBlock { public string Text = ""; public bool Complete; public string RunId; public string Id; public bool SpeechEnabled; public Request Audio; }
        private readonly Dictionary<string, SubtitleBlock> _dialogues = new Dictionary<string, SubtitleBlock>();
        [Serializable] private sealed class DialogueCompleted { public string type = "dialogue-completed"; public string runId; public string dialogueId; }
        private sealed class TimelineItem
        {
            public string Kind;
            public SubtitleBlock Subtitle;
            public string ToolCallId;
            public string ToolName;
            public string RunId;
            public Request Command;
        }
        [Serializable] private sealed class ActionInfo { public string id; public string label; public float durationSeconds; }
        [Serializable] private sealed class Capabilities { public ActionInfo[] actions; public string[] expressions; }
        [Serializable] private sealed class Ready { public string type = "ready"; public Capabilities capabilities; }
        [Serializable] private sealed class StartupError { public string type = "startup-error"; public string error; }
        [Serializable] private sealed class Result { public string type = "result"; public string id; public bool ok; public string error; }
        [Serializable] private sealed class PlaybackEvent { public string type = "playback"; public string runId; public bool active; public string state; }

        [Serializable] private sealed class ActionEvent { public string type = "action"; public string id; public string status; public string error; }
        [Serializable] private sealed class ExpressionEvent { public string type = "expression"; public string id; public string status; public string error; }

        private readonly BlockingCollection<string> _incoming = new BlockingCollection<string>(256);
        private readonly BlockingCollection<string> _outgoing = new BlockingCollection<string>(64);
        private readonly Queue<TimelineItem> _timeline = new Queue<TimelineItem>();
        private readonly Dictionary<string, TimelineItem> _toolNodes = new Dictionary<string, TimelineItem>();
        private readonly Dictionary<string, Request> _commands = new Dictionary<string, Request>();
        private readonly Dictionary<string, SubtitleBlock> _textBlocks = new Dictionary<string, SubtitleBlock>();
        private readonly CancellationTokenSource _lifetime = new CancellationTokenSource();
        private NamedPipeClientStream _pipe;
        private IAvatarRuntimeFacade _runtime;
        private int _epoch;
        private string _subtitleText = "";
        internal string CurrentSubtitle => _subtitleText;
        private AvatarSceneRig _rig;
        private long _presentationRevision = -1;
        private Vector2 _presentationReference;
        private string _lastPresentation;
        private AvatarWindow _window;
        private volatile bool _connected;
        private volatile bool _stopping;
        private bool _timelineRunning;
        private bool _acting;
        private bool _actionStarted;
        private string _lastCapabilities;
        private bool _startupErrorSent;
        private string _activeRunId;
        private string _playingRunId;
        private readonly HashSet<string> _mutedRuns = new HashSet<string>();
        private AvatarSpeechPlayer _speech;
        private bool _userSubtitleActive;
        private GUIStyle _subtitleStyle;
        private Font _subtitleFont;

        [Serializable] private sealed class SpeechEvent { public string type = "speech"; public string runId; public string id; public string status; public string error; }

        [Serializable] private sealed class Presentation {
            public string type = "presentation"; public string modelName; public string modelPath; public bool loading;
            public string affect; public string action; public bool gaze; public bool outline; public string error;
            public float referenceWidth; public float referenceHeight;
        }
        public void Configure(IAvatarRuntimeFacade runtime, string pipeName, AvatarSpeechPlayer speech = null)
        {
            _speech = speech; _runtime = runtime;
            _rig = FindFirstObjectByType<AvatarSceneRig>();
            _window = FindFirstObjectByType<AvatarWindow>();
            if (_window != null) _window.StateChanged += Send;
            _ = Task.Run(() => Connect(pipeName));
        }

        private void Connect(string pipeName)
        {
            try
            {
                using (var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous))
                {
                    _pipe = pipe;
                    pipe.Connect(15000);
                    if (_stopping) return;
                    _connected = true;
                    var writerTask = Task.Run(() => WriteMessages(pipe));
                    using (var reader = new StreamReader(pipe, new UTF8Encoding(false), false, 4096, true))
                    {
                        var line = new StringBuilder();
                        while (!_stopping)
                        {
                            var value = reader.Read();
                            if (value < 0) break;
                            if (value == '\n')
                            {
                                _incoming.Add(line.ToString(), _lifetime.Token); line.Clear();
                            }
                            else { line.Append((char)value); if (line.Length > 64 * 1024 * 1024) throw new IOException("Avatar request too large."); }
                        }
                    }
                    _outgoing.CompleteAdding();
                    pipe.Dispose();
                    writerTask.GetAwaiter().GetResult();
                }
            }
            catch (Exception) { }
            finally { _connected = false; _outgoing.CompleteAdding(); }
        }

        private void WriteMessages(Stream pipe)
        {
            try
            {
                using (var writer = new StreamWriter(pipe, new UTF8Encoding(false), 4096, true) { AutoFlush = true })
                    foreach (var message in _outgoing.GetConsumingEnumerable()) writer.WriteLine(message);
            }
            catch (Exception) { _connected = false; }
        }

        private void Update()
        {
            if (_runtime == null) return;
            if (!_connected)
            {
                if (_lastCapabilities != null)
                {
                    StopAllCoroutines(); _runtime.CancelAction(); _speech?.Stop();
                    _mutedRuns.Clear(); _playingRunId = null;
                    ClearSubtitle();
                    _timeline.Clear(); _toolNodes.Clear(); _commands.Clear(); _textBlocks.Clear(); _dialogues.Clear(); _lastCapabilities = null;
                    _timelineRunning = false; _acting = false; _actionStarted = false;
                }
                return;
            }
            if (!_startupErrorSent && _lastCapabilities == null
                && (_runtime.Snapshot.RuntimeState == AvatarRuntimeState.Error
                    || _runtime.Snapshot.RuntimeState == AvatarRuntimeState.Empty))
            {
                var error = _runtime.Snapshot.RuntimeState == AvatarRuntimeState.Empty
                    ? "未找到默认角色模型，请配置 default-avatar.vrm 后重新连接桌宠。"
                    : _runtime.Snapshot.LastError;
                if (string.IsNullOrWhiteSpace(error)) error = "角色模型加载失败。";
                Send(JsonUtility.ToJson(new StartupError { error = error.Length > 4000 ? error.Substring(0, 4000) : error }));
                _startupErrorSent = true;
            }
            if (_runtime.Snapshot.RuntimeState == AvatarRuntimeState.Ready)
            {
                var caps = new Ready { capabilities = new Capabilities {
                    actions = _runtime.AvailableActions.Select(a => new ActionInfo {
                        id = a.Id, label = a.DisplayName, durationSeconds = a.DurationSeconds
                    }).ToArray(),
                    expressions = Enum.GetValues(typeof(AvatarAffectPreset)).Cast<AvatarAffectPreset>()
                        .Where(p => _runtime.Snapshot.Capabilities.SupportsAffect(p)).Select(p => p.ToString().ToLowerInvariant()).ToArray(),
                } };
                var json = JsonUtility.ToJson(caps);
                if (json != _lastCapabilities) { Send(json); _lastCapabilities = json; }
            }
            var snapshot = _runtime.Snapshot;
            var reference = _rig != null ? _rig.ReferenceWindowSize : new Vector2(0.3f, 0.8f);
            if (snapshot.Revision != _presentationRevision || reference != _presentationReference)
            {
            _presentationRevision = snapshot.Revision; _presentationReference = reference;
            var presentation = JsonUtility.ToJson(new Presentation {
                modelName = snapshot.Model?.Name ?? "", modelPath = snapshot.Model?.Path ?? "",
                loading = snapshot.RuntimeState == AvatarRuntimeState.Loading,
                affect = snapshot.Behavior.Affect.ToString().ToLowerInvariant(), action = snapshot.Motion.CurrentActionId ?? "",
                gaze = snapshot.Behavior.PointerGazeTrackingEnabled, outline = snapshot.Presentation.SoftOutlineEnabled,
                error = snapshot.LastError ?? "", referenceWidth = reference.x, referenceHeight = reference.y,
            });
            if (presentation != _lastPresentation) { Send(presentation); _lastPresentation = presentation; }
            }
            while (_incoming.TryTake(out var line))
            {
                Request request = null;
                try
                {
                    request = JsonUtility.FromJson<Request>(line);
                    if (request?.type == "binding") { _epoch = request.epoch; ClearSubtitle(); continue; }
                    if (request?.type == "window-layout") { _window?.ApplyLayout(request.value); continue; }
                    if (request?.type == "window-input-zones") { _window?.ApplyInputZones(request.value); continue; }
                    if (request?.type == "user-subtitle")
                    {
                        if (_runtime.Snapshot.RuntimeState == AvatarRuntimeState.Ready)
                            ShowUserSubtitle(request.text);
                        continue;
                    }
                    if (request?.type == "event") { ConsumeEvent(request.@event, request.runId, request.speechEnabled); continue; }
                    if (request?.type == "dialogue-audio")
                    {
                        if (_dialogues.TryGetValue(request.runId + ":" + request.dialogueId, out var dialogue)) dialogue.Audio = request;
                        continue;
                    }
                    if (request?.operation == "session-reset")
                    {
                        StopAllCoroutines();
                        if (int.TryParse(request.value, out var epoch)) _epoch = epoch;
                        _speech?.Stop();
                        _runtime.CancelAction();
                        _runtime.ApplyBehavior(_runtime.Snapshot.Behavior.WithAffect(AvatarAffectPreset.Neutral, 0f));
                        _timeline.Clear(); _toolNodes.Clear(); _commands.Clear(); _textBlocks.Clear(); _dialogues.Clear();
                        _mutedRuns.Clear(); _activeRunId = null; _playingRunId = null;
                        _timelineRunning = false; _acting = false; _actionStarted = false;
                        _userSubtitleActive = false;
                        ClearSubtitle();
                        Reply(request); continue;
                    }
                    if (request?.operation == "run-cancel")
                    {
                        if (request.value == _activeRunId)
                        {
                            var drains = _timeline.Where(item => item.Kind == "drain").Select(item => item.Command).ToArray();
                            _timeline.Clear(); _toolNodes.Clear(); _commands.Clear(); _textBlocks.Clear(); _dialogues.Clear();
                            StopAllCoroutines(); _speech?.Stop(); _runtime.CancelAction();
                            if (_playingRunId != null) Send(JsonUtility.ToJson(new PlaybackEvent { runId = _playingRunId, active = false, state = "interrupted" }));
                            _playingRunId = null;
                            _mutedRuns.Remove(request.value);
                            _timelineRunning = false; _acting = false; _actionStarted = false;
                            if (!_userSubtitleActive) ClearSubtitle();
                            _activeRunId = null;
                            foreach (var drain in drains) Reply(drain);
                        }
                        Reply(request); continue;
                    }
                    if (request?.operation == "voice-pause" || request?.operation == "voice-resume")
                    {
                        if (request.value == _playingRunId)
                        {
                            if (request.operation == "voice-pause") { _speech?.Pause(); Send(JsonUtility.ToJson(new PlaybackEvent { runId = request.value, active = true, state = "paused" })); }
                            else { _speech?.Resume(); Send(JsonUtility.ToJson(new PlaybackEvent { runId = request.value, active = true, state = "playing" })); }
                        }
                        continue;
                    }
                    if (request?.operation == "voice-interrupt")
                    {
                        _mutedRuns.Add(request.value);
                        foreach (var dialogue in _dialogues.Values)
                            if (dialogue.RunId == request.value) dialogue.SpeechEnabled = false;
                        if (_playingRunId == request.value) _speech?.Stop();
                        ClearSubtitle();
                        continue;
                    }
                    if (request == null || !Guid.TryParse(request.id, out _) || (request.operation != "drain" && string.IsNullOrWhiteSpace(request.value)))
                        throw new ArgumentException("Invalid avatar request.");
                    if (request.operation == "load-model") { LoadModel(request); continue; }
                    if (_runtime.Snapshot.RuntimeState != AvatarRuntimeState.Ready) throw new InvalidOperationException("角色尚未就绪。");
                    switch (request.operation)
                    {
                        case "desktop-affect":
                            if (!Enum.TryParse<AvatarAffectPreset>(request.value, true, out var affect) || !_runtime.Snapshot.Capabilities.SupportsAffect(affect)) throw new ArgumentException("表情不可用。");
                            _runtime.ApplyBehavior(_runtime.Snapshot.Behavior.WithAffect(affect, 1f)); Reply(request); break;
                        case "desktop-action":
                            _runtime.CancelAction();
                            if (request.value != "none") {
                                var result = _runtime.RequestAction(request.value);
                                if (result.Outcome != AvatarActionRequestOutcome.Started) throw new InvalidOperationException(result.Error ?? "动作不可用。");
                            }
                            Reply(request); break;
                        case "gaze": _runtime.ApplyBehavior(_runtime.Snapshot.Behavior.WithPointerGazeTracking(request.value == "true")); Reply(request); break;
                        case "outline": _runtime.ApplyPresentation(_runtime.Snapshot.Presentation.WithSoftOutline(request.value == "true")); Reply(request); break;
                        case "speech":
                            if (_speech == null) throw new InvalidOperationException("Speech player is unavailable.");
                            StartCoroutine(SpeakManual(request));
                            break;
                        case "speech-stop":
                            _speech?.Stop(request.value);
                            break;
                        case "drain":
                            CompleteText();
                            RejectUnmatchedCommands();
                            _timeline.Enqueue(new TimelineItem { Kind = "drain", Command = request });
                            EnsureTimeline();
                            break;
                        case "action":
                            if (!_runtime.AvailableActions.Any(a => a.Id == request.value)) throw new ArgumentException("动作不可用。");
                            AcceptCommand(request); break;
                        case "expression":
                            if (!Enum.TryParse<AvatarAffectPreset>(request.value, true, out var preset)
                                || !_runtime.Snapshot.Capabilities.SupportsAffect(preset)) throw new ArgumentException("当前模型不支持此表情。");
                            AcceptCommand(request); break;
                        default: throw new ArgumentException("未知角色操作。");
                    }
                }
                catch (Exception error) { if (request != null) Reply(request, error.Message); }
            }
        }

        // Native UIMessageChunk events remain unchanged on the wire. Only public text is dialogue.
        private IEnumerator SpeakManual(Request request)
        {
            var finished = false;
            AvatarSpeechSubtitles.Timeline subtitles = null;
            _speech.Play(request.id, request.value, (id, status, error) => {
                Send(JsonUtility.ToJson(new SpeechEvent { id = id, status = status, error = error }));
                if (status != "started") finished = true;
            }, request.profilePath);
            while (_connected && !finished)
            {
                if (_speech.DurationSeconds > 0) {
                    subtitles ??= new AvatarSpeechSubtitles.Timeline(request.text, request.segments, _speech.DurationSeconds);
                    ShowSubtitle(subtitles.TextAt(_speech.PositionSeconds));
                }
                yield return null;
            }
            if (!_userSubtitleActive) ClearSubtitle();
        }

        private async void LoadModel(Request request)
        {
            try {
                var yaw = _rig?.DesktopYaw ?? 0f; var pitch = _rig?.DesktopPitch ?? 4f;
                var behavior = _runtime.Snapshot.Behavior; var epoch = _epoch;
                var result = await _runtime.LoadAsync(request.value, destroyCancellationToken);
                if (result.Outcome == AvatarLoadOutcome.Loaded) {
                    _rig?.SetDesktopPose(yaw, pitch);
                    _runtime.ApplyBehavior(epoch == _epoch ? behavior : _runtime.Snapshot.Behavior.WithPointerGazeTracking(behavior.PointerGazeTrackingEnabled));
                }
                Reply(request, result.Outcome == AvatarLoadOutcome.Loaded ? null : result.Error ?? "模型加载失败。");
            } catch (Exception error) { Reply(request, error.Message); }
        }

        private void ShowUserSubtitle(string text)
        {
            if (string.IsNullOrWhiteSpace(text) || text.Length > 20000) return;
            PublishSubtitle("你：" + text.Trim(), true);
        }

        private void ShowSubtitle(string text) => PublishSubtitle(text, false);
        private void ClearSubtitle() => PublishSubtitle("", false);
        private void PublishSubtitle(string text, bool user)
        {
            text = string.IsNullOrWhiteSpace(text) ? "" : text;
            if (_subtitleText == text && _userSubtitleActive == user) return;
            _subtitleText = text; _userSubtitleActive = user;
        }
        private void OnGUI()
        {
            if (string.IsNullOrEmpty(_subtitleText)) return;
            var fontSize = Mathf.Clamp(Mathf.RoundToInt(17f * Mathf.Max(1f, Screen.dpi / 96f)), 17, 24);
            if (_subtitleStyle == null || _subtitleStyle.fontSize != fontSize)
            {
                if (_subtitleFont == null)
                    _subtitleFont = Font.CreateDynamicFontFromOSFont(
                        new[] { "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", "Arial" }, fontSize);
                _subtitleStyle = new GUIStyle(GUI.skin.label) {
                    font = _subtitleFont, fontSize = fontSize, wordWrap = true,
                    richText = false, alignment = TextAnchor.MiddleCenter,
                    padding = new RectOffset(12, 12, 8, 8),
                };
            }
            _subtitleStyle.normal.textColor = _userSubtitleActive
                ? new Color(.12f, .18f, .25f) : Color.white;
            var width = Mathf.Max(60f, Mathf.Min(440f, Screen.width - 12f));
            var height = Mathf.Min(
                _subtitleStyle.CalcHeight(new GUIContent(_subtitleText), width),
                Screen.height * .55f);
            var bounds = new Rect((Screen.width - width) * .5f,
                Mathf.Max(6f, Screen.height - height - 12f), width, height);
            GUI.DrawTexture(bounds, Texture2D.whiteTexture, ScaleMode.StretchToFill, true,
                0f, _userSubtitleActive ? new Color(.92f, .96f, 1f, .94f)
                    : new Color(.11f, .10f, .14f, .92f), 0f, 14f);
            GUI.Label(bounds, _subtitleText, _subtitleStyle);
        }

        private void ConsumeEvent(StreamEvent chunk, string runId = null, bool speechEnabled = false)
        {
            if (chunk == null) return;
            if (!string.IsNullOrEmpty(runId)) _activeRunId = runId;
            switch (chunk.type)
            {
                case "text-start":
                    if (string.IsNullOrEmpty(chunk.id) || _textBlocks.ContainsKey(chunk.id)) return;
                    var block = new SubtitleBlock { RunId = runId, Id = chunk.id, SpeechEnabled = speechEnabled };
                    _dialogues[runId + ":" + chunk.id] = block;
                    _textBlocks.Add(chunk.id, block);
                    _timeline.Enqueue(new TimelineItem { Kind = "dialogue", Subtitle = block });
                    EnsureTimeline();
                    break;
                case "text-delta":
                    if (chunk.id != null && _textBlocks.TryGetValue(chunk.id, out var current)) current.Text += chunk.delta;
                    break;
                case "text-end":
                    if (chunk.id != null && _textBlocks.TryGetValue(chunk.id, out var ended))
                    { ended.Complete = true; _textBlocks.Remove(chunk.id); }
                    break;
                case "tool-input-available":
                    if ((chunk.toolName != "avatar_action" && chunk.toolName != "set_expression")
                        || string.IsNullOrWhiteSpace(chunk.toolCallId) || _toolNodes.ContainsKey(chunk.toolCallId)) return;
                    var item = new TimelineItem { Kind = "tool", ToolCallId = chunk.toolCallId, ToolName = chunk.toolName, RunId = runId };
                    if (_commands.TryGetValue(chunk.toolCallId, out var command))
                    {
                        _commands.Remove(chunk.toolCallId);
                        if (MatchesTool(item, command)) item.Command = command;
                        else
                        {
                            item.Kind = "skip";
                            ReportInstructionFailure(command, "工具事件与执行请求不匹配。");
                        }
                    }
                    else _toolNodes.Add(chunk.toolCallId, item);
                    _timeline.Enqueue(item);
                    EnsureTimeline();
                    break;
                case "finish-step": case "finish": case "error": case "abort": CompleteText(); break;
            }
        }

        private void AcceptCommand(Request request)
        {
            if (string.IsNullOrWhiteSpace(request.toolCallId)) throw new ArgumentException("工具调用缺少 toolCallId。");
            if (_commands.Count + _toolNodes.Count >= 32) throw new ArgumentException("角色编排队列已满。");
            if (_commands.ContainsKey(request.toolCallId)) throw new ArgumentException("重复的工具调用。");
            if (_toolNodes.TryGetValue(request.toolCallId, out var item))
            {
                if (item.Command != null) throw new ArgumentException("重复的工具调用。");
                if (!MatchesTool(item, request))
                {
                    item.Kind = "skip";
                    _toolNodes.Remove(request.toolCallId);
                    EnsureTimeline();
                    throw new ArgumentException("工具事件与执行请求不匹配。");
                }
                item.Command = request;
                _toolNodes.Remove(request.toolCallId);
            }
            else _commands.Add(request.toolCallId, request);
            Reply(request);
            EnsureTimeline();
        }

        private static bool MatchesTool(TimelineItem item, Request request) =>
            (item.ToolName == "avatar_action" && request.operation == "action")
            || (item.ToolName == "set_expression" && request.operation == "expression");

        private void ReportInstructionFailure(Request request, string error)
        {
            if (request.operation == "action") ReportAction(request, "failed", error);
            else ReportExpression(request, "failed", error);
        }

        private void RejectUnmatchedCommands()
        {
            foreach (var command in _commands.Values)
                ReportInstructionFailure(command, "未收到对应的时间线事件。");
            _commands.Clear();
            foreach (var item in _toolNodes.Values) item.Kind = "skip";
            _toolNodes.Clear();
        }

        private void EnsureTimeline()
        {
            if (_timelineRunning || _timeline.Count == 0) return;
            StartCoroutine(RunTimeline());
        }

        private void CompleteText()
        {
            foreach (var block in _textBlocks.Values) block.Complete = true;
            _textBlocks.Clear();
        }

        private IEnumerator Speak(SubtitleBlock block)
        {
            var consumed = 0;
            while (!_mutedRuns.Contains(block.RunId))
            {
                var page = AvatarSpeechSubtitles.ReadPage(block.Text.Substring(consumed), block.Complete, out var length, out var ready);
                if (page.Length == 0)
                {
                    if (block.Complete) break;
                    yield return null; continue;
                }
                ShowSubtitle(page);
                if (!ready) { yield return null; continue; }
                var remaining = Mathf.Clamp(new StringInfo(page).LengthInTextElements / 9f + 0.5f, 1.4f, 7f);
                while (remaining > 0f && !_mutedRuns.Contains(block.RunId))
                {
                    yield return null;
                    remaining -= Time.unscaledDeltaTime;
                }
                consumed += length;
            }
            if (!_userSubtitleActive) ClearSubtitle();
        }

        private IEnumerator RunTimeline()
        {
            _timelineRunning = true;
            try
            {
                while (_connected && _timeline.Count > 0)
                {
                    var item = _timeline.Peek();
                    if (item.Kind == "dialogue")
                    {
                        var block = item.Subtitle;
                        if (block.SpeechEnabled && !_mutedRuns.Contains(block.RunId))
                        {
                            while (_connected && block.Audio == null && block.SpeechEnabled && !_mutedRuns.Contains(block.RunId)) yield return null;
                            if (!_connected) yield break;
                        }
                        if (!_mutedRuns.Contains(block.RunId) && block.Audio != null && !block.Audio.failed && _speech != null)
                        {
                            var finished = false;
                            var failed = false;
                            var started = false;
                            var liveSubtitles = new AvatarSpeechSubtitles.StreamingTimeline(block.Audio.text);
                            AvatarSpeechSubtitles.Timeline subtitles = null;
                            try {
                                _speech.Play(Guid.NewGuid().ToString(), block.Audio.value, (id, status, error) => {
                                    Send(JsonUtility.ToJson(new SpeechEvent { id = id, runId = block.RunId, status = status, error = error }));
                                    if (status == "started") { started = true; _playingRunId = block.RunId; Send(JsonUtility.ToJson(new PlaybackEvent { runId = block.RunId, active = true, state = "playing" })); }
                                    if (status != "started") { finished = true; failed = status == "failed"; }
                                }, block.Audio.profilePath, block.Audio.streaming);
                            } catch { finished = true; failed = true; }
                            while (_connected && !finished)
                            {
                                if (_speech.IsStreaming) {
                                    if (started) ShowSubtitle(liveSubtitles.TextAt(_speech.PositionSeconds, _speech.StreamSegments, _speech.DurationSeconds));
                                }
                                else if (_speech.DurationSeconds > 0) {
                                    subtitles ??= new AvatarSpeechSubtitles.Timeline(block.Audio.text, block.Audio.segments, _speech.DurationSeconds);
                                    ShowSubtitle(subtitles.TextAt(_speech.PositionSeconds));
                                }
                                yield return null;
                            }
                            if (!_userSubtitleActive) ClearSubtitle();
                            if (_playingRunId == block.RunId) { _playingRunId = null; Send(JsonUtility.ToJson(new PlaybackEvent { runId = block.RunId, active = false, state = _mutedRuns.Contains(block.RunId) ? "interrupted" : "completed" })); }
                            if (failed && !started) yield return Speak(block);
                        }
                        else if (!_mutedRuns.Contains(block.RunId)) yield return Speak(block);
                        _dialogues.Remove(block.RunId + ":" + block.Id);
                        if (!string.IsNullOrEmpty(block.RunId)) Send(JsonUtility.ToJson(new DialogueCompleted {
                            runId = block.RunId, dialogueId = block.Id,
                        }));
                    }
                    else if (item.Kind == "tool")
                    {
                        if (_mutedRuns.Contains(item.RunId)) { _timeline.Dequeue(); continue; }
                        while (_connected && item.Command == null) yield return null;
                        if (!_connected) yield break;
                        if (item.Command.operation == "expression") ApplyExpression(item.Command);
                        else
                        {
                            while (_connected && _acting) yield return null;
                            if (!_connected) yield break;
                            _acting = true;
                            _actionStarted = false;
                            StartCoroutine(Act(item.Command));
                            while (_connected && _acting && !_actionStarted) yield return null;
                            if (!item.Command.allowSpeech)
                                while (_connected && _acting) yield return null;
                        }
                    }
                    else if (item.Kind == "drain")
                    {
                        while (_connected && _acting) yield return null;
                        if (_connected) Reply(item.Command);
                        _mutedRuns.Remove(item.Command.value);
                    }
                    _timeline.Dequeue();
                }
            }
            finally
            {
                _timelineRunning = false;
                if (_connected && _timeline.Count > 0) EnsureTimeline();
            }
        }

        private void ApplyExpression(Request request)
        {
            try
            {
                if (_runtime.Snapshot.RuntimeState != AvatarRuntimeState.Ready) throw new InvalidOperationException("角色尚未就绪。");
                if (!Enum.TryParse<AvatarAffectPreset>(request.value, true, out var preset)
                    || !_runtime.Snapshot.Capabilities.SupportsAffect(preset)) throw new ArgumentException("当前模型不支持此表情。");
                _runtime.ApplyBehavior(_runtime.Snapshot.Behavior.WithAffect(preset, 1f));
                ReportExpression(request, "applied");
            }
            catch (Exception error) { ReportExpression(request, "failed", error.Message); }
        }

        private IEnumerator Act(Request request)
        {
            try
            {
                while (_runtime.Snapshot.RuntimeState == AvatarRuntimeState.Ready
                    && _runtime.Snapshot.Motion.CurrentActionId != null) yield return null;
                if (_runtime.Snapshot.RuntimeState != AvatarRuntimeState.Ready)
                { _actionStarted = true; ReportAction(request, "failed", "角色尚未就绪。"); yield break; }
                var result = _runtime.RequestAction(request.value);
                if (result.Outcome != AvatarActionRequestOutcome.Started)
                { _actionStarted = true; ReportAction(request, "failed", result.Error ?? "动作不可用。"); yield break; }
                ReportAction(request, "started");
                _actionStarted = true;
                var sequence = _runtime.Snapshot.Motion.ActionSequence;
                while (_runtime.Snapshot.RuntimeState == AvatarRuntimeState.Ready
                    && _runtime.Snapshot.Motion.ActionSequence == sequence
                    && _runtime.Snapshot.Motion.CurrentActionId == request.value) yield return null;
                var changed = _runtime.Snapshot.RuntimeState != AvatarRuntimeState.Ready
                    || _runtime.Snapshot.Motion.ActionSequence != sequence;
                ReportAction(request, changed ? "cancelled" : "completed", changed ? "动作被模型切换或手动操作中止。" : null);
            }
            finally { _actionStarted = true; _acting = false; }
        }

        private void ReportAction(Request request, string status, string error = null) =>
            Send(JsonUtility.ToJson(new ActionEvent { id = request.id, status = status, error = error ?? "" }));

        private void ReportExpression(Request request, string status, string error = null) =>
            Send(JsonUtility.ToJson(new ExpressionEvent { id = request.id, status = status, error = error ?? "" }));

        private void Reply(Request request, string error = null) => Send(JsonUtility.ToJson(new Result { id = request.id, ok = error == null, error = error ?? "" }));
        private void Send(string json) { if (!_stopping && !_outgoing.IsAddingCompleted) _outgoing.TryAdd(json); }
        private void OnDestroy()
        {
            if (_subtitleFont != null) Destroy(_subtitleFont);
            if (_window != null) _window.StateChanged -= Send;
            _stopping = true; _connected = false;
            _lifetime.Cancel(); _outgoing.CompleteAdding(); _pipe?.Dispose();
        }
    }
}
