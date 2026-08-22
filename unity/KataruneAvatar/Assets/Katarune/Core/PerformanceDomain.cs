using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;

namespace Katarune.Avatar
{
    public enum BehaviorIntentSource
    {
        Application,
        AiSuggestion,
        User,
        Policy,
    }

    public enum PerformanceChannel
    {
        BodyBase,
        BodyFullPerformance,
        GestureUpperBody,
        FaceExpression,
        AttentionGaze,
        SpeechViseme,
    }

    public enum PerformanceChannelOccupancy
    {
        Exclusive,
        Shared,
        Additive,
    }

    [Flags]
    public enum PerformanceControlCapabilities
    {
        None = 0,
        SafePointExit = 1 << 0,
        Pause = 1 << 1,
        ChannelUpdate = 1 << 2,
    }

    public enum PerformanceInstanceState
    {
        Requested,
        Accepted,
        Running,
        Paused,
        Exiting,
        Completed,
        Cancelled,
        Failed,
    }

    public enum PerformanceEndReason
    {
        None,
        Completed,
        ExitedAtSafePoint,
        CancelledImmediate,
        Failed,
    }

    public enum PerformanceCommandKind
    {
        Unknown,
        CancelImmediate,
        ExitAtSafePoint,
        Pause,
        Resume,
        UpdateChannels,
    }

    public enum PerformanceTransitionOutcome
    {
        Applied,
        AlreadyTerminal,
        Rejected,
        Unsupported,
    }

    public static class PerformanceInstanceStateExtensions
    {
        public static bool IsTerminal(this PerformanceInstanceState state)
        {
            return state == PerformanceInstanceState.Completed
                || state == PerformanceInstanceState.Cancelled
                || state == PerformanceInstanceState.Failed;
        }
    }

    public readonly struct BehaviorIntent : IEquatable<BehaviorIntent>
    {
        public BehaviorIntent(
            string intentId,
            string behaviorId,
            BehaviorIntentSource source)
        {
            IntentId = PerformanceDomainValidation.RequireIdentifier(intentId, nameof(intentId));
            BehaviorId = PerformanceDomainValidation.RequireIdentifier(behaviorId, nameof(behaviorId));
            Source = source;
        }

        public string IntentId { get; }
        public string BehaviorId { get; }
        public BehaviorIntentSource Source { get; }

        public bool Equals(BehaviorIntent other)
        {
            return string.Equals(IntentId, other.IntentId, StringComparison.Ordinal)
                && string.Equals(BehaviorId, other.BehaviorId, StringComparison.Ordinal)
                && Source == other.Source;
        }

        public override bool Equals(object obj) => obj is BehaviorIntent other && Equals(other);
        public override int GetHashCode() => HashCode.Combine(IntentId, BehaviorId, (int)Source);
    }

    public readonly struct PerformanceChannelClaim : IEquatable<PerformanceChannelClaim>
    {
        public PerformanceChannelClaim(
            PerformanceChannel channel,
            PerformanceChannelOccupancy occupancy)
        {
            if (!Enum.IsDefined(typeof(PerformanceChannel), channel))
                throw new ArgumentOutOfRangeException(nameof(channel));
            if (!Enum.IsDefined(typeof(PerformanceChannelOccupancy), occupancy))
                throw new ArgumentOutOfRangeException(nameof(occupancy));

            Channel = channel;
            Occupancy = occupancy;
        }

        public PerformanceChannel Channel { get; }
        public PerformanceChannelOccupancy Occupancy { get; }

        public bool Equals(PerformanceChannelClaim other) =>
            Channel == other.Channel && Occupancy == other.Occupancy;

        public override bool Equals(object obj) => obj is PerformanceChannelClaim other && Equals(other);
        public override int GetHashCode() => HashCode.Combine((int)Channel, (int)Occupancy);
    }

    public sealed class BehaviorDefinition
    {
        private readonly ReadOnlyCollection<PerformanceChannelClaim> _channelClaims;

