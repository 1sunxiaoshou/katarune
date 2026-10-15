using System;
using System.Collections.Generic;

namespace Katarune.Avatar
{
    internal enum PackageActionPhase { Enter, Loop, OneShot, Exit }
    internal enum PackageActionLayer { Body, UpperBody, Head }

    internal sealed class PackageActionDefinition
    {
        public readonly string Id;
        public readonly bool IsLoop;
        public readonly float EnterDuration, Duration, ExitDuration, BlendSeconds;
        public readonly PackageActionLayer Layer;
        public PackageActionDefinition(string id, bool loop, float duration, float enter = 0f, float exit = 0f, float blend = .2f, PackageActionLayer layer = PackageActionLayer.Body)
        {
            if (!AvatarActionIds.IsValid(id) || !float.IsFinite(duration) || duration <= 0f || duration > 3600f
                || !float.IsFinite(enter) || enter < 0f || enter > 3600f || !float.IsFinite(exit) || exit < 0f || exit > 3600f
                || !float.IsFinite(blend) || blend < 0f || blend > 2f || (!loop && (enter != 0f || exit != 0f)) || !Enum.IsDefined(typeof(PackageActionLayer), layer))
                throw new ArgumentException("Invalid package action definition.");
            Id = id; IsLoop = loop; Duration = duration; EnterDuration = enter; ExitDuration = exit; BlendSeconds = blend;
            Layer = layer;
        }
    }

    // Each lane owns phase/time and one saved loop. All lanes share the scheduler.
    internal sealed class PackageActionLane
    {
        private sealed class Playback
        {
            public PackageActionDefinition Definition;
            public PerformanceInstance Instance;
            public PackageActionPhase Phase;
            public float Time;
        }
        private readonly Dictionary<string, PackageActionDefinition> _definitions = new(StringComparer.Ordinal);
        private readonly PerformanceScheduler _scheduler;
        private readonly string _instancePrefix;
        private readonly PackageActionLayer _layer;
        private Playback _current, _parent, _next;
        private long _revision;
        public PackageActionLane(PerformanceScheduler scheduler, string prefix, PackageActionLayer layer)
        { _scheduler = scheduler; _instancePrefix = prefix; _layer = layer; }
        public event Action Changed;
        public string CurrentActionId => _current?.Definition.Id;
        public string CurrentInstanceId => _current == null ? null : _instancePrefix + _current.Instance.InstanceId;
        public string ParentActionId => _parent?.Definition.Id;
        public PackageActionPhase Phase => _current?.Phase ?? PackageActionPhase.Loop;
        public float Time => _current?.Time ?? 0f;
        public float BlendSeconds => _current?.Definition.BlendSeconds ?? .2f;
        public ulong ActionSequence { get; private set; }
        public long Revision => _revision;
        public int ActiveCount => _scheduler.ActiveInstances.Count;
        public string Diagnostics => $"action={CurrentActionId ?? "idle"}; instance={CurrentInstanceId}; phase={Phase}; time={Time.ToString("F4", System.Globalization.CultureInfo.InvariantCulture)}; parent={ParentActionId}; active={ActiveCount}; next={_next?.Definition.Id}";

