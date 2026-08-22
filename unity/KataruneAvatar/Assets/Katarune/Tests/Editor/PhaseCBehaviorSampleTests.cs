using System;
using System.Linq;
using Katarune.Avatar.Editor;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;
using Object = UnityEngine.Object;

namespace Katarune.Avatar.Tests
{
    public sealed class PhaseCBehaviorSampleTests
    {
        private const string IdlePath =
            "Assets/Katarune/Behaviors/KataruneQuietIdle.kbehavior";
        private const string ExplainPath =
            "Assets/Katarune/Behaviors/QuaterniusUpperBodyExplain.kbehavior";
        private const string DancePath =
            "Assets/Katarune/Behaviors/QuaterniusShortDance.kbehavior";

        [Test]
        public void ThreeSamplesUseOneDefinitionEntryAndValidate()
        {
            var definitions = new[] { Load(IdlePath), Load(ExplainPath), Load(DancePath) };

            Assert.That(definitions.Select(definition => definition.BehaviorId), Is.EquivalentTo(new[]
            {
                "katarune.body.quiet-idle",
                "katarune.gesture.explain",
                "katarune.performance.short-dance",
            }));
            foreach (var definition in definitions)
            {
                var validation = BehaviorDefinitionAssetValidator.Validate(
                    definition,
                    CharacterRigCapabilities.HumanoidBody);
                Assert.That(validation.IsValid, Is.True,
                    validation.IsValid ? definition.BehaviorId : validation.Errors[0].Message);
                Assert.That(definition.Clip.humanMotion, Is.True, definition.BehaviorId);
            }
        }

        [Test]
        public void ExplainUsesUpperBodyMaskWithoutOwningHeadOrLegs()
        {
            var definition = Load(ExplainPath);
            var claim = definition.ChannelClaims.Single();

            Assert.That(claim.Channel, Is.EqualTo(PerformanceChannel.GestureUpperBody));
            Assert.That(claim.Occupancy, Is.EqualTo(PerformanceChannelOccupancy.Additive));
            Assert.That(definition.AvatarMask, Is.Not.Null);
            Assert.That(definition.AvatarMask.GetHumanoidBodyPartActive(AvatarMaskBodyPart.Body), Is.True);
            Assert.That(definition.AvatarMask.GetHumanoidBodyPartActive(AvatarMaskBodyPart.LeftArm), Is.True);
            Assert.That(definition.AvatarMask.GetHumanoidBodyPartActive(AvatarMaskBodyPart.RightArm), Is.True);
            Assert.That(definition.AvatarMask.GetHumanoidBodyPartActive(AvatarMaskBodyPart.Head), Is.False);
            Assert.That(definition.AvatarMask.GetHumanoidBodyPartActive(AvatarMaskBodyPart.Root), Is.False);
            Assert.That(definition.AvatarMask.GetHumanoidBodyPartActive(AvatarMaskBodyPart.LeftLeg), Is.False);
            Assert.That(definition.AvatarMask.GetHumanoidBodyPartActive(AvatarMaskBodyPart.RightLeg), Is.False);
        }

        [Test]
        public void ShortDanceExpressesFinitePerformanceAndSafeRecovery()
        {
            var definition = Load(DancePath);
            var claim = definition.ChannelClaims.Single();

            Assert.That(claim.Channel, Is.EqualTo(PerformanceChannel.BodyFullPerformance));
            Assert.That(claim.Occupancy, Is.EqualTo(PerformanceChannelOccupancy.Exclusive));
            Assert.That(definition.Entry, Is.Null);
            Assert.That(definition.LoopIterations,
                Is.EqualTo(PhaseCBehaviorSampleGenerator.PerformanceLoopIterations));
            Assert.That(definition.NaturalDurationSeconds, Is.EqualTo(16.5f).Within(0.001f));
            Assert.That(definition.SyncPoints.Single().SafeExit, Is.True);
            Assert.That(definition.SyncPoints.Single().TimeSeconds,
                Is.EqualTo(PhaseCBehaviorSampleGenerator.PerformanceSafeExitTimeSeconds));
            Assert.That(definition.ExitSyncPoint, Is.EqualTo(definition.SyncPoints.Single().Name));
            Assert.That(definition.TryGetExitSyncPoint(out var exitPoint), Is.True);
            Assert.That(exitPoint, Is.SameAs(definition.SyncPoints.Single()));
            Assert.That(definition.FallbackBehaviorId, Is.EqualTo("katarune.body.quiet-idle"));
        }

