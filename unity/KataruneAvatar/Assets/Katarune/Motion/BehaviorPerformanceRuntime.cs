using System;
using System.Collections.Generic;
using System.Text;
using UnityEngine;

namespace Katarune.Avatar
{
    internal interface IBehaviorPerformanceSink
    {
        void Begin(string instanceId, BehaviorDefinitionAsset definition, float clipTime);
        void SetTime(string instanceId, float clipTime);
        void SetPaused(string instanceId, bool paused);
        void End(string instanceId, PerformanceEndReason reason);
    }

    internal sealed class BehaviorPerformanceRuntime : IDisposable
    {
        private readonly Dictionary<string, BehaviorDefinitionAsset> _definitions =
            new Dictionary<string, BehaviorDefinitionAsset>(StringComparer.Ordinal);
        private readonly Dictionary<string, PlaybackRecord> _records =
            new Dictionary<string, PlaybackRecord>(StringComparer.Ordinal);
        private readonly PerformanceScheduler _scheduler = new PerformanceScheduler();
        private readonly IBehaviorPerformanceSink _sink;
        private readonly CharacterRigCapabilities _capabilities;
        private bool _disposed;

        public BehaviorPerformanceRuntime(
            IReadOnlyList<BehaviorDefinitionAsset> definitions,
            CharacterRigCapabilities capabilities,
            IBehaviorPerformanceSink sink)
        {
            _sink = sink ?? throw new ArgumentNullException(nameof(sink));
            _capabilities = capabilities;
            if (definitions != null)
            {
                for (var index = 0; index < definitions.Count; index += 1)
                {
                    var definition = definitions[index];
                    if (definition == null) continue;
                    var validation = BehaviorDefinitionAssetValidator.Validate(definition, capabilities);
                    validation.ThrowIfInvalid();
                    if (_definitions.TryGetValue(definition.BehaviorId, out var installed))
                    {
                        if (installed.Version == definition.Version)
                        {
                            throw new InvalidOperationException(
                                $"Behavior '{definition.BehaviorId}' version {definition.Version} is installed more than once.");
                        }
                        if (installed.Version > definition.Version) continue;
                    }
                    _definitions[definition.BehaviorId] = definition;
                }
            }
            _scheduler.Started += OnStarted;
            _scheduler.Ended += OnEnded;
            _scheduler.Changed += OnChanged;
        }

        public event Action Changed;

        public PerformanceScheduler Scheduler => _scheduler;
        public bool ContainsDefinition(string behaviorId) =>
            !string.IsNullOrWhiteSpace(behaviorId) && _definitions.ContainsKey(behaviorId);

        public bool ClaimsBodyChannel(string behaviorId)
        {
            if (!_definitions.TryGetValue(behaviorId, out var definition)) return false;
            for (var index = 0; index < definition.ChannelClaims.Count; index += 1)
            {
                var channel = definition.ChannelClaims[index].Channel;
                if (channel == PerformanceChannel.BodyBase
                    || channel == PerformanceChannel.BodyFullPerformance
                    || channel == PerformanceChannel.GestureUpperBody) return true;
            }
            return false;
        }

        public BehaviorRequestResult Request(
            BehaviorIntent intent,
            PerformanceRequestPolicy policy = PerformanceRequestPolicy.Queue)
        {
            ThrowIfDisposed();
            if (!_definitions.TryGetValue(intent.BehaviorId, out var asset))
            {
                return new BehaviorRequestResult(
                    BehaviorRequestOutcome.Unavailable,
                    error: $"Behavior '{intent.BehaviorId}' is not installed.");
            }

            var validation = BehaviorDefinitionAssetValidator.Validate(asset, _capabilities);
            if (!validation.IsValid)
            {
                return new BehaviorRequestResult(
                    BehaviorRequestOutcome.Unavailable,
                    error: validation.Errors[0].Message);
            }

            var result = _scheduler.Submit(intent, asset.CreateDomainDefinition(), policy);
            if (result.Instance != null
                && result.Instance.State == PerformanceInstanceState.Failed)
            {
                return new BehaviorRequestResult(
                    BehaviorRequestOutcome.Rejected,
                    result.Instance.InstanceId,
                    "The Unity playback adapter failed to start the behavior.");
            }
            var outcome = result.Outcome == PerformanceRequestOutcome.Started
                ? BehaviorRequestOutcome.Started
                : result.Outcome == PerformanceRequestOutcome.Queued
                    ? BehaviorRequestOutcome.Queued
                    : BehaviorRequestOutcome.Rejected;
            return new BehaviorRequestResult(outcome, result.Instance?.InstanceId, result.Error);
        }