        public BehaviorDefinition(
            string definitionId,
            IReadOnlyList<PerformanceChannelClaim> channelClaims,
            PerformanceControlCapabilities controlCapabilities = PerformanceControlCapabilities.None)
        {
            DefinitionId = PerformanceDomainValidation.RequireIdentifier(definitionId, nameof(definitionId));
            _channelClaims = PerformanceDomainValidation.CopyClaims(channelClaims, nameof(channelClaims));
            ControlCapabilities = controlCapabilities;
        }

        public string DefinitionId { get; }
        public IReadOnlyList<PerformanceChannelClaim> ChannelClaims => _channelClaims;
        public PerformanceControlCapabilities ControlCapabilities { get; }
    }

    public sealed class PerformancePlan
    {
        private readonly ReadOnlyCollection<PerformanceChannelClaim> _channelClaims;

        internal PerformancePlan(
            string planId,
            BehaviorIntent intent,
            BehaviorDefinition definition)
        {
            if (definition == null) throw new ArgumentNullException(nameof(definition));

            PlanId = PerformanceDomainValidation.RequireIdentifier(planId, nameof(planId));
            IntentId = PerformanceDomainValidation.RequireIdentifier(intent.IntentId, nameof(intent));
            DefinitionId = definition.DefinitionId;
            _channelClaims = PerformanceDomainValidation.CopyClaims(
                definition.ChannelClaims,
                nameof(definition));
            ControlCapabilities = definition.ControlCapabilities;
        }

        public string PlanId { get; }
        public string IntentId { get; }
        public string DefinitionId { get; }
        public IReadOnlyList<PerformanceChannelClaim> ChannelClaims => _channelClaims;
        public PerformanceControlCapabilities ControlCapabilities { get; }

        public bool Claims(PerformanceChannel channel)
        {
            for (var index = 0; index < _channelClaims.Count; index += 1)
            {
                if (_channelClaims[index].Channel == channel) return true;
            }

            return false;
        }
    }

    public readonly struct PerformanceCommand
    {
        private static readonly IReadOnlyList<PerformanceChannel> NoChannels =
            Array.AsReadOnly(Array.Empty<PerformanceChannel>());

        private PerformanceCommand(
            PerformanceCommandKind kind,
            IReadOnlyList<PerformanceChannel> channels)
        {
            Kind = kind;
            Channels = channels;
        }

        public PerformanceCommandKind Kind { get; }
        public IReadOnlyList<PerformanceChannel> Channels { get; }

        public static PerformanceCommand CancelImmediate() =>
            new PerformanceCommand(PerformanceCommandKind.CancelImmediate, NoChannels);

        public static PerformanceCommand ExitAtSafePoint() =>
            new PerformanceCommand(PerformanceCommandKind.ExitAtSafePoint, NoChannels);

        public static PerformanceCommand Pause() =>
            new PerformanceCommand(PerformanceCommandKind.Pause, NoChannels);

        public static PerformanceCommand Resume() =>
            new PerformanceCommand(PerformanceCommandKind.Resume, NoChannels);

        public static PerformanceCommand UpdateChannels(params PerformanceChannel[] channels) =>
            new PerformanceCommand(
                PerformanceCommandKind.UpdateChannels,
                PerformanceDomainValidation.CopyChannels(channels, nameof(channels)));
    }

    public sealed class PerformanceInstance
    {
        internal PerformanceInstance(string instanceId, PerformancePlan plan)
        {
            InstanceId = PerformanceDomainValidation.RequireIdentifier(instanceId, nameof(instanceId));
            Plan = plan ?? throw new ArgumentNullException(nameof(plan));
            State = PerformanceInstanceState.Requested;
            EndReason = PerformanceEndReason.None;
        }

        public string InstanceId { get; }
        public PerformancePlan Plan { get; }
        public PerformanceInstanceState State { get; private set; }
        public PerformanceEndReason EndReason { get; private set; }
        public long Revision { get; private set; }
        public bool IsTerminal => State.IsTerminal();

