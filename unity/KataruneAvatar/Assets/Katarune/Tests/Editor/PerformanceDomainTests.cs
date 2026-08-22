using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using NUnit.Framework;

namespace Katarune.Avatar.Tests
{
    public sealed class PerformanceDomainTests
    {
        private static readonly PerformanceChannelClaim BodyBaseShared = new PerformanceChannelClaim(
            PerformanceChannel.BodyBase,
            PerformanceChannelOccupancy.Shared);

        private static readonly PerformanceChannelClaim FullBodyExclusive = new PerformanceChannelClaim(
            PerformanceChannel.BodyFullPerformance,
            PerformanceChannelOccupancy.Exclusive);

        [Test]
        public void FirstVersionDefinesExactlySixSemanticChannels()
        {
            Assert.That(Enum.GetValues(typeof(PerformanceChannel)), Is.EquivalentTo(new[]
            {
                PerformanceChannel.BodyBase,
                PerformanceChannel.BodyFullPerformance,
                PerformanceChannel.GestureUpperBody,
                PerformanceChannel.FaceExpression,
                PerformanceChannel.AttentionGaze,
                PerformanceChannel.SpeechViseme,
            }));
            Assert.That(Enum.GetValues(typeof(PerformanceChannelOccupancy)), Is.EquivalentTo(new[]
            {
                PerformanceChannelOccupancy.Exclusive,
                PerformanceChannelOccupancy.Shared,
                PerformanceChannelOccupancy.Additive,
            }));
        }

        [Test]
        public void IntentDefinitionPlanAndInstanceKeepSeparateResponsibilities()
        {
            var sourceClaims = new[] { BodyBaseShared };
            var intent = new BehaviorIntent("intent-1", "explain", BehaviorIntentSource.User);
            var definition = new BehaviorDefinition(
                "explain.standard",
                sourceClaims,
                PerformanceControlCapabilities.Pause);
            var plan = new PerformancePlan("plan-1", intent, definition);
            var instance = new PerformanceInstance("instance-1", plan);

            sourceClaims[0] = FullBodyExclusive;

            Assert.That(intent.BehaviorId, Is.EqualTo("explain"));
            Assert.That(definition.ChannelClaims, Is.EqualTo(new[] { BodyBaseShared }));
            Assert.That(plan.IntentId, Is.EqualTo(intent.IntentId));
            Assert.That(plan.DefinitionId, Is.EqualTo(definition.DefinitionId));
            Assert.That(instance.Plan, Is.SameAs(plan));
            Assert.That(instance.State, Is.EqualTo(PerformanceInstanceState.Requested));
        }

        [Test]
        public void DefinitionRejectsDuplicateChannelClaims()
        {
            Assert.Throws<ArgumentException>(() => new BehaviorDefinition(
                "invalid",
                new[]
                {
                    BodyBaseShared,
                    new PerformanceChannelClaim(
                        PerformanceChannel.BodyBase,
                        PerformanceChannelOccupancy.Additive),
                }));
        }

        [Test]
        public void ExclusiveChannelCanOnlyHaveOneOwnerAtATime()
        {
            var active = new[]
            {
                new PerformanceChannelGrant("owner-a", FullBodyExclusive),
            };

            Assert.That(PerformanceChannelOwnershipPolicy.CanGrant(
                active,
                "owner-b",
                new PerformanceChannelClaim(
                    PerformanceChannel.BodyFullPerformance,
                    PerformanceChannelOccupancy.Shared)), Is.False);
            Assert.That(PerformanceChannelOwnershipPolicy.CanGrant(
                active,
                "owner-a",
                FullBodyExclusive), Is.True);
            Assert.That(PerformanceChannelOwnershipPolicy.CanGrant(
                active,
                "owner-b",
                BodyBaseShared), Is.True);
        }

        [Test]
        public void ExclusiveRequestCannotPreemptExistingSharedOwnerWithoutArbitration()
        {
            var active = new[]
            {
                new PerformanceChannelGrant(
                    "owner-a",
                    new PerformanceChannelClaim(
                        PerformanceChannel.FaceExpression,
                        PerformanceChannelOccupancy.Shared)),
            };

            Assert.That(PerformanceChannelOwnershipPolicy.CanGrant(
                active,
                "owner-b",
                new PerformanceChannelClaim(
                    PerformanceChannel.FaceExpression,
                    PerformanceChannelOccupancy.Exclusive)), Is.False);
        }

        [TestCase(PerformanceInstanceState.Completed)]
        [TestCase(PerformanceInstanceState.Cancelled)]
        [TestCase(PerformanceInstanceState.Failed)]
        public void EveryTerminalStateIsRecognized(PerformanceInstanceState state)
        {
            Assert.That(state.IsTerminal(), Is.True);
        }