        public PerformanceTransitionOutcome Apply(string instanceId, PerformanceCommand command)
        {
            ThrowIfDisposed();
            var result = _scheduler.Apply(instanceId, command);
            if (result != PerformanceTransitionOutcome.Applied) return result;
            if (!_records.TryGetValue(instanceId, out var record)) return result;
            if (command.Kind == PerformanceCommandKind.Pause) _sink.SetPaused(instanceId, true);
            if (command.Kind == PerformanceCommandKind.Resume) _sink.SetPaused(instanceId, false);
            return result;
        }

        public void Tick(float deltaTime)
        {
            ThrowIfDisposed();
            deltaTime = Mathf.Max(0f, deltaTime);
            if (deltaTime <= 0f) return;

            var active = _scheduler.ActiveInstances;
            for (var index = active.Count - 1; index >= 0; index -= 1)
            {
                var instance = active[index];
                if (instance.State == PerformanceInstanceState.Paused) continue;
                if (!_records.TryGetValue(instance.InstanceId, out var record)) continue;

                var sample = record.Cursor.Advance(
                    deltaTime,
                    instance.State == PerformanceInstanceState.Exiting);
                _sink.SetTime(instance.InstanceId, sample.ClipTime);
                var diagnosticsChanged = record.Phase != sample.Phase
                    || record.SyncPoint != sample.SyncPoint;
                record.Phase = sample.Phase;
                record.SyncPoint = sample.SyncPoint;
                if (sample.Completed) _scheduler.Complete(instance.InstanceId);
                else if (diagnosticsChanged) Changed?.Invoke();
            }
        }

        public string FormatDiagnostics()
        {
            var builder = new StringBuilder();
            builder.Append("performance revision=").Append(_scheduler.Revision);
            var instances = _scheduler.Instances;
            for (var index = 0; index < instances.Count; index += 1)
            {
                var instance = instances[index];
                builder.Append("\n").Append(instance.InstanceId)
                    .Append(" behavior=").Append(instance.Plan.DefinitionId)
                    .Append(" state=").Append(instance.State);
                if (_records.TryGetValue(instance.InstanceId, out var record))
                {
                    builder.Append(" phase=").Append(record.Phase);
                    if (!string.IsNullOrWhiteSpace(record.SyncPoint))
                        builder.Append(" sync=").Append(record.SyncPoint);
                }
                if (instance.IsTerminal) builder.Append(" end=").Append(instance.EndReason);
            }
            var owners = _scheduler.ChannelOwners;
            for (var index = 0; index < owners.Count; index += 1)
            {
                builder.Append("\nchannel=").Append(owners[index].Channel)
                    .Append(" owner=").Append(owners[index].InstanceId)
                    .Append(" occupancy=").Append(owners[index].Occupancy);
            }
            return builder.ToString();
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            _scheduler.Started -= OnStarted;
            _scheduler.Ended -= OnEnded;
            _scheduler.Changed -= OnChanged;
            foreach (var pair in _records)
                _sink.End(pair.Key, PerformanceEndReason.CancelledImmediate);
            _records.Clear();
        }

        private void OnStarted(PerformanceInstance instance)
        {
            if (!_definitions.TryGetValue(instance.Plan.DefinitionId, out var asset))
            {
                _scheduler.Fail(instance.InstanceId);
                return;
            }

            try
            {
                var cursor = new BehaviorPlaybackCursor(asset);
                var record = new PlaybackRecord(cursor);
                _records[instance.InstanceId] = record;
                _sink.Begin(instance.InstanceId, asset, cursor.Current.ClipTime);
                Changed?.Invoke();
            }
            catch (Exception error)
            {
                Debug.LogException(error);
                _scheduler.Fail(instance.InstanceId);
            }
        }

        private void OnEnded(PerformanceInstance instance)
        {
            if (_records.Remove(instance.InstanceId))
            {
                _sink.End(instance.InstanceId, instance.EndReason);
                Changed?.Invoke();
            }
        }

        private void OnChanged() => Changed?.Invoke();

        private void ThrowIfDisposed()
        {
            if (_disposed) throw new ObjectDisposedException(nameof(BehaviorPerformanceRuntime));
        }

        private sealed class PlaybackRecord
        {
            public PlaybackRecord(BehaviorPlaybackCursor cursor)
            {
                Cursor = cursor;
                Phase = cursor.Current.Phase;
            }

            public BehaviorPlaybackCursor Cursor { get; }
            public string Phase { get; set; }
            public string SyncPoint { get; set; }
        }
    }

    internal readonly struct BehaviorPlaybackSample
    {
        public BehaviorPlaybackSample(float clipTime, string phase, string syncPoint, bool completed)
        {
            ClipTime = clipTime;
            Phase = phase;
            SyncPoint = syncPoint;
            Completed = completed;
        }

        public float ClipTime { get; }
        public string Phase { get; }
        public string SyncPoint { get; }
        public bool Completed { get; }
    }

