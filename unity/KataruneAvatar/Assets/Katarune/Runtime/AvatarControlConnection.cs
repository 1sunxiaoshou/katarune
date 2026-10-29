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
        [Serializable] private sealed class Request { public string type; public StreamEvent @event; public string id; public string operation; public string value; public bool allowSpeech = true; public string toolCallId; public string instanceId; public string runId; public string dialogueId; public bool speechEnabled; public bool failed; public bool streaming; public bool enabled; public string phase; public string error; public float level; public string text; public AvatarSpeechSegment[] segments; public string profilePath; public int epoch; }
        [Serializable] private sealed class StreamEvent { public string type; public string id; public string delta; public string toolCallId; public string toolName; }
        private sealed class SubtitleBlock { public string Text = ""; public bool Complete; public string RunId; public string Id; public bool SpeechEnabled; public bool ChatOnly; public Request Audio; public string SpokenText; }
        private readonly Dictionary<string, SubtitleBlock> _dialogues = new Dictionary<string, SubtitleBlock>();
        [Serializable] private sealed class DialogueCompleted { public string type = "dialogue-completed"; public string runId; public string dialogueId; }
        [Serializable] private sealed class DialogueDelivery { public string type = "dialogue-delivery"; public string runId; public string dialogueId; public string delivery; }
        private sealed class TimelineItem
        {
            public string Kind;
            public SubtitleBlock Subtitle;
            public string ToolCallId;
            public string ToolName;
            public string RunId;
            public Request Command;
        }
        [Serializable] private sealed class ActionInfo { public string id; public string label; public string description; public float durationSeconds; public string kind; public string key; public string semantic; public string layer; public bool idle; }
        [Serializable] private sealed class Capabilities { public ActionInfo[] actions; public string[] expressions; }
        [Serializable] private sealed class Ready { public string type = "ready"; public Capabilities capabilities; }
        [Serializable] private sealed class StartupError { public string type = "startup-error"; public string error; }
        [Serializable] private sealed class Result { public string type = "result"; public string id; public bool ok; public string error; }
        [Serializable] private sealed class PlaybackEvent { public string type = "playback"; public string runId; public bool active; public string state; }
        [Serializable] private sealed class DanceEvent { public string type = "dance"; public string id; public string actionId; public string status; public string error; }

        [Serializable] private sealed class ActionEvent { public string type = "action"; public string id; public string status; public string error; public string instanceId; public bool loop; }
        [Serializable] private sealed class ExpressionEvent { public string type = "expression"; public string id; public string status; public string error; }

        private readonly BlockingCollection<string> _incoming = new BlockingCollection<string>(256);
        private readonly BlockingCollection<string> _outgoing = new BlockingCollection<string>(64);
        [Serializable] private sealed class PerformanceEvent { public string type = "performance"; public AvatarPerformanceStatus performance; }
        private readonly Dictionary<string, AvatarPerformance> _performances = new();
        private readonly Queue<TimelineItem> _timeline = new Queue<TimelineItem>();
        private readonly Dictionary<string, TimelineItem> _toolNodes = new Dictionary<string, TimelineItem>();
        private readonly Dictionary<string, Request> _commands = new Dictionary<string, Request>();
        private readonly Dictionary<string, SubtitleBlock> _textBlocks = new Dictionary<string, SubtitleBlock>();
        private readonly CancellationTokenSource _lifetime = new CancellationTokenSource();
        private NamedPipeClientStream _pipe;
        private IAvatarRuntimeFacade _runtime;
        private int _epoch;
        private string _subtitleText = "";
        internal string CurrentSubtitle => _dance?.Active == true ? _dance.SubtitleText : _subtitleText;
        internal bool ShowingDanceSubtitle => _dance?.Active == true;
        internal Color CurrentSubtitleColor => ShowingDanceSubtitle ? new Color(1f, 143f / 255f, 179f / 255f)
            : _userSubtitleActive ? new Color(.12f, .18f, .25f) : Color.white;
        internal Color CurrentSubtitleBackground => _userSubtitleActive ? new Color(.92f,.96f,1f,.94f) : new Color(.11f,.10f,.14f,.92f);
        private AvatarSceneRig _rig;
        private long _presentationRevision = -1;
        private Vector2 _presentationReference;
        private string _lastPresentation;
        private AvatarWindow _window;
        private volatile bool _connected;
        private volatile bool _stopping;
        private CancellationTokenSource _packageCancellation;
        private readonly Dictionary<string, CancellationTokenSource> _validations = new();
        private bool _timelineRunning;
        private readonly Dictionary<string, string> _blockingActions = new(StringComparer.Ordinal);
        private readonly Dictionary<string, Request> _runningActions = new(StringComparer.Ordinal);
        private readonly HashSet<string> _pendingActions = new(StringComparer.Ordinal);
        private string _lastCapabilities;
        private bool _startupErrorSent;
        private string _activeRunId;
        private string _playingRunId;
        private readonly HashSet<string> _mutedRuns = new HashSet<string>();
        private AvatarSpeechPlayer _speech;
        private AvatarDancePlayer _dance;
        private AvatarLiveOutput _liveOutput;
        // This connection is the presentation coordinator. Players retain their own clocks.
        private Request _danceRequest;
        private readonly HashSet<string> _endedDances = new();
        private readonly HashSet<string> _chatOnlyRuns = new();
        private bool _manualSpeech;
        private bool _userSubtitleActive;
        private GUIStyle _subtitleStyle;
        private Font _subtitleFont;
        private float _subtitleScale;

        [Serializable] private sealed class SpeechEvent { public string type = "speech"; public string runId; public string id; public string status; public string error; }

        [Serializable] private sealed class Presentation {
            public string type = "presentation"; public string modelName; public string modelPath; public bool loading;
            public string affect; public string action; public string[] playingActions; public bool gaze; public bool outline; public string error;
            public float referenceWidth; public float referenceHeight;
        }
        public void Configure(IAvatarRuntimeFacade runtime, string pipeName, AvatarSpeechPlayer speech = null)
        {
            AvatarDiagnostics.Sender = json => !_stopping && _connected && !_outgoing.IsAddingCompleted && _outgoing.TryAdd(json);
            _speech = speech; _runtime = runtime;
            _rig = FindFirstObjectByType<AvatarSceneRig>();
            _dance = gameObject.AddComponent<AvatarDancePlayer>();
            _dance.Configure(runtime, _rig);
            _liveOutput = gameObject.AddComponent<AvatarLiveOutput>();
            _liveOutput.Configure(this, _speech, _dance);
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
            foreach (var performance in _performances.Values.ToArray()) performance.Tick();
            if (!_connected)
            {
                if (_lastCapabilities != null)
                {
                    CancelDance("连接已断开。");
                    ClearPerformances();
                    StopAllCoroutines(); _runtime.CancelAction(); _speech?.Stop();
                    _mutedRuns.Clear(); _playingRunId = null;
                    ClearSubtitle();
                    _timeline.Clear(); _toolNodes.Clear(); _commands.Clear(); _textBlocks.Clear(); _dialogues.Clear(); _lastCapabilities = null;
                    _timelineRunning = false; _blockingActions.Clear(); _pendingActions.Clear(); _runningActions.Clear();
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
            if (_runtime.Snapshot.RuntimeState == AvatarRuntimeState.Ready) SendCapabilities();
            var snapshot = _runtime.Snapshot;
            var reference = _rig != null ? _rig.ReferenceWindowSize : new Vector2(0.3f, 0.8f);
            if (snapshot.Revision != _presentationRevision || reference != _presentationReference)
            {
            _presentationRevision = snapshot.Revision; _presentationReference = reference;
            var presentation = JsonUtility.ToJson(new Presentation {
                modelName = snapshot.Model?.Name ?? "", modelPath = snapshot.Model?.Path ?? "",
                loading = snapshot.RuntimeState == AvatarRuntimeState.Loading,
                affect = snapshot.Behavior.Affect.ToString().ToLowerInvariant(), action = snapshot.Motion.CurrentActionId ?? "",
                playingActions = PlayingActions(snapshot.Motion.CurrentActionId),
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
                    if (request?.operation == "live-start") { _liveOutput.Begin(request.value); Reply(request); continue; }
                    if (request?.operation == "live-update") { _liveOutput.UpdateSettings(request.value); Reply(request); continue; }
                    if (request?.operation == "live-stop") { _liveOutput.End(); Reply(request); continue; }
                    if (request?.type == "binding") { _epoch = request.epoch; ClearSubtitle(); continue; }
                    if (request?.type == "window-layout") { _window?.ApplyLayout(request.value); continue; }
                    if (request?.type == "window-input-zones") { _window?.ApplyInputZones(request.value); continue; }
                    if (request?.type == "run-start") {
                        if (_danceRequest != null && _danceRequest.runId != request.runId) _chatOnlyRuns.Add(request.runId);
                        continue;
                    }
                    if (request?.type == "user-subtitle")
                    {
                        if (_runtime.Snapshot.RuntimeState == AvatarRuntimeState.Ready)
                            ShowUserSubtitle(request.text);
                        continue;
                    }
                    if (request?.type == "event") { ConsumeEvent(request.@event, request.runId, request.speechEnabled); continue; }
                    if (request?.type == "dialogue-text")
                    {
                        if (_dialogues.TryGetValue(request.runId + ":" + request.dialogueId, out var text)) text.SpokenText = request.text ?? "";
                        continue;
                    }
                    if (request?.type == "dialogue-audio")
                    {
                        if (_dialogues.TryGetValue(request.runId + ":" + request.dialogueId, out var dialogue)) dialogue.Audio = request;
                        continue;
                    }
                    if (request?.operation == "cancel-validation") {
                        if (_validations.TryGetValue(request.value, out var validation)) validation.Cancel();
                        continue;
                    }
                    if (request?.operation == "session-reset")
                    {
                        CancelDance("会话已切换。");
                        _packageCancellation?.Cancel();
                        ClearPerformances();
                        StopAllCoroutines();
                        if (int.TryParse(request.value, out var epoch)) _epoch = epoch;
                        _speech?.Stop();
                        _runtime.CancelAction();
                        _runtime.ApplyBehavior(_runtime.Snapshot.Behavior.WithAffect(AvatarAffectPreset.Neutral, 0f));
                        _timeline.Clear(); _toolNodes.Clear(); _commands.Clear(); _textBlocks.Clear(); _dialogues.Clear();
                        _mutedRuns.Clear(); _chatOnlyRuns.Clear(); _endedDances.Clear(); _activeRunId = null; _playingRunId = null; _manualSpeech = false;
                        _timelineRunning = false; _blockingActions.Clear(); _pendingActions.Clear(); _runningActions.Clear();
                        _userSubtitleActive = false;
                        ClearSubtitle();
                        Reply(request); continue;
                    }
                    if (request?.operation == "run-cancel")
                    {
                        CancelRun(request.value);
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
                        CancelRun(request.value);
                        foreach (var dialogue in _dialogues.Values)
                            if (dialogue.RunId == request.value) dialogue.SpeechEnabled = false;
                        if (_playingRunId == request.value) _speech?.Stop();
                        ClearSubtitle();
                        continue;
                    }
                    if (request == null || !Guid.TryParse(request.id, out _) || (request.operation != "drain" && string.IsNullOrWhiteSpace(request.value)))
                        throw new ArgumentException("Invalid avatar request.");
                    if (request.operation == "load-model" || request.operation == "load-package") { LoadModel(request); continue; }
                    if (request.operation == "validate-package") { ValidatePackage(request); continue; }
                    if (_runtime.Snapshot.RuntimeState != AvatarRuntimeState.Ready) throw new InvalidOperationException("角色尚未就绪。");
                    switch (request.operation)
                    {
                        case "dance": StartDance(request); break;
                        case "desktop-affect":
                            if (!Enum.TryParse<AvatarAffectPreset>(request.value, true, out var affect) || !_runtime.Snapshot.Capabilities.SupportsAffect(affect)) throw new ArgumentException("表情不可用。");
                            _runtime.ApplyBehavior(_runtime.Snapshot.Behavior.WithAffect(affect, 1f)); Reply(request); break;
                        case "desktop-action-stop":
                            if (!_runtime.AvailableActions.Any(a => a.Id == request.value)) throw new ArgumentException("动作不可用。");
                            if (_danceRequest?.value == request.value) CancelDance("舞蹈已停止。");
                            else if (_runtime is IAvatarActionControl stopControl) {
                                var action = _runtime.AvailableActions.First(a => a.Id == request.value);
                                if (action.Kind == "loop") stopControl.FinishAction(request.value);
                                else stopControl.CancelAction(request.value);
                            }
                            Reply(request); break;
                        case "desktop-action":
                            if (request.value != "none" && !_runtime.AvailableActions.Any(a => a.Id == request.value)) throw new ArgumentException("动作不可用。");
                            CancelDance(request.value == "none" ? "舞蹈已停止。" : "已切换动作，舞蹈已中止。");
                            if (request.value != "none" && _runtime.AvailableActions.Any(a => a.Id == request.value && a.IsDance)) { StartDance(request); break; }
                            if (request.value == "none") {
                                if (_runtime is IAvatarActionControl control) {
                                    // Release temporary gestures first, then naturally exit the
                                    // restored loops. Other action selections keep independent lanes.
                                    foreach (var action in _runtime.AvailableActions.Where(a => a.Kind != "loop"))
                                        if (control.GetActionInstanceId(action.Id) != null) control.CancelAction(action.Id);
                                    foreach (var action in _runtime.AvailableActions.Where(a => a.Kind == "loop"))
                                        if (control.GetActionInstanceId(action.Id) != null) control.FinishAction(action.Id);
                                } else _runtime.CancelAction();
                            } else {
                                RequireNoDance();
                                var result = _runtime.RequestAction(request.value);
                                if (result.Outcome != AvatarActionRequestOutcome.Started) throw new InvalidOperationException(result.Error ?? "动作不可用。");
                            }
                            Reply(request); break;
                        case "gaze": _runtime.ApplyBehavior(_runtime.Snapshot.Behavior.WithPointerGazeTracking(request.value == "true")); Reply(request); break;
                        case "outline": _runtime.ApplyPresentation(_runtime.Snapshot.Presentation.WithSoftOutline(request.value == "true")); Reply(request); break;
                        case "speech":
                            RequireNoDance();
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
                        case "dance-cancel":
                            if (_danceRequest?.id != request.value && !_endedDances.Contains(request.value)) throw new ArgumentException("该舞蹈不属于当前会话或已经释放。");
                            if (_danceRequest?.id == request.value) CancelDance("舞蹈已停止。");
                            if (string.IsNullOrEmpty(request.toolCallId)) Reply(request);
                            else AcceptCommand(request);
                            break;
                        case "performance":
                            RequireNoDance();
                            AcceptCommand(request); break;
                        case "performance-finish":
                        case "performance-cancel":
                            AcceptCommand(request); break;
                        case "action":
                        case "action-finish":
                        case "action-cancel":
                            RequireNoDance();
                            if (!_runtime.AvailableActions.Any(a => a.Id == request.value)) throw new ArgumentException("动作不可用。");
                            if (_runtime.AvailableActions.Any(a => a.Id == request.value && a.IsDance)) throw new ArgumentException("舞蹈需要独立播放。");
                            if (request.operation == "action" && !request.allowSpeech && _runtime.AvailableActions.Any(a => a.Id == request.value && a.Kind == "loop")) throw new ArgumentException("持续姿态需要允许同时说话。");
                            AcceptCommand(request); break;
                        case "expression":
                            RequireNoDance();
                            if (!Enum.TryParse<AvatarAffectPreset>(request.value, true, out var preset)
                                || !_runtime.Snapshot.Capabilities.SupportsAffect(preset)) throw new ArgumentException("当前模型不支持此表情。");
                            AcceptCommand(request); break;
                        default: throw new ArgumentException("未知角色操作。");
                    }
                }
                catch (Exception error) {
                    if (request == null) continue;
                    if (!string.IsNullOrEmpty(request.toolCallId) && _toolNodes.TryGetValue(request.toolCallId, out var rejected)) {
                        rejected.Kind = "skip"; _toolNodes.Remove(request.toolCallId); EnsureTimeline();
                    }
                    Reply(request, error.Message);
                }
            }
        }

        private void SendCapabilities(bool force = false)
        {
                var caps = new Ready { capabilities = new Capabilities {
                    actions = _runtime.AvailableActions.Select(a => new ActionInfo {
                        id = a.Id, label = a.DisplayName, description = a.Description, durationSeconds = a.DurationSeconds, kind = a.Kind, key = a.Key, semantic = a.Semantic, layer = a.Layer, idle = a.IsIdle
                    }).ToArray(),
                    expressions = Enum.GetValues(typeof(AvatarAffectPreset)).Cast<AvatarAffectPreset>()
                        .Where(p => _runtime.Snapshot.Capabilities.SupportsAffect(p)).Select(p => p.ToString().ToLowerInvariant()).ToArray(),
                } };
                var json = JsonUtility.ToJson(caps);
                if (force || json != _lastCapabilities) { Send(json); _lastCapabilities = json; }
        }

        private string[] PlayingActions(string primaryAction)
        {
            if (_runtime.AvailableActions.Any(action => action.Id == primaryAction && action.IsDance)) return new[] { primaryAction };
            if (_runtime is not IAvatarActionControl control) return string.IsNullOrEmpty(primaryAction) ? Array.Empty<string>() : new[] { primaryAction };
            var playing = _runtime.AvailableActions.Where(action => {
                var state = control.GetActionState(control.GetActionInstanceId(action.Id));
                return state == PerformanceInstanceState.Running || state == PerformanceInstanceState.Exiting;
            }).Select(action => action.Id).ToArray();
            return playing.Length == 0 && !string.IsNullOrEmpty(primaryAction) ? new[] { primaryAction } : playing;
        }

        private void RequireNoDance()
        {
            if (_danceRequest != null || _dance?.Active == true) throw new InvalidOperationException("舞蹈已安排或正在播放，请等待结束或明确停止演出。");
        }

        private void StartDance(Request request)
        {
            RequireNoDance();
            if (_pendingActions.Count > 0
                || _commands.Values.Any(value => value.operation == "action")
                || _timeline.Any(value => value.Command?.operation == "action"))
                throw new InvalidOperationException("存在尚未绑定对白的动作安排，不能同时安排完整演出。");
            if (!_runtime.AvailableActions.Any(action => action.Id == request.value && action.IsDance)) throw new ArgumentException("当前角色没有该舞蹈。");
            _danceRequest = request;
            ReportDance(request, "accepted");
            if (string.IsNullOrEmpty(request.toolCallId)) {
                // Manual entry uses the same queue; only a currently playing introduction may finish.
                foreach (var item in _timeline.Skip(_timelineRunning ? 1 : 0))
                    if (item.Subtitle != null) item.Subtitle.ChatOnly = true;
                _timeline.Enqueue(new TimelineItem { Kind = "dance", Command = request });
                Reply(request); EnsureTimeline();
            } else {
                try { AcceptCommand(request); }
                catch { EndDance(request, "failed", "未能安排舞蹈。"); throw; }
            }
        }

        private void ReportDance(Request request, string status, string error = null) =>
            Send(JsonUtility.ToJson(new DanceEvent { id = request.id, actionId = request.value, status = status, error = error ?? "" }));
        private void EndDance(Request request, string status, string error)
        {
            if (_danceRequest?.id != request.id) return;
            _danceRequest = null;
            if (_endedDances.Count >= 64) _endedDances.Remove(_endedDances.First());
            _endedDances.Add(request.id);
            ClearSubtitle();
            ReportDance(request, status, status == "failed" ? error : null);
        }
        private void CancelDance(string reason)
        {
            var request = _danceRequest;
            if (request == null) { _dance?.Cancel(reason); return; }
            if (_dance?.Active == true) _dance.Cancel(reason);
            else EndDance(request, "cancelled", null);
        }
        private IEnumerator PlayDance(Request request)
        {
            if (_performances.Values.Any(value => !value.Terminal && value.DialogueId == null)) {
                EndDance(request, "failed", "存在尚未绑定对白的动作安排，不能同时开始完整演出。"); yield break;
            }
            while (_connected && _danceRequest == request && (_manualSpeech || _performances.Values.Any(value => !value.Terminal) || _runningActions.Count > 0)) yield return null;
            if (!_connected || _danceRequest != request) yield break;
            ClearSubtitle();
            ReportDance(request, "preparing");
            try {
                _dance.Play(request.value, (status, error) => {
                    if (status == "started") ReportDance(request, status);
                    else EndDance(request, status, error);
                });
            } catch (Exception error) { EndDance(request, "failed", error.Message); }
            // Only startup ordering is queued. The independent performance owns its remaining lifetime.
        }

        private void RouteAfterDance(TimelineItem marker)
        {
            if (string.IsNullOrEmpty(marker.RunId)) return;
            _chatOnlyRuns.Add(marker.RunId);
            var after = false;
            foreach (var item in _timeline) {
                if (item == marker) after = true;
                else if (after && item.Subtitle?.RunId == marker.RunId) item.Subtitle.ChatOnly = true;
            }
        }

        // Native UIMessageChunk events remain unchanged on the wire. Only public text is dialogue.
        private IEnumerator SpeakManual(Request request)
        {
            _manualSpeech = true;
            try {
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
            } finally { _manualSpeech = false; }
        }

        private async void LoadModel(Request request)
        {
            CancelDance("角色模型已切换。");
            var cancellation = CancellationTokenSource.CreateLinkedTokenSource(destroyCancellationToken);
            cancellation.CancelAfter(TimeSpan.FromSeconds(110));
            _packageCancellation?.Cancel(); _packageCancellation = cancellation;
            try {
                var yaw = _rig?.DesktopYaw ?? 0f; var pitch = _rig?.DesktopPitch ?? 4f;
                var behavior = _runtime.Snapshot.Behavior; var epoch = _epoch;
                var result = request.operation == "load-package"
                    ? await ((_runtime as IAvatarPackageRuntime) ?? throw new InvalidOperationException("Package runtime unavailable.")).LoadPackageAsync(JsonUtility.FromJson<AvatarCharacterPackage>(request.value), cancellation.Token)
                    : await _runtime.LoadAsync(request.value, cancellation.Token);
                if (result.Outcome == AvatarLoadOutcome.Loaded) {
                    _rig?.SetDesktopPose(yaw, pitch);
                    SendCapabilities(force: true);
                    _runtime.ApplyBehavior(epoch == _epoch ? behavior : _runtime.Snapshot.Behavior.WithPointerGazeTracking(behavior.PointerGazeTrackingEnabled));
                }
                Reply(request, result.Outcome == AvatarLoadOutcome.Loaded ? null : result.Error ?? "模型加载失败。");
            } catch (Exception error) { Reply(request, error.Message); }
            finally { if (ReferenceEquals(_packageCancellation, cancellation)) _packageCancellation = null; cancellation.Dispose(); }
        }

        private async void ValidatePackage(Request request)
        {
            using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(destroyCancellationToken);
            cancellation.CancelAfter(TimeSpan.FromSeconds(110));
            _validations.Add(request.id, cancellation);
            try {
                await ((_runtime as IAvatarPackageRuntime) ?? throw new InvalidOperationException("Package runtime unavailable.")).ValidatePackageAsync(JsonUtility.FromJson<AvatarCharacterPackage>(request.value), cancellation.Token);
                Reply(request);
            } catch (Exception error) { Reply(request, error.Message); }
            finally { _validations.Remove(request.id); }
        }

        private void ShowUserSubtitle(string text)
        {
            if (_danceRequest != null || _dance?.Active == true) return;
            if (string.IsNullOrWhiteSpace(text) || text.Length > 20000) return;
            PublishSubtitle("你：" + text.Trim(), true);
        }

        private void ShowSubtitle(string text) { if (_dance?.Active != true) PublishSubtitle(text, false); }
        private void ClearSubtitle() => PublishSubtitle("", false);
        private void PublishSubtitle(string text, bool user)
        {
            text = string.IsNullOrWhiteSpace(text) ? "" : text;
            if (_subtitleText == text && _userSubtitleActive == user) return;
            _subtitleText = text; _userSubtitleActive = user;
        }
        private void OnGUI()
        {
            if (_liveOutput?.Active == true) return;
            var text = CurrentSubtitle;
            if (string.IsNullOrEmpty(text)) return;
            var scale = _window != null ? _window.UiScale : Mathf.Max(1f, Screen.dpi / 96f);
            var fontSize = AvatarSpeechSubtitles.Layout.FontSize(scale);
            if (_subtitleStyle == null || _subtitleScale != scale)
            {
                if (_subtitleFont == null)
                    _subtitleFont = Font.CreateDynamicFontFromOSFont(
                        AvatarSpeechSubtitles.Layout.FontFamilies, fontSize);
                _subtitleStyle = new GUIStyle(GUI.skin.label) {
                    font = _subtitleFont, fontSize = fontSize, wordWrap = true,
                    richText = false, alignment = TextAnchor.MiddleCenter,
                    padding = new RectOffset(Mathf.RoundToInt(AvatarSpeechSubtitles.Layout.HorizontalPadding(scale)),Mathf.RoundToInt(AvatarSpeechSubtitles.Layout.HorizontalPadding(scale)),
                        Mathf.RoundToInt(AvatarSpeechSubtitles.Layout.VerticalPadding(scale)),Mathf.RoundToInt(AvatarSpeechSubtitles.Layout.VerticalPadding(scale))),
                };
                _subtitleScale = scale;
            }
            _subtitleStyle.normal.textColor = CurrentSubtitleColor;
            var wide = (_rig != null && _rig.Immersive) || (_dance != null && _dance.Active);
            var maxWidth = AvatarSpeechSubtitles.Layout.MaxWidth(Screen.width,scale,wide);
            var content = new GUIContent(text);
            var width = Mathf.Min(maxWidth, Mathf.Ceil(_subtitleStyle.CalcSize(content).x));
            var bottomMargin = AvatarSpeechSubtitles.Layout.BottomMargin(Screen.height,scale);
            var edgeMargin = 6f * scale;
            var height = Mathf.Min(Mathf.Ceil(_subtitleStyle.CalcHeight(content, width)),
                Mathf.Max(1f, Screen.height - bottomMargin - edgeMargin));
            var bounds = new Rect((Screen.width - width) * .5f,
                Mathf.Max(edgeMargin, Screen.height - height - bottomMargin), width, height);
            GUI.DrawTexture(bounds, Texture2D.whiteTexture, ScaleMode.StretchToFill, true,
                0f, CurrentSubtitleBackground, 0f, AvatarSpeechSubtitles.Layout.Radius(scale));
            GUI.Label(bounds, content, _subtitleStyle);
        }

        private void ConsumeEvent(StreamEvent chunk, string runId = null, bool speechEnabled = false)
        {
            if (chunk == null) return;
            if (!string.IsNullOrEmpty(runId)) _activeRunId = runId;
            switch (chunk.type)
            {
                case "text-start":
                    if (string.IsNullOrEmpty(chunk.id) || _textBlocks.ContainsKey(chunk.id)) return;
                    var chatOnly = _chatOnlyRuns.Contains(runId) || (_danceRequest != null && _danceRequest.runId != runId);
                    if (chatOnly) _chatOnlyRuns.Add(runId);
                    var block = new SubtitleBlock { RunId = runId, Id = chunk.id, SpeechEnabled = speechEnabled, ChatOnly = chatOnly };
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
                    if ((chunk.toolName != "avatar_action" && chunk.toolName != "set_expression" && chunk.toolName != "avatar_perform" && chunk.toolName != "avatar_control" && chunk.toolName != "avatar_play")
                        || string.IsNullOrWhiteSpace(chunk.toolCallId) || _toolNodes.ContainsKey(chunk.toolCallId)) return;
                    var item = new TimelineItem { Kind = "tool", ToolCallId = chunk.toolCallId, ToolName = chunk.toolName, RunId = runId };
                    if (_commands.TryGetValue(chunk.toolCallId, out var command))
                    {
                        _commands.Remove(chunk.toolCallId);
                        if (MatchesTool(item, command)) { PrepareCommand(item, command); item.Command = command; }
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
                case "tool-input-error": case "tool-output-error": case "tool-output-denied":
                    // Main may reject a tool before sending any execution request.
                    // Release only that run's unmatched placeholder so its next
                    // dialogue can play while the Agent continues generating.
                    if (chunk.toolCallId != null && _toolNodes.TryGetValue(chunk.toolCallId, out var failedTool)
                        && failedTool.RunId == runId)
                    {
                        failedTool.Kind = "skip";
                        _toolNodes.Remove(chunk.toolCallId);
                        EnsureTimeline();
                    }
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
                PrepareCommand(item, request);
                item.Command = request;
                _toolNodes.Remove(request.toolCallId);
            }
            else
            {
                // Validate and retain the request before acknowledging it, even when the native
                // stream event arrives later. Binding to the run still requires that event.
                if (request.operation == "performance") PrepareCommand(new TimelineItem(), request);
                if ((request.operation == "performance-finish" || request.operation == "performance-cancel") && !_performances.ContainsKey(request.value))
                    throw new ArgumentException("表演已经释放。");
                _commands.Add(request.toolCallId, request);
            }
            Reply(request);
            EnsureTimeline();
        }

        private static bool MatchesTool(TimelineItem item, Request request) =>
            (item.ToolName == "avatar_action" && (request.operation == "action" || request.operation == "action-finish" || request.operation == "action-cancel"))
            || (item.ToolName == "set_expression" && request.operation == "expression")
            || (item.ToolName == "avatar_perform" && request.operation == "performance")
            || (item.ToolName == "avatar_play" && request.operation == "dance")
            || (item.ToolName == "avatar_control" && (request.operation == "performance-finish" || request.operation == "performance-cancel" || request.operation == "dance-cancel"));

        private void PrepareCommand(TimelineItem item, Request request)
        {
            if (request.operation == "dance") {
                if (!string.IsNullOrEmpty(request.runId) && request.runId != item.RunId) throw new ArgumentException("舞蹈与会话运行不匹配。");
                request.runId = item.RunId;
                RouteAfterDance(item);
            }
            else if (request.operation == "dance-cancel") {
                // A repeated stop for an older dance must not release a newer performance.
                if (_danceRequest == null) _chatOnlyRuns.Remove(item.RunId);
                item.Kind = "skip";
            }
            else if (request.operation == "performance")
            {
                if (_performances.TryGetValue(request.id, out var accepted))
                {
                    if (accepted.RunId != null) throw new ArgumentException("重复表演请求。");
                    accepted.RunId = item.RunId; return;
                }
                if (_performances.Count >= 64)
                {
                    var terminal = _performances.FirstOrDefault(p => p.Value.Terminal);
                    if (terminal.Key == null) throw new InvalidOperationException("角色表演队列已满。");
                    _performances.Remove(terminal.Key);
                }
                _performances.Add(request.id, new AvatarPerformance(request.id, request.toolCallId, item.RunId,
                    JsonUtility.FromJson<AvatarPerformanceRequest>(request.value), _runtime,
                    state => Send(JsonUtility.ToJson(new PerformanceEvent { performance = state }))));
            }
            else if (request.operation == "performance-finish" || request.operation == "performance-cancel")
            {
                if (!_performances.TryGetValue(request.value, out var performance)) throw new ArgumentException("表演已经释放。");
                performance.Control(request.operation == "performance-cancel");
                item.Kind = "skip";
            }
        }
        private void CancelRun(string runId)
        {
            _mutedRuns.Add(runId);
            foreach (var performance in _performances.Values.Where(p => p.RunId == runId).ToArray()) performance.Control(true);
            foreach (var pair in _toolNodes.Where(p => p.Value.RunId == runId && p.Value.ToolName != "avatar_play").ToArray())
            { pair.Value.Kind = "skip"; _toolNodes.Remove(pair.Key); }
            if (_activeRunId == runId)
            {
                foreach (var command in _commands.Values.Where(command => command.operation != "dance").ToArray()) {
                    ReportInstructionFailure(command, "回复已取消。"); _commands.Remove(command.toolCallId);
                }
            }
            if (_runtime is IAvatarActionControl control)
                foreach (var action in _runningActions.Values.Where(r => r.runId == runId).ToArray())
                    if (action.instanceId != null && control.GetActionInstanceId(action.value) == action.instanceId) control.CancelAction(action.value);
            if (_playingRunId == runId) _speech?.Stop();
            EnsureTimeline();
        }
        private void ClearPerformances()
        {
            foreach (var performance in _performances.Values.ToArray()) performance.Control(true);
            _performances.Clear();
        }
        private void BindPerformances(SubtitleBlock block)
        {
            foreach (var performance in _performances.Values.Where(p => p.RunId == block.RunId)) performance.Bind(block.Id);
        }
        private void ProgressPerformances(SubtitleBlock block, int sentence, bool ended = false)
        {
            foreach (var performance in _performances.Values.Where(p => p.RunId == block.RunId)) performance.Progress(block.Id, sentence, ended);
        }

        private void ReportInstructionFailure(Request request, string error)
        {
            if (request.operation == "dance") EndDance(request, "failed", error);
            else if (request.operation == "dance-cancel") { /* The stop was already acknowledged. */ }
            else if (request.operation == "performance" || request.operation.StartsWith("performance-", StringComparison.Ordinal))
            {
                if (_performances.TryGetValue(request.id, out var performance)) performance.Reject(error);
            }
            else if (request.operation.StartsWith("action", StringComparison.Ordinal)) ReportAction(request, "failed", error);
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
            var spoken = block.SpokenText ?? block.Text;
            while (!_mutedRuns.Contains(block.RunId))
            {
                spoken = block.SpokenText ?? block.Text;
                consumed = Math.Min(consumed, spoken.Length);
                var page = AvatarSpeechSubtitles.ReadPage(spoken.Substring(consumed), block.Complete, out var length, out var ready);
                if (page.Length == 0)
                {
                    if (block.Complete) break;
                    yield return null; continue;
                }
                ProgressPerformances(block, AvatarDialogueAnchors.SentenceStarts(spoken).Count(start => start <= consumed));
                ShowSubtitle(page);
                if (!ready) { yield return null; continue; }
                var remaining = Mathf.Clamp(new StringInfo(page).LengthInTextElements / 9f + 0.5f, 1.4f, 7f);
                var readingSeconds = remaining;
                while (remaining > 0f && !_mutedRuns.Contains(block.RunId))
                {
                    var offset = consumed + (int)(length * (1f - remaining / readingSeconds));
                    ProgressPerformances(block, AvatarDialogueAnchors.SentenceStarts(spoken).Count(start => start <= offset));
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
                        if (block.ChatOnly || _mutedRuns.Contains(block.RunId)) {
                            Send(JsonUtility.ToJson(new DialogueDelivery { runId = block.RunId, dialogueId = block.Id, delivery = "chat-only" }));
                            _dialogues.Remove(block.RunId + ":" + block.Id);
                            Send(JsonUtility.ToJson(new DialogueCompleted { runId = block.RunId, dialogueId = block.Id }));
                            _timeline.Dequeue(); continue;
                        }
                        Send(JsonUtility.ToJson(new DialogueDelivery { runId = block.RunId, dialogueId = block.Id, delivery = "spoken" }));
                        BindPerformances(block);
                        // The normalized spoken text is sent at text-end. Wait only for bound performances;
                        // ordinary silent subtitles retain their incremental display.
                        if (_performances.Values.Any(p => !p.Terminal && p.RunId == block.RunId && p.DialogueId == block.Id))
                            while (_connected && block.SpokenText == null && !_mutedRuns.Contains(block.RunId)) yield return null;
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
                                    if (status == "started") { started = true; ProgressPerformances(block, 1); _playingRunId = block.RunId; Send(JsonUtility.ToJson(new PlaybackEvent { runId = block.RunId, active = true, state = "playing" })); }
                                    if (status != "started") { finished = true; failed = status == "failed"; }
                                }, block.Audio.profilePath, block.Audio.streaming);
                            } catch { finished = true; failed = true; }
                            while (_connected && !finished)
                            {
                                if (started) ProgressPerformances(block, AvatarDialogueAnchors.SentenceAt(block.Audio.text, _speech.PositionSeconds,
                                    block.Audio.streaming ? _speech.StreamSegments : block.Audio.segments, _speech.DurationSeconds, block.Audio.streaming));
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
                        ProgressPerformances(block, 0, true);
                        _dialogues.Remove(block.RunId + ":" + block.Id);
                        if (!string.IsNullOrEmpty(block.RunId)) Send(JsonUtility.ToJson(new DialogueCompleted {
                            runId = block.RunId, dialogueId = block.Id,
                        }));
                    }
                    else if (item.Kind == "tool")
                    {
                        if (_mutedRuns.Contains(item.RunId) && item.ToolName != "avatar_play") { _timeline.Dequeue(); continue; }
                        while (_connected && item.Kind == "tool" && item.Command == null && (!_mutedRuns.Contains(item.RunId) || item.ToolName == "avatar_play")) yield return null;
                        if (!_connected) yield break;
                        if (item.Kind == "skip" || (_mutedRuns.Contains(item.RunId) && item.ToolName != "avatar_play")) { _timeline.Dequeue(); continue; }
                        if (item.Command.operation == "dance") yield return PlayDance(item.Command);
                        else if (item.Command.operation == "performance") _performances[item.Command.id].Armed = true;
                        else if (item.Command.operation == "expression") ApplyExpression(item.Command);
                        else
                        {
                            var action = _runtime.AvailableActions.FirstOrDefault(a => a.Id == item.Command.value);
                            var layer = action.Layer ?? "body";
                            var barrier = item.Command.operation == "action" && action.Kind != "loop";
                            while (_connected && barrier && _blockingActions.ContainsKey(layer) && !_mutedRuns.Contains(item.RunId)) yield return null;
                            if (!_connected) yield break;
                            if (_mutedRuns.Contains(item.RunId)) { _timeline.Dequeue(); continue; }
                            item.Command.runId = item.RunId;
                            _pendingActions.Add(item.Command.id);
                            if (barrier) _blockingActions[layer] = item.Command.id;
                            StartCoroutine(Act(item.Command));
                            while (_connected && _pendingActions.Contains(item.Command.id)) yield return null;
                            if (!item.Command.allowSpeech)
                                while (_connected && _blockingActions.Values.Contains(item.Command.id)) yield return null;
                        }
                    }
                    else if (item.Kind == "dance") yield return PlayDance(item.Command);
                    else if (item.Kind == "drain")
                    {
                        foreach (var performance in _performances.Values.Where(p => p.RunId == item.Command.value)) performance.NoDialogue();
                        while (_connected && _performances.Values.Any(p => p.RunId == item.Command.value && !p.Terminal)) yield return null;
                        while (_connected && _blockingActions.Count > 0) yield return null;
                        if (_connected) Reply(item.Command);
                        _mutedRuns.Remove(item.Command.value);
                        _chatOnlyRuns.Remove(item.Command.value);
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
            var control = _runtime as IAvatarActionControl;
            var loop = _runtime.AvailableActions.Any(action => action.Id == request.value && action.Kind == "loop");
            string instanceId = null;
            _runningActions[request.id] = request;
            try
            {
                if (_runtime.Snapshot.RuntimeState != AvatarRuntimeState.Ready)
                { ReportAction(request, "failed", "角色尚未就绪。"); yield break; }
                if (request.operation == "action-cancel")
                {
                    instanceId = control?.GetActionInstanceId(request.value);
                    if (control != null ? !control.CancelAction(request.value) : _runtime.Snapshot.Motion.CurrentActionId != request.value)
                    { ReportAction(request, "failed", "该动作当前未播放。"); yield break; }
                    if (control == null) _runtime.CancelAction();
                    ReportAction(request, "completed", instanceId: instanceId, loop: loop); yield break;
                }
                if (request.operation == "action-finish")
                {
                    instanceId = control?.GetActionInstanceId(request.value);
                    if (control == null || !control.FinishAction(request.value))
                    { ReportAction(request, "failed", "该持续姿态当前未播放。"); yield break; }
                }
                else
                {
                    var result = _runtime.RequestAction(request.value);
                    if (result.Outcome != AvatarActionRequestOutcome.Started)
                    { ReportAction(request, "failed", result.Error ?? "动作不可用。"); yield break; }
                    instanceId = control?.GetActionInstanceId(request.value);
                }
                while (instanceId != null && control.GetActionState(instanceId) == PerformanceInstanceState.Requested
                    && _runtime.Snapshot.RuntimeState == AvatarRuntimeState.Ready) yield return null;
                if (instanceId != null && control.GetActionState(instanceId)?.IsTerminal() == true) {
                    var terminal = control.GetActionState(instanceId);
                    ReportAction(request, terminal == PerformanceInstanceState.Completed ? "completed" : terminal == PerformanceInstanceState.Failed ? "failed" : "cancelled", instanceId: instanceId, loop: loop); yield break;
                }
                request.instanceId = instanceId;
                ReportAction(request, "started", instanceId: instanceId, loop: loop);
                _pendingActions.Remove(request.id);
                // Holding a pose is not a dialogue barrier. Its coroutine only observes
                // the authoritative instance, so a later gesture cannot deadlock on it.
                var sequence = _runtime.Snapshot.Motion.ActionSequence;
                while (_runtime.Snapshot.RuntimeState == AvatarRuntimeState.Ready
                    || (instanceId != null && _runtime.Snapshot.RuntimeState == AvatarRuntimeState.Loading))
                {
                    if (instanceId != null)
                    {
                        var state = control.GetActionState(instanceId);
                        if (!state.HasValue || state.Value.IsTerminal()) break;
                    }
                    else if (_runtime.Snapshot.Motion.ActionSequence != sequence || _runtime.Snapshot.Motion.CurrentActionId != request.value) break;
                    yield return null;
                }
                var final = instanceId != null ? control.GetActionState(instanceId) : null;
                var cancelled = instanceId != null ? final != PerformanceInstanceState.Completed
                    : _runtime.Snapshot.RuntimeState != AvatarRuntimeState.Ready || _runtime.Snapshot.Motion.ActionSequence != sequence;
                var failed = final == PerformanceInstanceState.Failed;
                ReportAction(request, failed ? "failed" : cancelled ? "cancelled" : "completed", failed ? "动作播放失败。" : null, instanceId, loop);
            }
            finally
            {
                _pendingActions.Remove(request.id);
                _runningActions.Remove(request.id);
                foreach (var layer in _blockingActions.Where(pair => pair.Value == request.id).Select(pair => pair.Key).ToArray()) _blockingActions.Remove(layer);
            }
        }

        private void ReportAction(Request request, string status, string error = null, string instanceId = null, bool loop = false) =>
            Send(JsonUtility.ToJson(new ActionEvent { id = request.id, status = status, error = error ?? "", instanceId = instanceId, loop = loop }));

        private void ReportExpression(Request request, string status, string error = null) =>
            Send(JsonUtility.ToJson(new ExpressionEvent { id = request.id, status = status, error = error ?? "" }));

        private void Reply(Request request, string error = null) => Send(JsonUtility.ToJson(new Result { id = request.id, ok = error == null, error = error ?? "" }));
        private void Send(string json) { if (!_stopping && !_outgoing.IsAddingCompleted) _outgoing.TryAdd(json); }
        private void OnDestroy()
        {
            AvatarDiagnostics.Sender = null;
            CancelDance("桌宠已停止。");
            if (_subtitleFont != null) Destroy(_subtitleFont);
            if (_window != null) _window.StateChanged -= Send;
            ClearPerformances();
            _stopping = true; _connected = false;
            _lifetime.Cancel(); _outgoing.CompleteAdding(); _pipe?.Dispose();
        }
    }
}
