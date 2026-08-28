using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace Katarune.Avatar.Editor
{
    internal static class KataruneQuietIdleGenerator
    {
        internal const string GeneratedClipPath = "Assets/Katarune/Motions/KataruneQuietIdle.anim";
        internal const float DurationSeconds = 9.6f;

        private const string NeutralHumanoidClipPath =
            "Packages/com.unity.timeline/Editor/StyleSheets/res/HumanoidDefault.anim";

        [MenuItem("Katarune/Avatar/Generate Quiet Idle")]
        public static void GenerateAndApply()
        {
            var clip = CreateOrUpdateClip();
            ApplyToLocalLibrary(clip);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            Debug.Log($"KATARUNE_QUIET_IDLE_READY path={GeneratedClipPath}");
        }

        internal static AnimationClip CreateOrUpdateClip()
        {
            var generated = BuildClip();
            EnsureAssetFolder("Assets/Katarune/Motions");
            var existing = AssetDatabase.LoadAssetAtPath<AnimationClip>(GeneratedClipPath);
            if (existing == null)
            {
                AssetDatabase.CreateAsset(generated, GeneratedClipPath);
                existing = generated;
            }
            else
            {
                EditorUtility.CopySerialized(generated, existing);
                existing.name = "KataruneQuietIdle";
                EditorUtility.SetDirty(existing);
                UnityEngine.Object.DestroyImmediate(generated);
            }
            return existing;
        }

        internal static AnimationClip BuildClip()
        {
            var neutral = AssetDatabase.LoadAssetAtPath<AnimationClip>(NeutralHumanoidClipPath);
            if (neutral == null)
            {
                throw new InvalidOperationException(
                    "Unity's neutral Humanoid reference clip is unavailable. Ensure the Timeline package is installed.");
            }

            var clip = new AnimationClip
            {
                name = "KataruneQuietIdle",
                frameRate = 60f,
                wrapMode = WrapMode.Loop,
            };

            foreach (var binding in AnimationUtility.GetCurveBindings(neutral))
            {
                var source = AnimationUtility.GetEditorCurve(neutral, binding);
                if (source == null || source.length == 0) continue;
                var baseline = source.Evaluate(0f);
                AnimationUtility.SetEditorCurve(clip, binding, ConstantCurve(baseline));
            }

            // A long, closed loop keeps the character alive without reading as a gesture.
            // Arms, hands, legs, feet and the root remain on the neutral Humanoid pose.
            SetAdditiveMuscle(clip, neutral, "Spine Front-Back", 0f, 0.004f, 0f, -0.002f, 0f);
            SetAdditiveMuscle(clip, neutral, "Chest Front-Back", 0f, 0.014f, 0f, -0.005f, 0f);
            SetAdditiveMuscle(clip, neutral, "UpperChest Front-Back", 0f, 0.018f, 0f, -0.006f, 0f);
            SetAdditiveMuscle(clip, neutral, "Spine Left-Right", 0f, 0.006f, 0f, -0.006f, 0f);
            SetAdditiveMuscle(clip, neutral, "Chest Left-Right", 0f, 0.004f, 0f, -0.004f, 0f);
            SetAdditiveMuscle(clip, neutral, "Head Nod Down-Up", 0f, -0.004f, 0f, 0.003f, 0f);
            SetAdditiveMuscle(clip, neutral, "Head Tilt Left-Right", 0f, -0.008f, 0f, 0.010f, 0f);
            SetAdditiveMuscle(clip, neutral, "Head Turn Left-Right", 0f, 0.006f, 0f, -0.008f, 0f);

            // These symmetric Humanoid muscle values form a relaxed A-pose: arms hang beside
            // the torso with a soft elbow bend. They are retargeted by each VRM Avatar and do
            // not encode FBX bone axes or source-model left/right transforms.
            SetMuscleCurve(clip, "Left Shoulder Down-Up", -0.35f, 0f, 0.006f, 0f, -0.002f, 0f);
            SetMuscleCurve(clip, "Right Shoulder Down-Up", -0.35f, 0f, 0.006f, 0f, -0.002f, 0f);
            SetConstantMuscle(clip, "Left Shoulder Front-Back", 1.1f);
            SetConstantMuscle(clip, "Right Shoulder Front-Back", 1.1f);
            SetConstantMuscle(clip, "Left Arm Down-Up", -0.48f);
            SetConstantMuscle(clip, "Right Arm Down-Up", -0.48f);
            SetConstantMuscle(clip, "Left Arm Front-Back", 0.23f);
            SetConstantMuscle(clip, "Right Arm Front-Back", 0.23f);
            SetConstantMuscle(clip, "Left Arm Twist In-Out", 0.16f);
            SetConstantMuscle(clip, "Right Arm Twist In-Out", 0.16f);
            SetConstantMuscle(clip, "Left Forearm Stretch", 0.52f);
            SetConstantMuscle(clip, "Right Forearm Stretch", 0.52f);
            SetConstantMuscle(clip, "Left Forearm Twist In-Out", 0f);
            SetConstantMuscle(clip, "Right Forearm Twist In-Out", 0f);
            SetConstantMuscle(clip, "Left Hand Down-Up", -0.03f);
            SetConstantMuscle(clip, "Right Hand Down-Up", -0.03f);
            SetConstantMuscle(clip, "Left Hand In-Out", 0f);
            SetConstantMuscle(clip, "Right Hand In-Out", 0f);
            SetRelaxedFingers(clip, "LeftHand");
            SetRelaxedFingers(clip, "RightHand");

            clip.EnsureQuaternionContinuity();
            SetLoopSettings(clip);
            return clip;
        }

        private static void ApplyToLocalLibrary(AnimationClip quietIdle)
        {
            var library = AssetDatabase.LoadAssetAtPath<AvatarMotionLibrary>(
                AvatarMotionLibraryImporter.LibraryAssetPath);
            if (library == null || !library.IsValid) return;

            var actions = new List<AvatarActionDefinition>();
            foreach (AvatarPresetAction action in Enum.GetValues(typeof(AvatarPresetAction)))
            {
                if (!library.TryGetAction(action, out var definition)) continue;
                actions.Add(new AvatarActionDefinition(
                    action,
                    definition.Clip,
                    definition.Duration,
                    definition.Speed));
            }

            library.Configure(quietIdle, actions.ToArray());
            EditorUtility.SetDirty(library);
        }

        private static void SetAdditiveMuscle(
            AnimationClip target,
            AnimationClip neutral,
            string muscle,
            params float[] offsets)
        {
            if (offsets == null || offsets.Length < 2)
            {
                throw new ArgumentException("A looping muscle curve needs at least two samples.", nameof(offsets));
            }
            if (!Mathf.Approximately(offsets[0], offsets[offsets.Length - 1]))
            {
                throw new ArgumentException($"The '{muscle}' curve must close at the loop boundary.", nameof(offsets));
            }

            var binding = EditorCurveBinding.FloatCurve(string.Empty, typeof(Animator), muscle);
            var neutralCurve = AnimationUtility.GetEditorCurve(neutral, binding)
                ?? throw new InvalidOperationException($"Unity's neutral Humanoid clip has no '{muscle}' muscle.");
            SetMuscleCurve(target, muscle, neutralCurve.Evaluate(0f), offsets);
        }

        private static void SetConstantMuscle(AnimationClip target, string muscle, float value)
        {
            AnimationUtility.SetEditorCurve(
                target,
                EditorCurveBinding.FloatCurve(string.Empty, typeof(Animator), muscle),
                ConstantCurve(value));
        }

        private static void SetRelaxedFingers(AnimationClip target, string hand)
        {
            SetConstantMuscle(target, $"{hand}.Thumb.1 Stretched", -0.04f);
            SetConstantMuscle(target, $"{hand}.Thumb.2 Stretched", -0.05f);
            SetConstantMuscle(target, $"{hand}.Thumb.3 Stretched", -0.05f);
            SetConstantMuscle(target, $"{hand}.Thumb.Spread", 0f);
            foreach (var finger in new[] { "Index", "Middle", "Ring", "Little" })
            {
                SetConstantMuscle(target, $"{hand}.{finger}.1 Stretched", -0.06f);
                SetConstantMuscle(target, $"{hand}.{finger}.2 Stretched", -0.08f);
                SetConstantMuscle(target, $"{hand}.{finger}.3 Stretched", -0.06f);
                SetConstantMuscle(target, $"{hand}.{finger}.Spread", 0f);
            }
        }

        private static void SetMuscleCurve(
            AnimationClip target,
            string muscle,
            float baseline,
            params float[] offsets)
        {
            if (offsets == null || offsets.Length < 2)
            {
                throw new ArgumentException("A looping muscle curve needs at least two samples.", nameof(offsets));
            }
            if (!Mathf.Approximately(offsets[0], offsets[offsets.Length - 1]))
            {
                throw new ArgumentException($"The '{muscle}' curve must close at the loop boundary.", nameof(offsets));
            }
            var keys = new Keyframe[offsets.Length];
            for (var index = 0; index < offsets.Length; index += 1)
            {
                var time = DurationSeconds * index / (offsets.Length - 1f);
                keys[index] = new Keyframe(time, baseline + offsets[index], 0f, 0f);
            }
            AnimationUtility.SetEditorCurve(
                target,
                EditorCurveBinding.FloatCurve(string.Empty, typeof(Animator), muscle),
                new AnimationCurve(keys));
        }

        private static AnimationCurve ConstantCurve(float value)
        {
            return new AnimationCurve(
                new Keyframe(0f, value, 0f, 0f),
                new Keyframe(DurationSeconds, value, 0f, 0f));
        }

        private static void SetLoopSettings(AnimationClip clip)
        {
            var serialized = new SerializedObject(clip);
            var settings = serialized.FindProperty("m_AnimationClipSettings");
            settings.FindPropertyRelative("m_LoopTime").boolValue = true;
            settings.FindPropertyRelative("m_LoopBlend").boolValue = true;
            settings.FindPropertyRelative("m_LoopBlendOrientation").boolValue = true;
            settings.FindPropertyRelative("m_LoopBlendPositionY").boolValue = true;
            settings.FindPropertyRelative("m_LoopBlendPositionXZ").boolValue = true;
            serialized.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void EnsureAssetFolder(string assetPath)
        {
            var segments = assetPath.Split('/');
            var current = segments[0];
            for (var index = 1; index < segments.Length; index += 1)
            {
                var next = $"{current}/{segments[index]}";
                if (!AssetDatabase.IsValidFolder(next)) AssetDatabase.CreateFolder(current, segments[index]);
                current = next;
            }
        }
    }
}
