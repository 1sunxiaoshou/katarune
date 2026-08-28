using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarMotionLibraryTests
    {
        [Test]
        public void ImportAliasesNormalizeArmaturePrefixAndLoopSuffix()
        {
            var names = new[]
            {
                "Armature|Idle_Loop",
                "Armature|Idle_No_Loop",
                "Armature|Idle_FoldArms_Loop",
            };

            Assert.That(
                Katarune.Avatar.Editor.AvatarMotionLibraryImporter.ResolveAlias(names, "Idle"),
                Is.EqualTo("Armature|Idle_Loop"));
            Assert.That(
                Katarune.Avatar.Editor.AvatarMotionLibraryImporter.ResolveAlias(names, "Idle_Pose_Arms", "Idle_FoldArms"),
                Is.EqualTo("Armature|Idle_FoldArms_Loop"));
        }

        [Test]
        public void DuplicateNormalizedAliasesAreRejected()
        {
            var names = new[] { "Idle", "Armature|Idle_Loop" };

            Assert.Throws<System.InvalidOperationException>(() =>
                Katarune.Avatar.Editor.AvatarMotionLibraryImporter.ResolveAlias(names, "Idle"));
        }

        [Test]
        public void ImportedHumanoidClipsUseBodyOrientationAndLockedRootMotion()
        {
            var clip = new UnityEditor.ModelImporterClipAnimation();

            Katarune.Avatar.Editor.AvatarMotionLibraryImporter.ConfigureClip(clip, loop: true);

            Assert.That(clip.loopTime, Is.True);
            Assert.That(clip.lockRootRotation, Is.True);
            Assert.That(clip.lockRootHeightY, Is.True);
            Assert.That(clip.lockRootPositionXZ, Is.True);
            Assert.That(clip.keepOriginalOrientation, Is.False);
            Assert.That(clip.rotationOffset, Is.Zero);
        }

        [Test]
        public void MotifectReadmeRequiresSourceAndRedistributionTerms()
        {
            const string valid = "Motifect Daily Life Motion Pack\n"
                + "Free for personal and commercial use in your projects.\n"
                + "Do not redistribute or resell these raw animation files as a standalone product.";

            Assert.That(
                Katarune.Avatar.Editor.AvatarMotionLibraryImporter.IsValidMotifectReadme(valid),
                Is.True);
            Assert.That(
                Katarune.Avatar.Editor.AvatarMotionLibraryImporter.IsValidMotifectReadme(
                    "Motifect Daily Life Motion Pack"),
                Is.False);
        }

        [Test]
        public void CompleteLibraryPublishesAllActionCapabilities()
        {
            var library = ScriptableObject.CreateInstance<AvatarMotionLibrary>();
            var idle = new AnimationClip { name = "Idle" };
            var talking = new AnimationClip { name = "Talking" };
            var wave = new AnimationClip { name = "Wave" };
            var celebrate = new AnimationClip { name = "Celebrate" };
            celebrate.SetCurve(
                string.Empty,
                typeof(Transform),
                "localPosition.x",
                new AnimationCurve(new Keyframe(0f, 0f), new Keyframe(4f, 0f)));
            var cough = new AnimationClip { name = "Cough" };
            library.Configure(
                idle,
                new[]
                {
                    new AvatarActionDefinition(AvatarPresetAction.GreetWave, wave),
                    new AvatarActionDefinition(AvatarPresetAction.Explain, talking, 2.4f),
                    new AvatarActionDefinition(AvatarPresetAction.Celebrate, celebrate, 3f),
                    new AvatarActionDefinition(AvatarPresetAction.Cough, cough),
                });

            Assert.That(library.IsValid, Is.True);
            Assert.That(library.Actions, Is.EqualTo(AvatarActionCapabilities.All));
            Assert.That(library.TryGetBase(out var baseResult), Is.True);
            Assert.That(baseResult, Is.SameAs(idle));
            Assert.That(library.TryGetAction(AvatarPresetAction.Celebrate, out var action), Is.True);
            Assert.That(action.Duration, Is.EqualTo(3f));

            Object.DestroyImmediate(library);
            Object.DestroyImmediate(idle);
            Object.DestroyImmediate(talking);
            Object.DestroyImmediate(wave);
            Object.DestroyImmediate(celebrate);
            Object.DestroyImmediate(cough);
        }

        [Test]
        public void QuietIdleIsAClosedSubtleHumanoidLoopWithStaticArmsAndRoot()
        {
            var clip = Katarune.Avatar.Editor.KataruneQuietIdleGenerator.BuildClip();

            Assert.That(clip.isHumanMotion, Is.True);
            Assert.That(clip.length, Is.EqualTo(
                Katarune.Avatar.Editor.KataruneQuietIdleGenerator.DurationSeconds).Within(0.001f));
            Assert.That(AnimationUtility.GetAnimationClipSettings(clip).loopTime, Is.True);

            var chest = GetMuscleCurve(clip, "UpperChest Front-Back");
            Assert.That(chest.Evaluate(0f), Is.EqualTo(chest.Evaluate(clip.length)).Within(0.0001f));
            Assert.That(GetRange(chest), Is.GreaterThan(0.01f).And.LessThan(0.04f));

            var arm = GetMuscleCurve(clip, "Left Arm Down-Up");
            Assert.That(GetRange(arm), Is.LessThan(0.0001f));

            var root = AnimationUtility.GetEditorCurve(
                clip,
                EditorCurveBinding.FloatCurve(string.Empty, typeof(Animator), "RootT.x"));
            Assert.That(root, Is.Not.Null);
            Assert.That(GetRange(root), Is.LessThan(0.0001f));

            Object.DestroyImmediate(clip);
        }

        private static AnimationCurve GetMuscleCurve(AnimationClip clip, string name)
        {
            var curve = AnimationUtility.GetEditorCurve(
                clip,
                EditorCurveBinding.FloatCurve(string.Empty, typeof(Animator), name));
            Assert.That(curve, Is.Not.Null, name);
            return curve;
        }

        private static float GetRange(AnimationCurve curve)
        {
            var minimum = float.PositiveInfinity;
            var maximum = float.NegativeInfinity;
            foreach (var key in curve.keys)
            {
                minimum = Mathf.Min(minimum, key.value);
                maximum = Mathf.Max(maximum, key.value);
            }
            return maximum - minimum;
        }
    }
}
