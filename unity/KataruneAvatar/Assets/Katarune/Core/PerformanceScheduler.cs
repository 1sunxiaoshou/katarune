using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;

namespace Katarune.Avatar
{
    public enum BehaviorRequestOutcome
    {
        Started,
        Queued,
        Rejected,
        Unavailable,
    }

    public readonly struct BehaviorRequestResult
    {
        internal BehaviorRequestResult(
            BehaviorRequestOutcome outcome,
            string instanceId = null,
            string error = null)
        {
            Outcome = outcome;
            InstanceId = instanceId;
            Error = error;
        }

        public BehaviorRequestOutcome Outcome { get; }
        public string InstanceId { get; }
        public string Error { get; }
    }

    public enum PerformanceRequestPolicy
    {
        Queue,
        Reject,
    }

    public enum PerformanceRequestOutcome
    {
        Started,
        Queued,
        Rejected,
    }

    public readonly struct PerformanceRequestResult
    {
        internal PerformanceRequestResult(
            PerformanceRequestOutcome outcome,
            PerformanceInstance instance,
            string error = null)
        {
            Outcome = outcome;
            Instance = instance;
            Error = error;
        }

        public PerformanceRequestOutcome Outcome { get; }
        public PerformanceInstance Instance { get; }
        public string Error { get; }
    }

    public readonly struct PerformanceChannelOwner : IEquatable<PerformanceChannelOwner>
    {
        internal PerformanceChannelOwner(string instanceId, PerformanceChannelClaim claim)
        {
            InstanceId = instanceId;
            Channel = claim.Channel;
            Occupancy = claim.Occupancy;
        }

        public string InstanceId { get; }
        public PerformanceChannel Channel { get; }
        public PerformanceChannelOccupancy Occupancy { get; }

        public bool Equals(PerformanceChannelOwner other) =>
            string.Equals(InstanceId, other.InstanceId, StringComparison.Ordinal)
            && Channel == other.Channel
            && Occupancy == other.Occupancy;

        public override bool Equals(object obj) => obj is PerformanceChannelOwner other && Equals(other);
        public override int GetHashCode() => HashCode.Combine(InstanceId, (int)Channel, (int)Occupancy);
    }

    /// <summary>
    /// Owns the authoritative channel grant table and instance lifecycle. Asset playback remains
    /// an adapter concern and reports completion or failure back to this scheduler.
    /// </summary>
    public sealed class PerformanceScheduler
    {
        private readonly List<PerformanceInstance> _instances = new List<PerformanceInstance>();
        private readonly List<PerformanceInstance> _active = new List<PerformanceInstance>();
        private readonly List<PerformanceInstance> _queued = new List<PerformanceInstance>();
        private readonly List<PerformanceChannelGrant> _grants = new List<PerformanceChannelGrant>();
        private readonly List<PerformanceChannelOwner> _owners = new List<PerformanceChannelOwner>();
        private readonly ReadOnlyCollection<PerformanceInstance> _instancesView;
        private readonly ReadOnlyCollection<PerformanceInstance> _activeView;
        private readonly ReadOnlyCollection<PerformanceInstance> _queuedView;
        private readonly ReadOnlyCollection<PerformanceChannelOwner> _ownersView;
        private long _sequence;

        public PerformanceScheduler()
        {
            _instancesView = _instances.AsReadOnly();
            _activeView = _active.AsReadOnly();
            _queuedView = _queued.AsReadOnly();
            _ownersView = _owners.AsReadOnly();
        }

        public event Action<PerformanceInstance> Started;
        public event Action<PerformanceInstance> Ended;
        public event Action Changed;

        public long Revision { get; private set; }
        public IReadOnlyList<PerformanceInstance> Instances => _instancesView;
        public IReadOnlyList<PerformanceInstance> ActiveInstances => _activeView;
        public IReadOnlyList<PerformanceInstance> QueuedInstances => _queuedView;
        public IReadOnlyList<PerformanceChannelOwner> ChannelOwners => _ownersView;