        public void Add(PackageActionDefinition definition) => _definitions.Add(definition.Id, definition);
        public PerformanceInstanceState? GetState(string instanceId) => instanceId != null && instanceId.StartsWith(_instancePrefix, StringComparison.Ordinal)
            ? _scheduler.Find(instanceId.Substring(_instancePrefix.Length))?.State : null;
        public bool Request(string id)
        {
            if (!_definitions.TryGetValue(id, out var definition)) return false;
            if (_next?.Definition.Id == id) return true;
            if (definition.IsLoop && _current?.Definition.Id == id && _current.Instance.State != PerformanceInstanceState.Exiting) return true;
            if (definition.IsLoop && _parent?.Definition.Id == id)
            {
                End(_current, false); _current = _parent; _parent = null;
                ReenterSavedLoop();
                ActionSequence++; Notify(); return true;
            }
            // Replace a held pose through its authored exit. Only the newest pending
            // pose is retained; its scheduler instance is visible to request observers.
            if (definition.IsLoop && _parent != null)
            {
                End(_current, false); _current = _parent; _parent = null;
                _scheduler.ResumeSuspended(_current.Instance.InstanceId); Notify();
            }
            if (definition.IsLoop && _current?.Definition.IsLoop == true)
            {
                End(_next, false); _next = CreatePlayback(definition, PerformanceRequestPolicy.Queue);
                ActionSequence++; BeginExit(); return true;
            }
            if (definition.IsLoop) Cancel(false);
            else
            {
                End(_next, false); _next = null;
                if (_current?.Definition.IsLoop == true && _current.Instance.State == PerformanceInstanceState.Running)
                {
                    _parent = _current;
                    _scheduler.Suspend(_parent.Instance.InstanceId);
                }
                else End(_current, false);
            }
            _current = CreatePlayback(definition, PerformanceRequestPolicy.Reject);
            ActionSequence++; Notify(); return true;
        }
        private Playback CreatePlayback(PackageActionDefinition definition, PerformanceRequestPolicy policy)
        {
            var id = definition.Id;
            var behavior = new BehaviorDefinition(id, new[] { new PerformanceChannelClaim(
                _layer == PackageActionLayer.Head ? PerformanceChannel.HeadGesture : _layer == PackageActionLayer.UpperBody ? PerformanceChannel.GestureUpperBody
                    : definition.IsLoop ? PerformanceChannel.BodyBase : PerformanceChannel.BodyFullPerformance,
                PerformanceChannelOccupancy.Exclusive) }, PerformanceControlCapabilities.SafePointExit | PerformanceControlCapabilities.Pause);
            var result = _scheduler.Submit(new BehaviorIntent(Guid.NewGuid().ToString(), id, BehaviorIntentSource.Application), behavior, policy);
            if (result.Outcome == PerformanceRequestOutcome.Rejected) throw new InvalidOperationException(result.Error);
            return new Playback { Definition = definition, Instance = result.Instance,
                Phase = definition.IsLoop ? (definition.EnterDuration > 0f ? PackageActionPhase.Enter : PackageActionPhase.Loop) : PackageActionPhase.OneShot };
        }
        public bool Finish(string id)
        {
            if (_next?.Definition.Id == id) return CancelAction(id);
            if (_current?.Definition.Id != id || !_current.Definition.IsLoop) return false;
            BeginExit(); return true;
        }
        private void BeginExit()
        {
            if (_current.Instance.State == PerformanceInstanceState.Exiting) return;
            _scheduler.Apply(_current.Instance.InstanceId, PerformanceCommand.ExitAtSafePoint());
            _current.Phase = PackageActionPhase.Exit; _current.Time = 0f;
            if (_current.Definition.ExitDuration == 0f) CompleteCurrent(); else Notify();
        }
        public string InstanceFor(string id) => _next?.Definition.Id == id ? _instancePrefix + _next.Instance.InstanceId
            : _current?.Definition.Id == id ? CurrentInstanceId
            : _parent?.Definition.Id == id ? _instancePrefix + _parent.Instance.InstanceId : null;
        public bool CancelAction(string id)
        {
            if (_next?.Definition.Id == id)
            { End(_next, false); _next = null; ActionSequence++; Notify(); return true; }
            if (_current?.Definition.Id == id)
            { End(_current, false); _current = _next ?? _parent; var resumed = _next == null; _next = _parent = null; if (_current != null && resumed) ReenterSavedLoop(); ActionSequence++; Notify(); return true; }
            if (_parent?.Definition.Id == id)
            { End(_parent, false); _parent = null; ActionSequence++; Notify(); return true; }
            return false;
        }
        public void Cancel(bool notify = true)
        {
            if (_current == null && _parent == null && _next == null) return;
            End(_next, false); _next = null;
            End(_current, false); End(_parent, false); _current = null; _parent = null;
            ActionSequence++; if (notify) Notify();
        }
        public void Tick(float deltaTime)
        {
            if (!float.IsFinite(deltaTime) || deltaTime < 0f) throw new ArgumentOutOfRangeException(nameof(deltaTime));
            var remaining = deltaTime;
            while (_current != null)
            {
                if (_current.Phase == PackageActionPhase.Loop)
                { _current.Time = (_current.Time + remaining) % _current.Definition.Duration; return; }
                var duration = _current.Phase == PackageActionPhase.Enter ? _current.Definition.EnterDuration
                    : _current.Phase == PackageActionPhase.Exit ? _current.Definition.ExitDuration : _current.Definition.Duration;
                var step = Math.Min(remaining, Math.Max(0f, duration - _current.Time));
                _current.Time += step; remaining -= step;
                if (_current.Time < duration) return;
                if (_current.Phase == PackageActionPhase.Enter)
                { _current.Phase = PackageActionPhase.Loop; _current.Time = 0f; Notify(); }
                else CompleteCurrent();
                if (remaining <= 0f) return;
            }
        }
        private void CompleteCurrent()
        {
            End(_current, true); _current = _next ?? _parent; var resumed = _next == null;
            _next = _parent = null;
            if (_current != null && resumed) ReenterSavedLoop();
            // Natural completion does not invalidate an action's request sequence.
            Notify();
        }
        private void ReenterSavedLoop()
        {
            _scheduler.ResumeSuspended(_current.Instance.InstanceId);
            _current.Phase = _current.Definition.EnterDuration > 0f ? PackageActionPhase.Enter : PackageActionPhase.Loop;
            _current.Time = 0f;
        }
        private void End(Playback playback, bool completed)
        {
            if (playback == null) return;
            if (completed) _scheduler.Complete(playback.Instance.InstanceId);
            else _scheduler.Apply(playback.Instance.InstanceId, PerformanceCommand.CancelImmediate());
        }
        private void Notify() { _revision++; Changed?.Invoke(); }
    }