        [Test]
        public void ExternalSampleLicenseRecordsRightsAndRepositoryPolicy()
        {
            foreach (var definition in new[] { Load(ExplainPath), Load(DancePath) })
            {
                Assert.That(definition.License.Author, Is.EqualTo("Quaternius"));
                Assert.That(definition.License.LicenseId, Is.EqualTo("CC0-1.0"));
                Assert.That(definition.License.AcquiredOn, Is.EqualTo("2026-08-22"));
                Assert.That(definition.License.OriginalFormat, Is.EqualTo("FBX"));
                Assert.That(definition.License.CommercialUseAllowed, Is.True);
                Assert.That(definition.License.ModificationAllowed, Is.True);
                Assert.That(definition.License.RedistributionAllowed, Is.True);
                Assert.That(definition.License.RepositoryPolicy, Does.Contain("original UAL1 FBX"));
            }
        }

        [Test]
        public void GeneratedDanceExitMatchesQuietIdlePoseCurves()
        {
            var dance = Load(DancePath).Clip;
            var idle = Load(IdlePath).Clip;
            var compared = 0;

            foreach (var binding in AnimationUtility.GetCurveBindings(idle))
            {
                var danceCurve = AnimationUtility.GetEditorCurve(dance, binding);
                var idleCurve = AnimationUtility.GetEditorCurve(idle, binding);
                if (danceCurve == null || idleCurve == null) continue;
                Assert.That(
                    danceCurve.Evaluate(dance.length),
                    Is.EqualTo(idleCurve.Evaluate(0f)).Within(0.0001f),
                    binding.propertyName);
                compared += 1;
            }

            Assert.That(compared, Is.GreaterThan(50));
        }

        [Test]
        public void QuietIdleClosesEveryHumanoidCurveAtLoopBoundary()
        {
            var idle = Load(IdlePath).Clip;
            var compared = 0;
            foreach (var binding in AnimationUtility.GetCurveBindings(idle))
            {
                var curve = AnimationUtility.GetEditorCurve(idle, binding);
                if (curve == null) continue;
                Assert.That(curve.Evaluate(idle.length),
                    Is.EqualTo(curve.Evaluate(0f)).Within(0.0001f), binding.propertyName);
                compared += 1;
            }
            Assert.That(compared, Is.GreaterThan(50));
        }

        [Test]
        public void DanceExitCurvesDoNotOvershootSafePoseAndIdle()
        {
            var dance = Load(DancePath).Clip;
            foreach (var binding in AnimationUtility.GetCurveBindings(dance))
            {
                var curve = AnimationUtility.GetEditorCurve(dance, binding);
                if (curve == null) continue;
                var start = curve.Evaluate(PhaseCBehaviorSampleGenerator.PerformanceExitStartSeconds);
                var middle = curve.Evaluate(1.5f);
                var end = curve.Evaluate(PhaseCBehaviorSampleGenerator.PerformanceClipDurationSeconds);
                Assert.That(middle,
                    Is.InRange(Mathf.Min(start, end) - 0.0001f, Mathf.Max(start, end) + 0.0001f),
                    binding.propertyName);
            }
        }

        [Test]
        public void LocalHumanoidGraphAppliesUpperBodyMaskAndSafeExitSegment()
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(
                PhaseCBehaviorSampleGenerator.SourcePath);
            if (prefab == null)
            {
                Assert.Ignore("Import the Git-ignored UAL1 Standard source to run the real Humanoid graph smoke.");
            }

            var idle = Load(IdlePath);
            var explain = Load(ExplainPath);
            var dance = Load(DancePath);
            var baseOnly = Object.Instantiate(prefab);
            var layered = Object.Instantiate(prefab);
            try
            {
                var baseAnimator = RequireAnimator(baseOnly);
                var layeredAnimator = RequireAnimator(layered);
                using (var baseGraph = CreateSingleClipGraph(baseAnimator, idle.Clip, 2.0))
                using (var layeredGraph = CreateLayeredGraph(layeredAnimator, idle, explain, 2.0))
                {
                    baseGraph.Graph.Evaluate(0.01f);
                    layeredGraph.Graph.Evaluate(0.01f);
                    AssertBoneUnchanged(baseAnimator, layeredAnimator, HumanBodyBones.Head, 0.05f);
                    AssertBoneUnchanged(baseAnimator, layeredAnimator, HumanBodyBones.LeftUpperLeg, 0.05f);
                    Assert.That(BoneAngle(baseAnimator, layeredAnimator, HumanBodyBones.LeftUpperArm),
                        Is.GreaterThan(0.25f));
                }

                using (var baseGraph = CreateSingleClipGraph(baseAnimator, idle.Clip, 0.5))
                using (var performance = CreateSingleClipGraph(layeredAnimator, dance.Clip, 0.5))
                {
                    baseGraph.Graph.Evaluate(0.01f);
                    performance.Graph.Evaluate(0f);
                    Assert.That(MaxBodyBoneAngle(baseAnimator, layeredAnimator), Is.GreaterThan(5f));
                    performance.Playable.SetTime(dance.Exit.StartSeconds + 0.5f);
                    performance.Graph.Evaluate(0f);
                    performance.Playable.SetTime(dance.Exit.EndSeconds);
                    performance.Graph.Evaluate(0f);
                    Assert.That(performance.Graph.IsValid(), Is.True);
                }
            }
            finally
            {
                Object.DestroyImmediate(baseOnly);
                Object.DestroyImmediate(layered);
            }
        }