        public PerformanceTransitionOutcome Accept()
        {
            if (IsTerminal) return PerformanceTransitionOutcome.AlreadyTerminal;
            if (State != PerformanceInstanceState.Requested)
                return PerformanceTransitionOutcome.Rejected;

            return TransitionTo(PerformanceInstanceState.Accepted);
        }

        public PerformanceTransitionOutcome Start()
        {
            if (IsTerminal) return PerformanceTransitionOutcome.AlreadyTerminal;
            if (State != PerformanceInstanceState.Accepted)
                return PerformanceTransitionOutcome.Rejected;

            return TransitionTo(PerformanceInstanceState.Running);
        }

        public PerformanceTransitionOutcome Complete()
        {
            if (IsTerminal) return PerformanceTransitionOutcome.AlreadyTerminal;
            if (State != PerformanceInstanceState.Running
                && State != PerformanceInstanceState.Exiting)
                return PerformanceTransitionOutcome.Rejected;

            var reason = State == PerformanceInstanceState.Exiting
                ? PerformanceEndReason.ExitedAtSafePoint
                : PerformanceEndReason.Completed;
            return End(PerformanceInstanceState.Completed, reason);
        }

        public PerformanceTransitionOutcome Fail()
        {
            if (IsTerminal) return PerformanceTransitionOutcome.AlreadyTerminal;
            return End(PerformanceInstanceState.Failed, PerformanceEndReason.Failed);
        }

        public PerformanceTransitionOutcome Apply(PerformanceCommand command)
        {
            if (IsTerminal) return PerformanceTransitionOutcome.AlreadyTerminal;

            switch (command.Kind)
            {
                case PerformanceCommandKind.CancelImmediate:
                    return End(
                        PerformanceInstanceState.Cancelled,
                        PerformanceEndReason.CancelledImmediate);
                case PerformanceCommandKind.ExitAtSafePoint:
                    return RequestSafePointExit();
                case PerformanceCommandKind.Pause:
                    return Pause();
                case PerformanceCommandKind.Resume:
                    return Resume();
                case PerformanceCommandKind.UpdateChannels:
                    return UpdateChannels(command.Channels);
                default:
                    return PerformanceTransitionOutcome.Rejected;
            }
        }

        private PerformanceTransitionOutcome RequestSafePointExit()
        {
            if (!Supports(PerformanceControlCapabilities.SafePointExit))
                return PerformanceTransitionOutcome.Unsupported;
            if (State != PerformanceInstanceState.Running)
                return PerformanceTransitionOutcome.Rejected;

            return TransitionTo(PerformanceInstanceState.Exiting);
        }

        private PerformanceTransitionOutcome Pause()
        {
            if (!Supports(PerformanceControlCapabilities.Pause))
                return PerformanceTransitionOutcome.Unsupported;
            if (State != PerformanceInstanceState.Running)
                return PerformanceTransitionOutcome.Rejected;

            return TransitionTo(PerformanceInstanceState.Paused);
        }

        private PerformanceTransitionOutcome Resume()
        {
            if (!Supports(PerformanceControlCapabilities.Pause))
                return PerformanceTransitionOutcome.Unsupported;
            if (State != PerformanceInstanceState.Paused)
                return PerformanceTransitionOutcome.Rejected;

            return TransitionTo(PerformanceInstanceState.Running);
        }

        private PerformanceTransitionOutcome UpdateChannels(IReadOnlyList<PerformanceChannel> channels)
        {
            if (!Supports(PerformanceControlCapabilities.ChannelUpdate))
                return PerformanceTransitionOutcome.Unsupported;
            if (State != PerformanceInstanceState.Running
                && State != PerformanceInstanceState.Paused)
                return PerformanceTransitionOutcome.Rejected;
            if (channels == null || channels.Count == 0)
                return PerformanceTransitionOutcome.Rejected;

            for (var index = 0; index < channels.Count; index += 1)
            {
                if (!Plan.Claims(channels[index])) return PerformanceTransitionOutcome.Rejected;
            }

            Revision += 1;
            return PerformanceTransitionOutcome.Applied;
        }

