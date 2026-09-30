using System;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Katarune.Avatar.Editor
{
    // Offline authoring: keep the source rhythm, stance and root motion intact.
    public static class AvatarIdleEnhancer
    {
        [MenuItem("Katarune/Avatar/Enhance Selected Idle Clip")]
        public static void EnhanceSelected()
        {
            var source = Selection.activeObject as AnimationClip;
            if (source == null) throw new InvalidOperationException("Select a Humanoid idle .anim first.");
            var path = AssetDatabase.GenerateUniqueAssetPath(
                Path.ChangeExtension(AssetDatabase.GetAssetPath(source), null) + "-enhanced.anim");
            Selection.activeObject = Create(source, path);
        }

        public static AnimationClip Create(AnimationClip source, string outputPath)
        {
            if (source == null || !source.isHumanMotion || !source.isLooping || source.length <= 0f)
                throw new ArgumentException("Source must be a looping Humanoid clip.");
            if (File.Exists(outputPath)) throw new IOException("Refusing to overwrite " + outputPath);
            AvatarHumanoidClipValidator.ValidateBindings(source);
            var clip = UnityEngine.Object.Instantiate(source);
            clip.name = Path.GetFileNameWithoutExtension(outputPath);
            var changed = 0;
            try
            {
                foreach (var binding in AnimationUtility.GetCurveBindings(source))
                {
                    var gain = Gain(binding.propertyName);
                    if (gain == 1f) continue;
                    var original = AnimationUtility.GetEditorCurve(source, binding);
                    // Time-sampled mean avoids bias from unevenly spaced authored keys.
                    var mean = 0f;
                    for (var i = 0; i < 240; i++) mean += original.Evaluate(source.length * i / 240f) / 240f;
                    var peak = 0f;
                    for (var i = 0; i <= 960; i++)
                        peak = Mathf.Max(peak, Mathf.Abs(original.Evaluate(source.length * i / 960f) - mean));
                    if (peak < 0.00001f) continue;
                    // Reduce gain uniformly near muscle limits instead of clipping the waveform.
                    gain = Mathf.Max(1f, Mathf.Min(gain, (1f - Mathf.Abs(mean)) / peak));
                    var keys = original.keys;
                    for (var i = 0; i < keys.Length; i++)
                    {
                        keys[i].value = mean + (keys[i].value - mean) * gain;
                        keys[i].inTangent *= gain;
                        keys[i].outTangent *= gain;
                    }
                    var curve = new AnimationCurve(keys)
                    {
                        preWrapMode = original.preWrapMode,
                        postWrapMode = original.postWrapMode,
                    };
                    AnimationUtility.SetEditorCurve(clip, binding, curve);
                    changed++;
                }
                if (changed == 0) throw new InvalidDataException("No animated upper-body muscles found.");
                AvatarHumanoidClipValidator.ValidateBindings(clip);
                AssetDatabase.CreateAsset(clip, outputPath);
                AssetDatabase.SaveAssets();
                Debug.Log($"KATARUNE_IDLE_ENHANCED path={outputPath} duration={clip.length:F3} curves={changed}");
                return clip;
            }
            catch
            {
                if (!AssetDatabase.Contains(clip)) UnityEngine.Object.DestroyImmediate(clip);
                throw;
            }
        }

        private static float Gain(string name)
        {
            if (name.StartsWith("Spine", StringComparison.Ordinal)
                || name.StartsWith("Chest", StringComparison.Ordinal)
                || name.StartsWith("UpperChest", StringComparison.Ordinal)
                || name.Contains("Shoulder")) return 2f;
            if (name.StartsWith("Head", StringComparison.Ordinal)
                || name.StartsWith("Neck", StringComparison.Ordinal)) return 1.8f;
            if (name.Contains("Arm") || name.Contains("Forearm")) return 1.6f;
            return 1f;
        }
    }
}