        private static BehaviorDefinitionAsset Load(string path)
        {
            var definition = AssetDatabase.LoadAssetAtPath<BehaviorDefinitionAsset>(path);
            Assert.That(definition, Is.Not.Null, path);
            return definition;
        }

        private static Animator RequireAnimator(GameObject gameObject)
        {
            var animator = gameObject.GetComponentInChildren<Animator>();
            Assert.That(animator, Is.Not.Null);
            Assert.That(animator.isHuman, Is.True);
            animator.runtimeAnimatorController = null;
            animator.applyRootMotion = false;
            animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
            animator.Update(0f);
            return animator;
        }

        private static GraphHandle CreateSingleClipGraph(
            Animator animator,
            AnimationClip clip,
            double time)
        {
            var graph = PlayableGraph.Create("Phase C single clip smoke");
            graph.SetTimeUpdateMode(DirectorUpdateMode.Manual);
            var playable = AnimationClipPlayable.Create(graph, clip);
            playable.SetTime(time);
            playable.SetSpeed(0d);
            var output = AnimationPlayableOutput.Create(graph, "Humanoid", animator);
            output.SetSourcePlayable(playable);
            graph.Play();
            return new GraphHandle(graph, playable);
        }

        private static GraphHandle CreateLayeredGraph(
            Animator animator,
            BehaviorDefinitionAsset idle,
            BehaviorDefinitionAsset overlay,
            double time)
        {
            var graph = PlayableGraph.Create("Phase C upper-body smoke");
            graph.SetTimeUpdateMode(DirectorUpdateMode.Manual);
            var idlePlayable = AnimationClipPlayable.Create(graph, idle.Clip);
            var overlayPlayable = AnimationClipPlayable.Create(graph, overlay.Clip);
            idlePlayable.SetTime(time);
            idlePlayable.SetSpeed(0d);
            overlayPlayable.SetTime(time);
            overlayPlayable.SetSpeed(0d);
            var mixer = AnimationLayerMixerPlayable.Create(graph, 2);
            graph.Connect(idlePlayable, 0, mixer, 0);
            graph.Connect(overlayPlayable, 0, mixer, 1);
            mixer.SetInputWeight(0, 1f);
            mixer.SetInputWeight(1, 1f);
            mixer.SetLayerMaskFromAvatarMask(1, overlay.AvatarMask);
            var output = AnimationPlayableOutput.Create(graph, "Humanoid", animator);
            output.SetSourcePlayable(mixer);
            graph.Play();
            return new GraphHandle(graph, overlayPlayable);
        }

        private static void AssertBoneUnchanged(
            Animator expected,
            Animator actual,
            HumanBodyBones bone,
            float tolerance)
        {
            Assert.That(BoneAngle(expected, actual, bone), Is.LessThan(tolerance), bone.ToString());
        }

        private static float BoneAngle(Animator expected, Animator actual, HumanBodyBones bone) =>
            Quaternion.Angle(
                expected.GetBoneTransform(bone).localRotation,
                actual.GetBoneTransform(bone).localRotation);

        private static float MaxBodyBoneAngle(Animator expected, Animator actual)
        {
            var bones = new[]
            {
                HumanBodyBones.Hips,
                HumanBodyBones.Spine,
                HumanBodyBones.Chest,
                HumanBodyBones.LeftUpperArm,
                HumanBodyBones.RightUpperArm,
                HumanBodyBones.LeftUpperLeg,
                HumanBodyBones.RightUpperLeg,
                HumanBodyBones.LeftLowerLeg,
                HumanBodyBones.RightLowerLeg,
            };
            return bones.Max(bone => BoneAngle(expected, actual, bone));
        }

        private readonly struct GraphHandle : IDisposable
        {
            public GraphHandle(PlayableGraph graph, AnimationClipPlayable playable)
            {
                Graph = graph;
                Playable = playable;
            }

            public PlayableGraph Graph { get; }
            public AnimationClipPlayable Playable { get; }
            public void Dispose()
            {
                if (Graph.IsValid()) Graph.Destroy();
            }
        }
    }
}
