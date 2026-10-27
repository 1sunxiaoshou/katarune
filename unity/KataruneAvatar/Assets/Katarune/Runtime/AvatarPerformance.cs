using System;
using System.Collections.Generic;
using System.Linq;

namespace Katarune.Avatar
{
    [Serializable] internal sealed class AvatarPerformanceRequest { public AvatarPerformanceStep[] steps; }
    [Serializable] internal sealed class AvatarPerformanceStep
    {
        public string at;
        public int sentence;
        public string action;
        public string expression;
    }
    [Serializable] internal sealed class AvatarCueStatus { public string id; public string state = "pending"; }
    [Serializable] internal sealed class AvatarPerformanceStatus
    {
        public string performanceId; public string toolCallId; public string state = "accepted"; public string error = "";
        public AvatarCueStatus[] cues;
    }

    // Owns cue dependencies only. The Facade and Core scheduler retain all motion state.
    internal sealed class AvatarPerformance
    {
        private sealed class Node
        {
            public AvatarPerformanceStep Step;
            public Node After;
            public AvatarCueStatus Status;
            public string InstanceId;
            public bool Owned;
        }
        private readonly IAvatarRuntimeFacade _runtime;
        private readonly IAvatarActionControl _control;
        private readonly Action<AvatarPerformanceStatus> _changed;
        private readonly Node[] _nodes;
        internal readonly AvatarPerformanceStatus Status;
        internal string RunId;
        internal string DialogueId { get; private set; }
        internal bool Armed;
        private bool _started;
        private bool _ended;
        private bool _finishing;
        private int _sentence;
        internal bool Terminal => Status.state == "completed" || Status.state == "cancelled" || Status.state == "failed";
        internal bool ContainsActions => _nodes.Any(node => !string.IsNullOrEmpty(node.Step.action));

        internal AvatarPerformance(string id, string toolCallId, string runId, AvatarPerformanceRequest request,
            IAvatarRuntimeFacade runtime, Action<AvatarPerformanceStatus> changed)
        {
            _runtime = runtime; _control = runtime as IAvatarActionControl; _changed = changed; RunId = runId;
            if (request?.steps == null || request.steps.Length == 0 || request.steps.Length > 32) throw new ArgumentException("表演步骤数量无效。");
            _nodes = new Node[request.steps.Length];
            Node previousAction = null;
            for (var i = 0; i < request.steps.Length; i++)
            {
                var step = request.steps[i];
                if (step == null || (string.IsNullOrEmpty(step.action) && string.IsNullOrEmpty(step.expression)))
                    throw new ArgumentException("每一步必须包含动作或表情。");
                if (step.at != "sentence" && step.sentence != 0) throw new ArgumentException("只有 sentence 触发可以填写句子编号。");
                switch (step.at)
                {
                    case "start": case "end": break;
                    case "sentence": if (step.sentence < 1 || step.sentence > 128) throw new ArgumentException("句子编号无效。"); break;
                    case "after_action":
                        if (previousAction == null || IsLoop(previousAction)) throw new ArgumentException("after_action 前必须安排一个一次性动作。");
                        break;
                    default: throw new ArgumentException("未知表演触发条件。");
                }
                if (!string.IsNullOrEmpty(step.action) && !runtime.AvailableActions.Any(a => a.Id == step.action && !a.IsDance)) throw new ArgumentException("动作不可用。");
                if (!string.IsNullOrEmpty(step.expression) && (!Enum.TryParse<AvatarAffectPreset>(step.expression, true, out var preset)
                    || !runtime.Snapshot.Capabilities.SupportsAffect(preset))) throw new ArgumentException("表情不可用。");
                var node = new Node { Step = step, After = step.at == "after_action" ? previousAction : null,
                    Status = new AvatarCueStatus { id = $"step-{i + 1}" } };
                _nodes[i] = node;
                if (!string.IsNullOrEmpty(step.action)) previousAction = node;
            }
            Status = new AvatarPerformanceStatus { performanceId = id, toolCallId = toolCallId, cues = _nodes.Select(n => n.Status).ToArray() };
            Publish();
        }

