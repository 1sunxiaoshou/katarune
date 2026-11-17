using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UniHumanoid;
using UnityEditor;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Katarune.Avatar.Editor
{
    public static class AvatarHumanoidClipValidator
    {
        private static Dictionary<string, string> _muscleBindings;

        private static Dictionary<string, string> MuscleBindings
        {
            get
            {
                if (_muscleBindings != null) return _muscleBindings;
                var pose = new HumanPose { muscles = new float[HumanTrait.MuscleCount], bodyRotation = Quaternion.identity };
                // Unique marker values recover the property names from UniHumanoid's public exporter,
                // without reflecting its private map or maintaining another table of finger names.
                for (var i = 0; i < pose.muscles.Length; i++) pose.muscles[i] = i + 1;
                var sample = AnimationClipUtility.CreateAnimationClipFromHumanPose(pose);
                try
                {
                    var map = new Dictionary<string, string>(StringComparer.Ordinal);
                    foreach (var binding in AnimationUtility.GetCurveBindings(sample))
                    {
                        if (binding.propertyName.StartsWith("Root", StringComparison.Ordinal)) continue;
                        var index = Mathf.RoundToInt(AnimationUtility.GetEditorCurve(sample, binding).Evaluate(0f)) - 1;
                        if (index < 0 || index >= HumanTrait.MuscleCount)
                            throw new InvalidDataException("UniHumanoid muscle binding probe returned an invalid index.");
                        map.Add(HumanTrait.MuscleName[index], binding.propertyName);
                    }
                    if (map.Count != HumanTrait.MuscleCount)
                        throw new InvalidDataException("UniHumanoid muscle binding map is incomplete.");
                    return _muscleBindings = map;
                }
                finally { Object.DestroyImmediate(sample); }
            }
        }

        public static void ValidateBindings(AnimationClip clip)
        {
            var map = MuscleBindings;
            var known = new HashSet<string>(map.Values, StringComparer.Ordinal)
            { "RootT.x", "RootT.y", "RootT.z", "RootQ.x", "RootQ.y", "RootQ.z", "RootQ.w" };
            foreach (var prefix in new[] { "Motion", "LeftFoot", "RightFoot", "LeftHand", "RightHand" })
            {
                foreach (var axis in "xyz") known.Add(prefix + "T." + axis);
                foreach (var axis in "xyzw") known.Add(prefix + "Q." + axis);
            }
            // Native stopping clips also contain humanoid upper-leg translation DoF.
            foreach (var side in new[] { "LeftHand", "RightHand", "LeftUpperLeg", "RightUpperLeg" })
                foreach (var axis in "xyz") known.Add(side + "TDOF." + axis);
            var targets = new HashSet<string>(StringComparer.Ordinal);
            if (AnimationUtility.GetObjectReferenceCurveBindings(clip).Length != 0)
                throw new InvalidDataException("Humanoid body packs cannot contain object-reference animation curves.");
            foreach (var source in AnimationUtility.GetCurveBindings(clip))
            {
                var name = map.TryGetValue(source.propertyName, out var canonical) ? canonical : source.propertyName;
                if (source.type != typeof(Animator) || source.path != string.Empty || !known.Contains(name))
                    throw new InvalidDataException($"Unsupported Humanoid body binding: {source.path}/{source.propertyName}");
                if (!targets.Add(name)) throw new InvalidDataException("Conflicting muscle bindings: " + name);
                if (name != source.propertyName)
                    throw new InvalidDataException($"Muscle display name '{source.propertyName}' is not an animation binding. Re-export it as '{name}' using a corrected converter.");
                foreach (var key in AnimationUtility.GetEditorCurve(clip, source).keys)
                    if (!float.IsFinite(key.time) || !float.IsFinite(key.value) || float.IsNaN(key.inTangent) || float.IsNaN(key.outTangent))
                        throw new InvalidDataException("Humanoid curve contains invalid keyframes.");
            }
        }

        public static AnimationClip ExtractHumanoidBody(AnimationClip source)
        {
            if (source == null || source.legacy || !source.isHumanMotion || source.events.Length != 0
                || AnimationUtility.GetObjectReferenceCurveBindings(source).Length != 0)
                throw new InvalidDataException("Select a non-legacy Humanoid clip without events or object-reference curves.");
            var clip = Object.Instantiate(source);
            try
            {
                var excluded = AnimationUtility.GetCurveBindings(clip).Where(binding => binding.type != typeof(Animator) || binding.path != string.Empty).ToArray();
                AnimationUtility.SetEditorCurves(clip, excluded, new AnimationCurve[excluded.Length]);
                var renamed = 0;
                foreach (var binding in AnimationUtility.GetCurveBindings(clip))
                {
                    // Some Unity asset exporters spell finger spread with a dot.
                    // Preserve the curve, but use Unity's actual muscle property name.
                    var canonical = binding.propertyName.Replace(".Spread", " Spread");
                    if (canonical == binding.propertyName || !MuscleBindings.ContainsValue(canonical)) continue;
                    var corrected = binding; corrected.propertyName = canonical;
                    if (AnimationUtility.GetEditorCurve(clip, corrected) != null) throw new InvalidDataException("Duplicate finger spread bindings.");
                    var curve = AnimationUtility.GetEditorCurve(clip, binding);
                    AnimationUtility.SetEditorCurve(clip, binding, null);
                    AnimationUtility.SetEditorCurve(clip, corrected, curve); renamed++;
                }
                ValidateBindings(clip);
                clip.name = source.name;
                Debug.Log($"KATARUNE_HUMANOID_EXTRACT excludedCharacterTracks={excluded.Length} canonicalFingerBindings={renamed}");
                return clip;
            }
            catch { Object.DestroyImmediate(clip); throw; }
        }
    }
}
