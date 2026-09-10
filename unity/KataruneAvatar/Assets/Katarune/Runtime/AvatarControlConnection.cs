using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.UIElements;

namespace Katarune.Avatar
{
    public sealed class AvatarControlConnection : MonoBehaviour
    {
        [Serializable] private sealed class Request { public string type; public StreamEvent @event; public string id; public string operation; public string value; public bool allowSpeech = true; public string toolCallId; }
        [Serializable] private sealed class StreamEvent { public string type; public string id; public string delta; public string toolCallId; public string toolName; }
        private sealed class SubtitleBlock { public string Text = ""; public bool Complete; }
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
        private volatile bool _connected;
        private volatile bool _stopping;
        private bool _timelineRunning;
        private bool _acting;
        private bool _actionStarted;
        private string _lastCapabilities;

        public void Configure(IAvatarRuntimeFacade runtime, UIDocument document, string pipeName)
        {
            _runtime = runtime;
            _subtitle = document.rootVisualElement.Q("subtitleRoot");
            _label = document.rootVisualElement.Q<Label>("subtitleText");
            _label.enableRichText = false;
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
                    StopAllCoroutines(); _runtime.CancelAction();
                    _subtitle.style.display = DisplayStyle.None;
                    _timeline.Clear(); _toolNodes.Clear(); _commands.Clear(); _textBlocks.Clear(); _lastCapabilities = null;
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
                    if (request?.type == "event") { ConsumeEvent(request.@event); continue; }
                    if (request == null || !Guid.TryParse(request.id, out _) || (request.operation != "drain" && string.IsNullOrWhiteSpace(request.value)))
                        throw new ArgumentException("Invalid avatar request.");
                    if (_runtime.Snapshot.RuntimeState != AvatarRuntimeState.Ready) throw new InvalidOperationException("角色尚未就绪。");
                    switch (request.operation)
                    {
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
        private void ConsumeEvent(StreamEvent chunk)
        {
            if (chunk == null) return;
            switch (chunk.type)
            {
                case "text-start":
                    if (string.IsNullOrEmpty(chunk.id) || _textBlocks.ContainsKey(chunk.id)) return;
                    var block = new SubtitleBlock();
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
                var page = ReadSubtitlePage(block.Text.Substring(consumed), block.Complete, out var length, out var ready);
                if (page.Length == 0)
                {
                    if (block.Complete) break;
                    yield return null; continue;
                }
                _label.text = page;
                _subtitle.style.display = DisplayStyle.Flex;
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
                        yield return Speak(item.Subtitle);
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

        internal static string ReadSubtitlePage(string text, bool complete, out int consumed, out bool ready)
        {
            consumed = 0; ready = complete;
            var start = 0;
            while (start < text.Length && char.IsWhiteSpace(text[start])) start++;
            if (start == text.Length) { consumed = start; return ""; }
            var ends = StringInfo.ParseCombiningCharacters(text);
            var count = 0;
            var softBreak = 0;
            var end = text.Length;
            for (var i = 0; i < ends.Length; i++)
            {
                var offset = ends[i];
                if (offset < start) continue;
                var next = i + 1 < ends.Length ? ends[i + 1] : text.Length;
                var ch = text[offset];
                count++;
                var decimalPoint = ch == '.' && offset > start && char.IsDigit(text[offset - 1])
                    && next < text.Length && char.IsDigit(text[next]);
                if (ch == '\n' || ch == '\r' || ("。！？!?；;…".IndexOf(ch) >= 0) || (ch == '.' && !decimalPoint))
                {
                    end = next;
                    while (end < text.Length && "。！？!?….”’\"）)]」』".IndexOf(text[end]) >= 0) end++;
                    ready = complete || end < text.Length;
                    break;
                }
                if (char.IsWhiteSpace(ch) || "，,、：:".IndexOf(ch) >= 0) softBreak = next;
                if (count >= 48)
                {
                    end = softBreak > start + 16 ? softBreak : next;
                    ready = complete || next < text.Length;
                    break;
                }
            }
            // An unfinished trailing grapheme may still receive a combining mark or low surrogate.
            if (!ready && end == text.Length && ends.Length > 0 && !char.IsPunctuation(text[end - 1]))
                end = Math.Max(start, ends[ends.Length - 1]);
            consumed = end;
            return Regex.Replace(text.Substring(start, end - start), @"\s+", " ").Trim();
        }

        private void Reply(Request request, string error = null) => Send(JsonUtility.ToJson(new Result { id = request.id, ok = error == null, error = error ?? "" }));
        private void Send(string json) { if (!_stopping && !_outgoing.IsAddingCompleted) _outgoing.TryAdd(json); }
        private void OnDestroy()
        {
            _stopping = true; _connected = false;
            _lifetime.Cancel(); _outgoing.CompleteAdding(); _pipe?.Dispose();
        }
    }
}