        private bool Supports(PerformanceControlCapabilities capability) =>
            (Plan.ControlCapabilities & capability) != 0;

        private PerformanceTransitionOutcome TransitionTo(PerformanceInstanceState state)
        {
            State = state;
            Revision += 1;
            return PerformanceTransitionOutcome.Applied;
        }

        private PerformanceTransitionOutcome End(
            PerformanceInstanceState state,
            PerformanceEndReason reason)
        {
            State = state;
            EndReason = reason;
            Revision += 1;
            return PerformanceTransitionOutcome.Applied;
        }
    }

    internal readonly struct PerformanceChannelGrant
    {
        public PerformanceChannelGrant(string ownerId, PerformanceChannelClaim claim)
        {
            OwnerId = PerformanceDomainValidation.RequireIdentifier(ownerId, nameof(ownerId));
            Claim = claim;
        }

        public string OwnerId { get; }
        public PerformanceChannelClaim Claim { get; }
    }

    internal static class PerformanceChannelOwnershipPolicy
    {
        public static bool CanGrant(
            IReadOnlyList<PerformanceChannelGrant> activeGrants,
            string candidateOwnerId,
            PerformanceChannelClaim candidate)
        {
            if (activeGrants == null) throw new ArgumentNullException(nameof(activeGrants));
            PerformanceDomainValidation.RequireIdentifier(candidateOwnerId, nameof(candidateOwnerId));

            for (var index = 0; index < activeGrants.Count; index += 1)
            {
                var active = activeGrants[index];
                if (active.Claim.Channel != candidate.Channel
                    || string.Equals(active.OwnerId, candidateOwnerId, StringComparison.Ordinal))
                    continue;

                if (active.Claim.Occupancy == PerformanceChannelOccupancy.Exclusive
                    || candidate.Occupancy == PerformanceChannelOccupancy.Exclusive)
                    return false;
            }

            return true;
        }
    }

    internal static class PerformanceDomainValidation
    {
        public static string RequireIdentifier(string value, string parameterName)
        {
            if (string.IsNullOrWhiteSpace(value))
                throw new ArgumentException("A non-empty identifier is required.", parameterName);
            return value;
        }

        public static ReadOnlyCollection<PerformanceChannelClaim> CopyClaims(
            IReadOnlyList<PerformanceChannelClaim> claims,
            string parameterName)
        {
            if (claims == null) throw new ArgumentNullException(parameterName);
            if (claims.Count == 0)
                throw new ArgumentException("At least one channel claim is required.", parameterName);

            var copy = new PerformanceChannelClaim[claims.Count];
            var seen = new HashSet<PerformanceChannel>();
            for (var index = 0; index < claims.Count; index += 1)
            {
                var claim = claims[index];
                if (!seen.Add(claim.Channel))
                    throw new ArgumentException(
                        $"Channel '{claim.Channel}' can only be claimed once.",
                        parameterName);
                copy[index] = claim;
            }

            return Array.AsReadOnly(copy);
        }

        public static ReadOnlyCollection<PerformanceChannel> CopyChannels(
            IReadOnlyList<PerformanceChannel> channels,
            string parameterName)
        {
            if (channels == null) throw new ArgumentNullException(parameterName);
            if (channels.Count == 0)
                throw new ArgumentException("At least one channel is required.", parameterName);

            var copy = new PerformanceChannel[channels.Count];
            var seen = new HashSet<PerformanceChannel>();
            for (var index = 0; index < channels.Count; index += 1)
            {
                var channel = channels[index];
                if (!Enum.IsDefined(typeof(PerformanceChannel), channel))
                    throw new ArgumentOutOfRangeException(parameterName);
                if (!seen.Add(channel))
                    throw new ArgumentException(
                        $"Channel '{channel}' can only be updated once.",
                        parameterName);
                copy[index] = channel;
            }

            return Array.AsReadOnly(copy);
        }
    }
}
