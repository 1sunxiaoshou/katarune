using System.Collections.Generic;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Katarune.Avatar.Tests
{
    public sealed class BehaviorPerformanceRuntimeTests
    {
        private const string GesturePath =
            "Assets/Katarune/Behaviors/QuaterniusUpperBodyExplain.kbehavior";
        private const string DancePath =
            "Assets/Katarune/Behaviors/QuaterniusShortDance.kbehavior";

        [Test]
        public void RuntimeCatalogAndBothAcceptanceScenesAreTrackedUnityAssets()
        {
            var catalog = Resources.Load<BehaviorDefinitionCatalog>("BehaviorDefinitionCatalog");
            Assert.That(catalog, Is.Not.Null);
            Assert.That(catalog.IsValid, Is.True);
            Assert.That(catalog.Definitions, Has.Count.EqualTo(3));
            Assert.That(
                AssetDatabase.LoadAssetAtPath<SceneAsset>(
                    "Assets/Katarune/Scenes/Acceptance/PhaseD_SpeakingWithGesture.unity"),
                Is.Not.Null);
            Assert.That(
                AssetDatabase.LoadAssetAtPath<SceneAsset>(
                    "Assets/Katarune/Scenes/Acceptance/PhaseD_DanceInterruption.unity"),
                Is.Not.Null);
        }

        [Test]
        public void DuplicateDefinitionVersionIsRejectedDuringResolution()
        {
            var definition = Load(GesturePath);

            Assert.Throws<System.InvalidOperationException>(() =>
                new BehaviorPerformanceRuntime(
                    new[] { definition, definition },
                    CharacterRigCapabilities.All,
                    new RecordingSink()));
        }

        [Test]
        public void UpperBodyGestureCompletesWithoutTouchingUnclaimedChannels()
        {
            var sink = new RecordingSink();
            using var runtime = CreateRuntime(sink, Load(GesturePath));

            var result = runtime.Request(Intent("gesture", "katarune.gesture.explain"));
            Assert.That(result.Outcome, Is.EqualTo(BehaviorRequestOutcome.Started));
            Assert.That(runtime.Scheduler.ChannelOwners, Has.Exactly(1).Matches<PerformanceChannelOwner>(
                owner => owner.Channel == PerformanceChannel.GestureUpperBody));

            runtime.Tick(3f);

            var instance = runtime.Scheduler.Find(result.InstanceId);
            Assert.That(instance.State, Is.EqualTo(PerformanceInstanceState.Completed));
            Assert.That(instance.EndReason, Is.EqualTo(PerformanceEndReason.Completed));
            Assert.That(runtime.Scheduler.ChannelOwners, Is.Empty);
            Assert.That(sink.Ended, Is.EqualTo(new[] { result.InstanceId }));
        }

        [Test]
        public void DanceSafeExitKeepsQueuedExclusiveWaitingUntilExitSegmentCompletes()
        {
            var sink = new RecordingSink();
            using var runtime = CreateRuntime(sink, Load(DancePath));
            var first = runtime.Request(Intent("dance-a", "katarune.performance.short-dance"));
            var second = runtime.Request(Intent("dance-b", "katarune.performance.short-dance"));
            runtime.Tick(0.25f);

            Assert.That(
                runtime.Apply(first.InstanceId, PerformanceCommand.ExitAtSafePoint()),
                Is.EqualTo(PerformanceTransitionOutcome.Applied));
            runtime.Tick(0.24f);
            Assert.That(runtime.Scheduler.Find(second.InstanceId).State,
                Is.EqualTo(PerformanceInstanceState.Requested));

            runtime.Tick(0.02f);
            Assert.That(runtime.FormatDiagnostics(), Does.Contain("phase=exit"));
            Assert.That(runtime.FormatDiagnostics(), Does.Contain("sync=exit.safe"));
            runtime.Tick(1f);

            Assert.That(runtime.Scheduler.Find(first.InstanceId).EndReason,
                Is.EqualTo(PerformanceEndReason.ExitedAtSafePoint));
            Assert.That(runtime.Scheduler.Find(second.InstanceId).State,
                Is.EqualTo(PerformanceInstanceState.Running));
            Assert.That(sink.Events, Is.EqualTo(new[]
            {
                $"begin:{first.InstanceId}",
                $"end:{first.InstanceId}:False",
                $"begin:{second.InstanceId}",
            }));
        }

        [Test]
        public void ExplicitStopEndsImmediatelyAndOnlyOnce()
        {
            var sink = new RecordingSink();
            using var runtime = CreateRuntime(sink, Load(DancePath));
            var dance = runtime.Request(Intent("dance", "katarune.performance.short-dance"));

            Assert.That(
                runtime.Apply(dance.InstanceId, PerformanceCommand.CancelImmediate()),
                Is.EqualTo(PerformanceTransitionOutcome.Applied));
            Assert.That(
                runtime.Apply(dance.InstanceId, PerformanceCommand.CancelImmediate()),
                Is.EqualTo(PerformanceTransitionOutcome.AlreadyTerminal));

            Assert.That(sink.Events, Is.EqualTo(new[]
            {
                $"begin:{dance.InstanceId}",
                $"end:{dance.InstanceId}:True",
            }));
            Assert.That(runtime.Scheduler.ChannelOwners, Is.Empty);
        }

        private static BehaviorPerformanceRuntime CreateRuntime(
            RecordingSink sink,
            params BehaviorDefinitionAsset[] definitions) =>
            new BehaviorPerformanceRuntime(definitions, CharacterRigCapabilities.All, sink);

        private static BehaviorDefinitionAsset Load(string path)
        {
            var asset = AssetDatabase.LoadAssetAtPath<BehaviorDefinitionAsset>(path);
            Assert.That(asset, Is.Not.Null, path);
            return asset;
        }

        private static BehaviorIntent Intent(string intentId, string behaviorId) =>
            new BehaviorIntent(intentId, behaviorId, BehaviorIntentSource.User);

        private sealed class RecordingSink : IBehaviorPerformanceSink
        {
            public List<string> Events { get; } = new List<string>();
            public List<string> Ended { get; } = new List<string>();

            public void Begin(string instanceId, BehaviorDefinitionAsset definition, float clipTime) =>
                Events.Add($"begin:{instanceId}");

            public void SetTime(string instanceId, float clipTime) { }
            public void SetPaused(string instanceId, bool paused) { }

            public void End(string instanceId, bool immediate)
            {
                Events.Add($"end:{instanceId}:{immediate}");
                Ended.Add(instanceId);
            }
        }
    }
}