        internal void Bind(string dialogueId) { if (!Terminal && Armed && DialogueId == null) DialogueId = dialogueId; }
        internal void Progress(string dialogueId, int sentence, bool ended = false)
        {
            if (Terminal || DialogueId != dialogueId) return;
            _started = true; _sentence = Math.Max(_sentence, sentence); _ended |= ended;
            Tick();
        }
        internal void NoDialogue()
        {
            if (Terminal || DialogueId != null) return;
            foreach (var node in _nodes) node.Status.state = "skipped";
            Status.state = "completed"; Publish();
        }
        internal void Reject(string error)
        {
            Control(true); Status.state = "failed"; Status.error = error; Publish();
        }
        internal void Control(bool cancel)
        {
            if (Terminal) return;
            _finishing = true;
            foreach (var node in _nodes)
            {
                if (node.Status.state == "pending") node.Status.state = cancel ? "cancelled" : "skipped";
                if (node.Status.state != "running" || !Owns(node)) continue;
                if (cancel) { _control.CancelAction(node.Step.action); node.Status.state = "cancelled"; }
                else if (IsLoop(node)) _control.FinishAction(node.Step.action, completeCycle: true);
            }
            Status.state = cancel ? "cancelled" : "exiting"; Publish();
            if (!cancel) Tick();
        }
        internal void Tick()
        {
            if (Terminal) return;
            var dirty = false;
            foreach (var node in _nodes)
            {
                if (node.Status.state == "running")
                {
                    var state = _control?.GetActionState(node.InstanceId);
                    if (!state.HasValue || state.Value.IsTerminal())
                    {
                        node.Status.state = state == PerformanceInstanceState.Completed ? "completed"
                            : state == PerformanceInstanceState.Failed ? "failed" : "cancelled";
                        dirty = true;
                    }
                    else if ((_ended || _finishing) && IsLoop(node) && Owns(node)) _control.FinishAction(node.Step.action, completeCycle: true);
                }
                if (node.Status.state != "pending" || _finishing || !_started) continue;
                if (node.After != null)
                {
                    var parent = node.After;
                    if (parent.Status.state == "failed" || parent.Status.state == "cancelled" || parent.Status.state == "skipped")
                    { node.Status.state = "skipped"; dirty = true; continue; }
                    if (parent.Status.state != "completed") continue;
                }
                else if (node.Step.at == "end" && !_ended) continue;
                else if (node.Step.at == "sentence" && node.Step.sentence > _sentence)
                {
                    if (_ended) { node.Status.state = "skipped"; dirty = true; }
                    continue;
                }
                if (!string.IsNullOrEmpty(node.Step.action) && ChannelBusy(node)) continue;
                // A delayed gesture may still drain after speech, but a new loop must not outlive its dialogue.
                if (_ended && IsLoop(node))
                { node.Status.state = "skipped"; dirty = true; continue; }
                try
                {
                    if (!string.IsNullOrEmpty(node.Step.action))
                    {
                        if (_control == null) throw new InvalidOperationException("当前播放器不支持表演实例控制。");
                        var action = node.Step.action;
                        var previousInstance = _control.GetActionInstanceId(action);
                        var result = _runtime.RequestAction(action);
                        if (result.Outcome != AvatarActionRequestOutcome.Started) throw new InvalidOperationException(result.Error ?? "动作无法开始。");
                        node.InstanceId = _control.GetActionInstanceId(action);
                        if (node.InstanceId == null) throw new InvalidOperationException("动作未创建播放实例。");
                        node.Owned = node.InstanceId != previousInstance;
                        node.Status.state = node.Owned ? "running" : "completed";
                    }
                    if (!string.IsNullOrEmpty(node.Step.expression))
                    {
                        Enum.TryParse<AvatarAffectPreset>(node.Step.expression, true, out var preset);
                        _runtime.ApplyBehavior(_runtime.Snapshot.Behavior.WithAffect(preset, 1f));
                    }
                    if (node.Status.state == "pending") node.Status.state = "completed";
                }
                catch (Exception error) { node.Status.state = "failed"; Status.error = error.Message; }
                dirty = true;
            }
            if ((_ended || _finishing) && _nodes.All(n => n.Status.state != "pending" && n.Status.state != "running"))
            { Status.state = _nodes.Any(n => n.Status.state == "failed") ? "failed" : "completed"; dirty = true; }
            else if (_started && Status.state == "accepted") { Status.state = "running"; dirty = true; }
            if (dirty) Publish();
        }
        private bool IsLoop(Node node) => !string.IsNullOrEmpty(node.Step.action) && _runtime.AvailableActions.Any(a => a.Id == node.Step.action && a.Kind == "loop");
        private bool Owns(Node node) => node.Owned && node.InstanceId != null && _control?.GetActionInstanceId(node.Step.action) == node.InstanceId;
        private bool ChannelBusy(Node node)
        {
            var action = _runtime.AvailableActions.First(a => a.Id == node.Step.action);
            // Let one-shot gestures temporarily borrow a loop's channel, preserving the existing restore behavior.
            return _runtime.AvailableActions.Any(a => a.Layer == action.Layer && a.Kind != "loop"
                && _control?.GetActionInstanceId(a.Id) is string id && _control.GetActionState(id) is PerformanceInstanceState state && !state.IsTerminal());
        }
        private void Publish() => _changed(Status);
    }

    internal static class AvatarDialogueAnchors
    {
        // Semantic sentence boundaries do not depend on subtitle wrapping or screen width.
        internal static int[] SentenceStarts(string text)
        {
            var starts = new List<int>(); var next = true;
            for (var i = 0; i < (text?.Length ?? 0); i++)
            {
                var ch = text[i];
                if (char.IsWhiteSpace(ch)) { if (ch == '\n' || ch == '\r') next = true; continue; }
                if ("\"'”’」』）》】".IndexOf(ch) >= 0) continue;
                var decimalPoint = ch == '.' && i > 0 && i + 1 < text.Length && char.IsDigit(text[i - 1]) && char.IsDigit(text[i + 1]);
                if ("。！？!?…".IndexOf(ch) >= 0 || (ch == '.' && !decimalPoint && (i + 1 == text.Length || char.IsWhiteSpace(text[i + 1]))))
                { next = true; continue; }
                if (next) { starts.Add(i); next = false; }
            }
            return starts.ToArray();
        }
        internal static int SentenceAt(string text, float position, AvatarSpeechSegment[] segments, float duration, bool streaming)
        {
            var starts = SentenceStarts(text); if (starts.Length == 0) return 0;
            var covered = AvatarSpeechSubtitles.Timeline.AlignedLength(text, segments);
            var sentence = 1;
            for (var i = 1; i < starts.Length; i++)
            {
                var time = covered > starts[i] ? AvatarSpeechSubtitles.Timeline.TimeAt(starts[i], false, segments)
                    : !streaming && duration > 0 ? duration * starts[i] / text.Length : float.PositiveInfinity;
                if (position < time) break;
                sentence = i + 1;
            }
            return sentence;
        }
    }
}
