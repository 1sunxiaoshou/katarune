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
using UnityEngine.UIElements;

namespace Katarune.Avatar
{
    public sealed class AvatarControlConnection : MonoBehaviour
    {
        [Serializable] private sealed class Request { public string type; public StreamEvent @event; public string id; public string operation; public string value; public bool allowSpeech = true; public string toolCallId; public string runId; public string dialogueId; public bool speechEnabled; public bool failed; public bool streaming; public string text; public AvatarSpeechSegment[] segments; public string profilePath; }
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
            public Request Command;
        }
        [Serializable] private sealed class ActionInfo { public string id; public string label; public float durationSeconds; }
        [Serializable] private sealed class Capabilities { public ActionInfo[] actions; public string[] expressions; }
        [Serializable] private sealed class Ready { public string type = "ready"; public Capabilities capabilities; }
        [Serializable] private sealed class Result { public string type = "result"; public string id; public bool ok; public string error; }

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
        private VisualElement _subtitle;
        private Label _label;
        private ScrollView _subtitleScroll;
        private volatile bool _connected;
        private volatile bool _stopping;
        private bool _timelineRunning;
        private bool _acting;
        private bool _actionStarted;
        private string _lastCapabilities;
        private string _activeRunId;
        private AvatarSpeechPlayer _speech;

        [Serializable] private sealed class SpeechEvent { public string type = "speech"; public string id; public string status; public string error; }

        public void Configure(IAvatarRuntimeFacade runtime, UIDocument document, string pipeName, AvatarSpeechPlayer speech = null)
        {
            _speech = speech;
            _runtime = runtime;
            _subtitle = document.rootVisualElement.Q("subtitleRoot");
            _label = document.rootVisualElement.Q<Label>("subtitleText");
            _label.enableRichText = false;
            _subtitleScroll = new ScrollView(ScrollViewMode.Vertical) { name = "speechSubtitleScroll" };
            _subtitleScroll.style.maxHeight = 240;
            _subtitleScroll.style.maxWidth = 880;
            _subtitleScroll.style.flexShrink = 1;
            _label.RemoveFromHierarchy();
            _subtitleScroll.Add(_label);
            _subtitle.Add(_subtitleScroll);
            _subtitle.style.display = DisplayStyle.None;
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
                    _subtitle.style.display = DisplayStyle.None;
                    _timeline.Clear(); _toolNodes.Clear(); _commands.Clear(); _textBlocks.Clear(); _dialogues.Clear(); _lastCapabilities = null;
                    _timelineRunning = false; _acting = false; _actionStarted = false;
                }
                return;
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
            while (_incoming.TryTake(out var line))
            {
                Request request = null;
                try
                {
                    request = JsonUtility.FromJson<Request>(line);
                    if (request?.type == "event") { ConsumeEvent(request.@event, request.runId, request.speechEnabled); continue; }
                    if (request?.type == "dialogue-audio")
                    {
                        if (_dialogues.TryGetValue(request.runId + ":" + request.dialogueId, out var dialogue)) dialogue.Audio = request;
                        continue;
                    }
                    if (request?.operation == "run-cancel")
                    {
                        if (request.value == _activeRunId)
                        {
                            var drains = _timeline.Where(item => item.Kind == "drain").Select(item => item.Command).ToArray();
                            _timeline.Clear(); _toolNodes.Clear(); _commands.Clear(); _textBlocks.Clear(); _dialogues.Clear();
                            StopAllCoroutines(); _speech?.Stop(); _runtime.CancelAction();
                            _timelineRunning = false; _acting = false; _actionStarted = false;
                            _subtitle.style.display = DisplayStyle.None;
                            _activeRunId = null;
                            foreach (var drain in drains) Reply(drain);
                        }
                        Reply(request); continue;
                    }
                    if (request == null || !Guid.TryParse(request.id, out _) || (request.operation != "drain" && string.IsNullOrWhiteSpace(request.value)))
                        throw new ArgumentException("Invalid avatar request.");
                    if (_runtime.Snapshot.RuntimeState != AvatarRuntimeState.Ready) throw new InvalidOperationException("角色尚未就绪。");
                    switch (request.operation)
                    {
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
            _subtitle.style.display = DisplayStyle.None;
        }

        private void ShowSubtitle(string text)
        {
            if (_label.text != text) { _label.text = text; _subtitleScroll.scrollOffset = Vector2.zero; }
            _subtitle.style.display = DisplayStyle.Flex;
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
                    var item = new TimelineItem { Kind = "tool", ToolCallId = chunk.toolCallId, ToolName = chunk.toolName };
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
            while (true)
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
                while (remaining > 0f)
                {
                    yield return null;
                    remaining -= Time.unscaledDeltaTime;
                }
                consumed += length;
            }
            _subtitle.style.display = DisplayStyle.None;
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
                        if (block.SpeechEnabled)
                        {
                            while (_connected && block.Audio == null) yield return null;
                            if (!_connected) yield break;
                        }
                        if (block.Audio != null && !block.Audio.failed && _speech != null)
                        {
                            var finished = false;
                            var failed = false;
                            var started = false;
                            var liveSubtitles = new AvatarSpeechSubtitles.StreamingTimeline(block.Audio.text);
                            AvatarSpeechSubtitles.Timeline subtitles = null;
                            try {
                                _speech.Play(Guid.NewGuid().ToString(), block.Audio.value, (id, status, error) => {
                                    Send(JsonUtility.ToJson(new SpeechEvent { id = id, status = status, error = error }));
                                    if (status == "started") started = true;
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
                            _subtitle.style.display = DisplayStyle.None;
                            if (failed && !started) yield return Speak(block);
                        }
                        else yield return Speak(block);
                        _dialogues.Remove(block.RunId + ":" + block.Id);
                        if (!string.IsNullOrEmpty(block.RunId)) Send(JsonUtility.ToJson(new DialogueCompleted {
                            runId = block.RunId, dialogueId = block.Id,
                        }));
                    }
                    else if (item.Kind == "tool")
                    {
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
            _stopping = true; _connected = false;
            _lifetime.Cancel(); _outgoing.CompleteAdding(); _pipe?.Dispose();
        }
    }
}
