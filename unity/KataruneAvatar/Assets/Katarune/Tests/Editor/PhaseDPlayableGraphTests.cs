using Katarune.Avatar.Editor;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Katarune.Avatar.Tests
{
    public sealed class PhaseDPlayableGraphTests
    {
        [Test]
        public void SchedulerDrivesRealHumanoidGraphWithoutLegacyDoubleDrive()
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(
                PhaseCBehaviorSampleGenerator.SourcePath);
            if (prefab == null)
            {
                Assert.Ignore("Import the Git-ignored UAL1 Standard source to run the Phase D graph smoke.");
            }

            var gameObject = Object.Instantiate(prefab);
            try
            {
                var animator = gameObject.GetComponentInChildren<Animator>();
                Assert.That(animator, Is.Not.Null);
                Assert.That(animator.isHuman, Is.True);
                animator.runtimeAnimatorController = null;
                animator.Update(0f);
                var catalog = Resources.Load<BehaviorDefinitionCatalog>("BehaviorDefinitionCatalog");
                Assert.That(catalog, Is.Not.Null);

                using var motion = new AvatarMotionInstance(
                    animator,
                    null,
                    catalog.Definitions,
                    CharacterRigCapabilities.All,
                    AvatarActivityState.Speaking);
                var gesture = motion.RequestBehavior(new BehaviorIntent(
                    "graph-gesture",
                    "katarune.gesture.explain",
                    BehaviorIntentSource.Application), PerformanceRequestPolicy.Queue);

                Assert.That(gesture.Outcome, Is.EqualTo(BehaviorRequestOutcome.Started));
                Assert.That(motion.ActivePerformanceCount, Is.EqualTo(1));
                Assert.That(motion.RequestAction(AvatarPresetAction.Explain).Outcome,
                    Is.EqualTo(AvatarActionRequestOutcome.Unavailable));
                motion.Tick(3f);
                Assert.That(motion.ActivePerformanceCount, Is.Zero);
                Assert.That(motion.PerformanceDiagnostics, Does.Contain("end=Completed"));

                var dance = motion.RequestBehavior(new BehaviorIntent(
                    "graph-dance",
                    "katarune.performance.short-dance",
                    BehaviorIntentSource.User), PerformanceRequestPolicy.Queue);
                Assert.That(dance.Outcome, Is.EqualTo(BehaviorRequestOutcome.Started));
                Assert.That(motion.ProceduralBodyWeight, Is.Zero);
                Assert.That(
                    motion.ApplyPerformanceCommand(dance.InstanceId, PerformanceCommand.CancelImmediate()),
                    Is.EqualTo(PerformanceTransitionOutcome.Applied));
                Assert.That(motion.ProceduralBodyWeight, Is.GreaterThan(0f));
            }
            finally
            {
                Object.DestroyImmediate(gameObject);
            }
        }
    }
}
