using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Katarune.Avatar.Editor
{
    internal static class PhaseCBehaviorSampleGenerator
    {
        internal const string SourcePath =
            "Assets/KataruneLocal/Motions/Source/UAL1_Standard.fbx";
        internal const string SourceLicensePath =
            "Assets/KataruneLocal/Motions/Source/UAL1-License.txt";
        internal const string ExplainClipPath =
            "Assets/Katarune/Motions/Samples/QuaterniusFullBodyExplain.anim";
        internal const string PerformanceClipPath =
            "Assets/Katarune/Motions/Samples/QuaterniusShortDance.anim";
        internal const int PerformanceLoopIterations = 15;
        internal const float PerformanceClipDurationSeconds = 2f;
        internal const float PerformanceExitStartSeconds = 1f;
        internal const float PerformanceSafeExitTimeSeconds = 0.5f;
        private const string NeutralHumanoidClipPath =
            "Packages/com.unity.timeline/Editor/StyleSheets/res/HumanoidDefault.anim";

        private const float SampleRate = 30f;

        [MenuItem("Katarune/Avatar/Generate Phase C Behavior Samples")]
        public static void GenerateAndSave()
        {
            ValidateLocalSource();
            var sourceClips = AssetDatabase.LoadAllAssetsAtPath(SourcePath)
                .OfType<AnimationClip>()
                .Where(clip => !clip.name.StartsWith("__preview__", StringComparison.OrdinalIgnoreCase))
                .ToArray();
            var talking = RequireClip(sourceClips, "Idle_Talking");
            var dance = RequireClip(sourceClips, "Dance");
            var neutral = AssetDatabase.LoadAssetAtPath<AnimationClip>(NeutralHumanoidClipPath)
                ?? throw new InvalidOperationException("Unity's neutral Humanoid reference clip is unavailable.");

            EnsureAssetFolder("Assets/Katarune/Motions/Samples");
            CreateOrReplace(BuildExplainClip(talking), ExplainClipPath);
            CreateOrReplace(BuildPerformanceClip(dance, neutral), PerformanceClipPath);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            Debug.Log(
                $"KATARUNE_PHASE_C_SAMPLES_READY explain={ExplainClipPath} performance={PerformanceClipPath}");
        }

        internal static AnimationClip BuildExplainClip(AnimationClip source)
        {
            if (source == null) throw new ArgumentNullException(nameof(source));
            var result = new AnimationClip
            {
                name = "QuaterniusFullBodyExplain",
                frameRate = source.frameRate > 0f ? source.frameRate : SampleRate,
                wrapMode = WrapMode.Once,
            };
            foreach (var binding in AnimationUtility.GetCurveBindings(source))
            {
                var curve = AnimationUtility.GetEditorCurve(source, binding);
                if (curve == null) continue;
                AnimationUtility.SetEditorCurve(result, binding, new AnimationCurve(curve.keys));
            }
            result.EnsureQuaternionContinuity();
            SetLoopTime(result, false);
            return result;
        }

        internal static AnimationClip BuildPerformanceClip(
            AnimationClip dance,
            AnimationClip neutral)
        {
            if (dance == null) throw new ArgumentNullException(nameof(dance));
            if (neutral == null) throw new ArgumentNullException(nameof(neutral));
            if (dance.length <= 0f) throw new ArgumentException("Dance clip must not be empty.", nameof(dance));

            var danceCurves = GetCurves(dance);
            var neutralCurves = GetCurves(neutral);
            var bindings = danceCurves.Keys.Union(neutralCurves.Keys).ToArray();
            var result = new AnimationClip
            {
                name = "QuaterniusShortDance",
                frameRate = SampleRate,
                wrapMode = WrapMode.Once,
            };

            foreach (var binding in bindings)
            {
                danceCurves.TryGetValue(binding, out var danceCurve);
                neutralCurves.TryGetValue(binding, out var neutralCurve);
                if (danceCurve == null && neutralCurve == null) continue;

                if (IsRootMotionBinding(binding))
                {
                    var rootBaseline = neutralCurve != null ? neutralCurve.Evaluate(0f) : 0f;
                    AnimationUtility.SetEditorCurve(
                        result,
                        binding,
                        AnimationCurve.Constant(0f, PerformanceClipDurationSeconds, rootBaseline));
                    continue;
                }

                var keys = new List<Keyframe>();
                var neutralStart = Evaluate(neutralCurve, danceCurve, 0f);
                if (danceCurve != null)
                {
                    foreach (var sourceKey in danceCurve.keys)
                    {
                        var time = Mathf.Clamp01(sourceKey.time / dance.length);
                        if (time >= PerformanceExitStartSeconds) continue;
                        keys.Add(new Keyframe(time, sourceKey.value, sourceKey.inTangent, sourceKey.outTangent));
                    }
                }
                else
                {
                    keys.Add(new Keyframe(0f, neutralStart));
                }
                var safeExitValue = Evaluate(
                    danceCurve,
                    neutralCurve,
                    dance.length * PerformanceSafeExitTimeSeconds);
                keys.Add(new Keyframe(PerformanceExitStartSeconds, safeExitValue, 0f, 0f));
                keys.Add(new Keyframe(PerformanceClipDurationSeconds, neutralStart, 0f, 0f));
                var outputCurve = new AnimationCurve(keys.ToArray());
                AnimationUtility.SetEditorCurve(result, binding, outputCurve);
            }

            result.EnsureQuaternionContinuity();
            SetLoopTime(result, false);
            return result;
        }

        private static Dictionary<EditorCurveBinding, AnimationCurve> GetCurves(AnimationClip clip)
        {
            var result = new Dictionary<EditorCurveBinding, AnimationCurve>();
            foreach (var binding in AnimationUtility.GetCurveBindings(clip))
            {
                var curve = AnimationUtility.GetEditorCurve(clip, binding);
                if (curve != null) result[binding] = curve;
            }
            return result;
        }

        private static float Evaluate(
            AnimationCurve preferred,
            AnimationCurve fallback,
            float time)
        {
            if (preferred != null) return preferred.Evaluate(time);
            return fallback != null ? fallback.Evaluate(0f) : 0f;
        }

        private static bool IsRootMotionBinding(EditorCurveBinding binding)
        {
            var property = binding.propertyName ?? string.Empty;
            return property.StartsWith("RootT", StringComparison.Ordinal)
                || property.StartsWith("RootQ", StringComparison.Ordinal)
                || property.StartsWith("MotionT", StringComparison.Ordinal)
                || property.StartsWith("MotionQ", StringComparison.Ordinal);
        }

        private static AnimationClip RequireClip(IEnumerable<AnimationClip> clips, string name)
        {
            var matches = clips.Where(clip => string.Equals(
                NormalizeClipName(clip.name),
                name,
                StringComparison.OrdinalIgnoreCase)).ToArray();
            if (matches.Length != 1)
            {
                throw new InvalidOperationException(
                    $"Expected one UAL1 clip named '{name}'; found {matches.Length}.");
            }
            return matches[0];
        }

        private static string NormalizeClipName(string value)
        {
            var separator = value.LastIndexOf('|');
            var result = separator >= 0 ? value.Substring(separator + 1) : value;
            return result.EndsWith("_Loop", StringComparison.OrdinalIgnoreCase)
                ? result.Substring(0, result.Length - "_Loop".Length)
                : result;
        }

        private static void ValidateLocalSource()
        {
            if (AssetDatabase.LoadAssetAtPath<UnityEngine.Object>(SourcePath) == null)
            {
                throw new InvalidOperationException(
                    "Import Quaternius Universal Animation Library 1 Standard before generating Phase C samples.");
            }
            var licensePath = Path.GetFullPath(SourceLicensePath);
            if (!File.Exists(licensePath)
                || File.ReadAllText(licensePath).IndexOf("CC0 1.0", StringComparison.OrdinalIgnoreCase) < 0)
            {
                throw new InvalidOperationException("UAL1 source has no verifiable CC0 1.0 license file.");
            }
        }

        private static void CreateOrReplace<T>(T generated, string path)
            where T : UnityEngine.Object
        {
            var existing = AssetDatabase.LoadAssetAtPath<T>(path);
            if (existing == null)
            {
                AssetDatabase.CreateAsset(generated, path);
                return;
            }
            EditorUtility.CopySerialized(generated, existing);
            existing.name = generated.name;
            EditorUtility.SetDirty(existing);
            UnityEngine.Object.DestroyImmediate(generated);
        }

        private static void SetLoopTime(AnimationClip clip, bool value)
        {
            var serialized = new SerializedObject(clip);
            var settings = serialized.FindProperty("m_AnimationClipSettings");
            settings.FindPropertyRelative("m_LoopTime").boolValue = value;
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