        [TestCase(PerformanceInstanceState.Requested)]
        [TestCase(PerformanceInstanceState.Accepted)]
        [TestCase(PerformanceInstanceState.Running)]
        [TestCase(PerformanceInstanceState.Paused)]
        [TestCase(PerformanceInstanceState.Exiting)]
        public void NonTerminalStatesAreNotMisclassified(PerformanceInstanceState state)
        {
            Assert.That(state.IsTerminal(), Is.False);
        }

        [Test]
        public void ImmediateCancellationIsTerminalAndIdempotent()
        {
            var instance = CreateRunningInstance();

            var first = instance.Apply(PerformanceCommand.CancelImmediate());
            var terminalRevision = instance.Revision;
            var second = instance.Apply(PerformanceCommand.CancelImmediate());

            Assert.That(first, Is.EqualTo(PerformanceTransitionOutcome.Applied));
            Assert.That(second, Is.EqualTo(PerformanceTransitionOutcome.AlreadyTerminal));
            Assert.That(instance.State, Is.EqualTo(PerformanceInstanceState.Cancelled));
            Assert.That(instance.EndReason, Is.EqualTo(PerformanceEndReason.CancelledImmediate));
            Assert.That(instance.Revision, Is.EqualTo(terminalRevision));
            Assert.That(instance.Start(), Is.EqualTo(PerformanceTransitionOutcome.AlreadyTerminal));
            Assert.That(instance.Revision, Is.EqualTo(terminalRevision));
        }

        [Test]
        public void SafeExitPauseResumeAndChannelUpdateHaveDistinctSemantics()
        {
            var capabilities = PerformanceControlCapabilities.SafePointExit
                | PerformanceControlCapabilities.Pause
                | PerformanceControlCapabilities.ChannelUpdate;
            var instance = CreateRunningInstance(capabilities);

            Assert.That(instance.Apply(PerformanceCommand.UpdateChannels(
                PerformanceChannel.BodyBase)), Is.EqualTo(PerformanceTransitionOutcome.Applied));
            Assert.That(instance.State, Is.EqualTo(PerformanceInstanceState.Running));

            Assert.That(instance.Apply(PerformanceCommand.Pause()),
                Is.EqualTo(PerformanceTransitionOutcome.Applied));
            Assert.That(instance.State, Is.EqualTo(PerformanceInstanceState.Paused));

            Assert.That(instance.Apply(PerformanceCommand.Resume()),
                Is.EqualTo(PerformanceTransitionOutcome.Applied));
            Assert.That(instance.State, Is.EqualTo(PerformanceInstanceState.Running));

            Assert.That(instance.Apply(PerformanceCommand.ExitAtSafePoint()),
                Is.EqualTo(PerformanceTransitionOutcome.Applied));
            Assert.That(instance.State, Is.EqualTo(PerformanceInstanceState.Exiting));
            Assert.That(instance.Complete(), Is.EqualTo(PerformanceTransitionOutcome.Applied));
            Assert.That(instance.State, Is.EqualTo(PerformanceInstanceState.Completed));
            Assert.That(instance.EndReason, Is.EqualTo(PerformanceEndReason.ExitedAtSafePoint));
        }

        [Test]
        public void IllegalTransitionsAndUnsupportedCommandsAreRejectedWithoutMutation()
        {
            var instance = CreateInstance(PerformanceControlCapabilities.None);

            Assert.That(instance.Start(), Is.EqualTo(PerformanceTransitionOutcome.Rejected));
            Assert.That(instance.Complete(), Is.EqualTo(PerformanceTransitionOutcome.Rejected));
            Assert.That(instance.Apply(default), Is.EqualTo(PerformanceTransitionOutcome.Rejected));
            Assert.That(instance.Revision, Is.Zero);

            Assert.That(instance.Accept(), Is.EqualTo(PerformanceTransitionOutcome.Applied));
            Assert.That(instance.Apply(PerformanceCommand.Pause()),
                Is.EqualTo(PerformanceTransitionOutcome.Unsupported));
            Assert.That(instance.Complete(), Is.EqualTo(PerformanceTransitionOutcome.Rejected));
            Assert.That(instance.State, Is.EqualTo(PerformanceInstanceState.Accepted));
            Assert.That(instance.Revision, Is.EqualTo(1));
        }

        [Test]
        public void ChannelUpdatesCannotTargetChannelsOutsideThePlan()
        {
            var instance = CreateRunningInstance(PerformanceControlCapabilities.ChannelUpdate);
            var revision = instance.Revision;

            var result = instance.Apply(PerformanceCommand.UpdateChannels(
                PerformanceChannel.AttentionGaze));

            Assert.That(result, Is.EqualTo(PerformanceTransitionOutcome.Rejected));
            Assert.That(instance.Revision, Is.EqualTo(revision));
            Assert.That(instance.State, Is.EqualTo(PerformanceInstanceState.Running));
        }