    internal sealed class PackageActionController
    {
        private readonly PerformanceScheduler _scheduler = new();
        private readonly string _prefix = Guid.NewGuid().ToString() + ":";
        private readonly Dictionary<string, PackageActionLayer> _layers = new(StringComparer.Ordinal);
        private readonly PackageActionLane[] _lanes;
        public PackageActionController()
        {
            _lanes = new PackageActionLane[3];
            for (var i = 0; i < _lanes.Length; i++)
            {
                var layer = (PackageActionLayer)i;
                _lanes[i] = new PackageActionLane(_scheduler, _prefix, layer);
                _lanes[i].Changed += () => { Revision++; LayerChanged?.Invoke(layer); Changed?.Invoke(); };
            }
        }
        public event Action Changed;
        public event Action<PackageActionLayer> LayerChanged;
        public PackageActionLane Lane(PackageActionLayer layer) => _lanes[(int)layer];
        public string CurrentActionId => _lanes[0].CurrentActionId;
        public string CurrentInstanceId => _lanes[0].CurrentInstanceId;
        public string ParentActionId => _lanes[0].ParentActionId;
        public PackageActionPhase Phase => _lanes[0].Phase;
        public float Time => _lanes[0].Time;
        public float BlendSeconds => _lanes[0].BlendSeconds;
        public ulong ActionSequence => _lanes[0].ActionSequence + _lanes[1].ActionSequence + _lanes[2].ActionSequence;
        public long Revision { get; private set; }
        public int ActiveCount => _scheduler.ActiveInstances.Count;
        public int QueuedCount => _scheduler.QueuedInstances.Count;
        public string Diagnostics => $"body[{_lanes[0].Diagnostics}]; upperBody[{_lanes[1].Diagnostics}]; head[{_lanes[2].Diagnostics}]";
        public void Add(PackageActionDefinition definition) { _layers.Add(definition.Id, definition.Layer); Lane(definition.Layer).Add(definition); }
        public bool Request(string id) => _layers.TryGetValue(id, out var layer) && Lane(layer).Request(id);
        public bool Finish(string id) => _layers.TryGetValue(id, out var layer) && Lane(layer).Finish(id);
        public bool CancelAction(string id) => _layers.TryGetValue(id, out var layer) && Lane(layer).CancelAction(id);
        public string InstanceFor(string id) => _layers.TryGetValue(id, out var layer) ? Lane(layer).InstanceFor(id) : null;
        public string ActionFor(string instanceId) { foreach (var id in _layers.Keys) if (InstanceFor(id) == instanceId) return id; return null; }
        public PerformanceInstanceState? GetState(string instanceId) => _lanes[0].GetState(instanceId);
        public void Cancel(bool notify = true) { foreach (var lane in _lanes) lane.Cancel(notify); }
        public void Tick(float deltaTime) { foreach (var lane in _lanes) lane.Tick(deltaTime); }
    }
}