        public PerformanceRequestResult Submit(
            BehaviorIntent intent,
            BehaviorDefinition definition,
            PerformanceRequestPolicy policy = PerformanceRequestPolicy.Queue)
        {
            if (definition == null) throw new ArgumentNullException(nameof(definition));
            if (!Enum.IsDefined(typeof(PerformanceRequestPolicy), policy))
                throw new ArgumentOutOfRangeException(nameof(policy));
            if (!string.Equals(intent.BehaviorId, definition.DefinitionId, StringComparison.Ordinal))
            {
                return new PerformanceRequestResult(
                    PerformanceRequestOutcome.Rejected,
                    null,
                    $"Intent behavior '{intent.BehaviorId}' does not match definition '{definition.DefinitionId}'.");
            }

            var number = ++_sequence;
            var plan = new PerformancePlan($"plan-{number}", intent, definition);
            var instance = new PerformanceInstance($"instance-{number}", plan);
            _instances.Add(instance);

            if (CanGrant(instance))
            {
                Start(instance);
                return new PerformanceRequestResult(PerformanceRequestOutcome.Started, instance);
            }

            if (policy == PerformanceRequestPolicy.Reject)
            {
                _instances.Remove(instance);
                return new PerformanceRequestResult(
                    PerformanceRequestOutcome.Rejected,
                    null,
                    "One or more requested channels are currently unavailable.");
            }

            _queued.Add(instance);
            BumpRevision();
            return new PerformanceRequestResult(PerformanceRequestOutcome.Queued, instance);
        }

        public PerformanceTransitionOutcome Apply(string instanceId, PerformanceCommand command)
        {
            var instance = Find(instanceId);
            if (instance == null) return PerformanceTransitionOutcome.Rejected;

            var revision = instance.Revision;
            var result = instance.Apply(command);
            if (result != PerformanceTransitionOutcome.Applied) return result;

            if (instance.IsTerminal)
            {
                Finish(instance);
            }
            else if (instance.Revision != revision)
            {
                BumpRevision();
            }
            return result;
        }

        public PerformanceTransitionOutcome Complete(string instanceId)
        {
            var instance = Find(instanceId);
            if (instance == null) return PerformanceTransitionOutcome.Rejected;
            var result = instance.Complete();
            if (result == PerformanceTransitionOutcome.Applied) Finish(instance);
            return result;
        }

        public PerformanceTransitionOutcome Fail(string instanceId)
        {
            var instance = Find(instanceId);
            if (instance == null) return PerformanceTransitionOutcome.Rejected;
            var result = instance.Fail();
            if (result == PerformanceTransitionOutcome.Applied) Finish(instance);
            return result;
        }

        public PerformanceInstance Find(string instanceId)
        {
            if (string.IsNullOrWhiteSpace(instanceId)) return null;
            for (var index = 0; index < _instances.Count; index += 1)
            {
                if (string.Equals(_instances[index].InstanceId, instanceId, StringComparison.Ordinal))
                    return _instances[index];
            }
            return null;
        }

        private bool CanGrant(PerformanceInstance instance)
        {
            var claims = instance.Plan.ChannelClaims;
            for (var index = 0; index < claims.Count; index += 1)
            {
                if (!PerformanceChannelOwnershipPolicy.CanGrant(
                    _grants,
                    instance.InstanceId,
                    claims[index])) return false;
            }
            return true;
        }

        private void Start(PerformanceInstance instance)
        {
            if (instance.Accept() != PerformanceTransitionOutcome.Applied
                || instance.Start() != PerformanceTransitionOutcome.Applied)
                throw new InvalidOperationException("A queued performance could not enter Running state.");

            var claims = instance.Plan.ChannelClaims;
            for (var index = 0; index < claims.Count; index += 1)
            {
                _grants.Add(new PerformanceChannelGrant(instance.InstanceId, claims[index]));
                _owners.Add(new PerformanceChannelOwner(instance.InstanceId, claims[index]));
            }
            _active.Add(instance);
            BumpRevision();
            Started?.Invoke(instance);
        }

        private void Finish(PerformanceInstance instance)
        {
            _queued.Remove(instance);
            _active.Remove(instance);
            for (var index = _grants.Count - 1; index >= 0; index -= 1)
            {
                if (string.Equals(_grants[index].OwnerId, instance.InstanceId, StringComparison.Ordinal))
                    _grants.RemoveAt(index);
            }
            for (var index = _owners.Count - 1; index >= 0; index -= 1)
            {
                if (string.Equals(_owners[index].InstanceId, instance.InstanceId, StringComparison.Ordinal))
                    _owners.RemoveAt(index);
            }
            BumpRevision();
            Ended?.Invoke(instance);
            PromoteQueued();
        }

        private void PromoteQueued()
        {
            for (var index = 0; index < _queued.Count;)
            {
                var candidate = _queued[index];
                if (!CanGrant(candidate))
                {
                    index += 1;
                    continue;
                }

                _queued.RemoveAt(index);
                Start(candidate);
            }
        }

        private void BumpRevision()
        {
            Revision += 1;
            Changed?.Invoke();
        }
    }
}