        [Test]
        public void FailureIsTerminalAndCannotBeCompletedLater()
        {
            var instance = CreateRunningInstance();

            Assert.That(instance.Fail(), Is.EqualTo(PerformanceTransitionOutcome.Applied));
            var terminalRevision = instance.Revision;

            Assert.That(instance.Complete(), Is.EqualTo(PerformanceTransitionOutcome.AlreadyTerminal));
            Assert.That(instance.State, Is.EqualTo(PerformanceInstanceState.Failed));
            Assert.That(instance.EndReason, Is.EqualTo(PerformanceEndReason.Failed));
            Assert.That(instance.Revision, Is.EqualTo(terminalRevision));
        }

        [Test]
        public void NormalCompletionHasAReasonAndIsIdempotent()
        {
            var instance = CreateRunningInstance();

            Assert.That(instance.Complete(), Is.EqualTo(PerformanceTransitionOutcome.Applied));
            var terminalRevision = instance.Revision;

            Assert.That(instance.Complete(), Is.EqualTo(PerformanceTransitionOutcome.AlreadyTerminal));
            Assert.That(instance.State, Is.EqualTo(PerformanceInstanceState.Completed));
            Assert.That(instance.EndReason, Is.EqualTo(PerformanceEndReason.Completed));
            Assert.That(instance.Revision, Is.EqualTo(terminalRevision));
        }

        [Test]
        public void DomainContractsDoNotReferencePresentationResourcesOrExternalFrameworks()
        {
            var domainTypes = new[]
            {
                typeof(BehaviorIntent),
                typeof(BehaviorDefinition),
                typeof(PerformancePlan),
                typeof(PerformanceInstance),
                typeof(PerformanceChannelClaim),
                typeof(PerformanceCommand),
            };
            var forbiddenPrefixes = new[]
            {
                "UnityEngine",
                "UnityEditor",
                "UniVRM",
                "VRM",
                "Electron",
                "Microsoft.AI",
            };

            var referencedTypes = domainTypes.SelectMany(GetContractTypes).Distinct().ToArray();
            Assert.That(referencedTypes.Any(type => forbiddenPrefixes.Any(prefix =>
                (type.Namespace ?? string.Empty).StartsWith(prefix, StringComparison.Ordinal))), Is.False);
            Assert.That(domainTypes.SelectMany(type => type.GetMembers()).Any(member =>
                member.Name.IndexOf("Clip", StringComparison.OrdinalIgnoreCase) >= 0
                || member.Name.IndexOf("Bone", StringComparison.OrdinalIgnoreCase) >= 0
                || member.Name.IndexOf("Path", StringComparison.OrdinalIgnoreCase) >= 0), Is.False);
        }

        private static PerformanceInstance CreateRunningInstance(
            PerformanceControlCapabilities capabilities = PerformanceControlCapabilities.None)
        {
            var instance = CreateInstance(capabilities);
            Assert.That(instance.Accept(), Is.EqualTo(PerformanceTransitionOutcome.Applied));
            Assert.That(instance.Start(), Is.EqualTo(PerformanceTransitionOutcome.Applied));
            return instance;
        }

        private static PerformanceInstance CreateInstance(PerformanceControlCapabilities capabilities)
        {
            var intent = new BehaviorIntent("intent-1", "behavior", BehaviorIntentSource.Application);
            var definition = new BehaviorDefinition("definition-1", new[] { BodyBaseShared }, capabilities);
            var plan = new PerformancePlan("plan-1", intent, definition);
            return new PerformanceInstance("instance-1", plan);
        }

        private static IEnumerable<Type> GetContractTypes(Type type)
        {
            yield return type;

            foreach (var field in type.GetFields(
                BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
            {
                foreach (var fieldType in ExpandType(field.FieldType)) yield return fieldType;
            }

            foreach (var property in type.GetProperties(
                BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
            {
                foreach (var propertyType in ExpandType(property.PropertyType)) yield return propertyType;
            }

            foreach (var constructor in type.GetConstructors(
                BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
            {
                foreach (var parameter in constructor.GetParameters())
                {
                    foreach (var parameterType in ExpandType(parameter.ParameterType))
                        yield return parameterType;
                }
            }

            foreach (var method in type.GetMethods(
                BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic))
            {
                foreach (var returnType in ExpandType(method.ReturnType)) yield return returnType;
                foreach (var parameter in method.GetParameters())
                {
                    foreach (var parameterType in ExpandType(parameter.ParameterType))
                        yield return parameterType;
                }
            }
        }

        private static IEnumerable<Type> ExpandType(Type type)
        {
            yield return type;
            if (type.HasElementType)
            {
                foreach (var elementType in ExpandType(type.GetElementType())) yield return elementType;
            }
            if (!type.IsGenericType) yield break;

            foreach (var argument in type.GetGenericArguments())
            {
                foreach (var nested in ExpandType(argument)) yield return nested;
            }
        }
    }
}