    internal sealed class BehaviorPlaybackCursor
    {
        private readonly BehaviorDefinitionAsset _definition;
        private SegmentKind _segment;
        private float _segmentElapsed;
        private int _completedLoops;
        private bool _waitingForNaturalExitSync;

        public BehaviorPlaybackCursor(BehaviorDefinitionAsset definition)
        {
            _definition = definition ?? throw new ArgumentNullException(nameof(definition));
            _segment = definition.Entry != null
                ? SegmentKind.Entry
                : definition.Loop != null ? SegmentKind.Loop : SegmentKind.Exit;
            Current = Sample();
        }

        public BehaviorPlaybackSample Current { get; private set; }

        public BehaviorPlaybackSample Advance(float deltaTime, bool exitRequested)
        {
            var remaining = Mathf.Max(0f, deltaTime);
            var syncPoint = string.Empty;
            while (remaining > 0f && _segment != SegmentKind.Completed)
            {
                if (_segment == SegmentKind.Loop && ShouldExitAtSync(exitRequested, out var point))
                {
                    var loop = _definition.Loop;
                    var offset = point.TimeSeconds - loop.StartSeconds;
                    var toSync = offset >= _segmentElapsed
                        ? offset - _segmentElapsed
                        : SegmentDuration(loop) - _segmentElapsed + offset;
                    if (remaining >= toSync)
                    {
                        remaining -= toSync;
                        _segmentElapsed = offset;
                        syncPoint = point.Name;
                        EnterExitOrComplete();
                        continue;
                    }
                }

                var duration = CurrentSegmentDuration();
                var step = Mathf.Min(remaining, Mathf.Max(0f, duration - _segmentElapsed));
                _segmentElapsed += step;
                remaining -= step;
                if (_segmentElapsed + 0.0001f < duration) break;
                AdvanceSegment();
            }

            Current = Sample(syncPoint);
            return Current;
        }

        private bool ShouldExitAtSync(bool exitRequested, out BehaviorSyncPoint point)
        {
            if (!_definition.TryGetExitSyncPoint(out point)) return false;
            return exitRequested || _waitingForNaturalExitSync;
        }

        private void AdvanceSegment()
        {
            _segmentElapsed = 0f;
            switch (_segment)
            {
                case SegmentKind.Entry:
                    _segment = _definition.Loop != null
                        ? SegmentKind.Loop
                        : _definition.Exit != null ? SegmentKind.Exit : SegmentKind.Completed;
                    break;
                case SegmentKind.Loop:
                    _completedLoops += 1;
                    if (_definition.LoopIterations > 0
                        && _completedLoops >= _definition.LoopIterations)
                    {
                        if (_definition.TryGetExitSyncPoint(out _))
                            _waitingForNaturalExitSync = true;
                        else
                            EnterExitOrComplete();
                    }
                    break;
                case SegmentKind.Exit:
                    _segment = SegmentKind.Completed;
                    break;
            }
        }

        private void EnterExitOrComplete()
        {
            _segmentElapsed = 0f;
            _segment = _definition.Exit != null ? SegmentKind.Exit : SegmentKind.Completed;
        }

        private float CurrentSegmentDuration()
        {
            switch (_segment)
            {
                case SegmentKind.Entry: return SegmentDuration(_definition.Entry);
                case SegmentKind.Loop: return SegmentDuration(_definition.Loop);
                case SegmentKind.Exit: return SegmentDuration(_definition.Exit);
                default: return 0f;
            }
        }

        private BehaviorPlaybackSample Sample(string syncPoint = "")
        {
            float clipTime;
            string phase;
            switch (_segment)
            {
                case SegmentKind.Entry:
                    clipTime = _definition.Entry.StartSeconds + _segmentElapsed;
                    phase = "entry";
                    break;
                case SegmentKind.Loop:
                    clipTime = _definition.Loop.StartSeconds + _segmentElapsed;
                    phase = "loop";
                    break;
                case SegmentKind.Exit:
                    clipTime = _definition.Exit.StartSeconds + _segmentElapsed;
                    phase = "exit";
                    break;
                default:
                    clipTime = _definition.Exit?.EndSeconds
                        ?? _definition.Loop?.EndSeconds
                        ?? _definition.Entry?.EndSeconds
                        ?? 0f;
                    phase = "completed";
                    break;
            }
            return new BehaviorPlaybackSample(
                clipTime,
                phase,
                syncPoint,
                _segment == SegmentKind.Completed);
        }

        private static float SegmentDuration(BehaviorClipSegment segment) =>
            segment == null ? 0f : segment.EndSeconds - segment.StartSeconds;

        private enum SegmentKind
        {
            Entry,
            Loop,
            Exit,
            Completed,
        }
    }
}
