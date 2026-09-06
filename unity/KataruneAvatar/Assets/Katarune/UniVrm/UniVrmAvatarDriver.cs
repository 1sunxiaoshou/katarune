using System;
using System.Collections.Generic;
using System.Linq;
using UniGLTF.SpringBoneJobs.Blittables;
using UniVRM10;
using UnityEngine;

namespace Katarune.Avatar
{
    public sealed class UniVrmAvatarDriver : IAvatarDriver, IAvatarGazeGeometryProvider
    {
        private readonly Vrm10Instance _instance;
        private readonly Vrm10Runtime _runtime;
        private readonly HashSet<ExpressionKey> _supportedExpressions;
        private readonly Dictionary<string, ExpressionKey> _customExpressions;
        private readonly Dictionary<AvatarAffectPreset, CustomExpressionBinding[]> _affectFallbacks;
        private readonly Dictionary<ExpressionKey, float> _customAffectWeights = new Dictionary<ExpressionKey, float>(ExpressionKey.Comparer);
        private readonly Dictionary<HumanBodyBones, BoneBaseline> _bones = new Dictionary<HumanBodyBones, BoneBaseline>();

        public UniVrmAvatarDriver(Vrm10Instance instance)
        {
            _instance = instance != null ? instance : throw new ArgumentNullException(nameof(instance));
            _runtime = instance.Runtime ?? throw new InvalidOperationException("The VRM runtime was not initialized.");
            if (_runtime.ControlRig == null)
            {
                throw new InvalidOperationException("The VRM was loaded without a normalized control rig.");
            }

            _supportedExpressions = new HashSet<ExpressionKey>(ExpressionKey.Comparer);
            foreach (var (_, clip) in _instance.Vrm.Expression.Clips)
            {
                if (!HasBindings(clip)) continue;
                _supportedExpressions.Add(_instance.Vrm.Expression.CreateKey(clip));
            }
            _customExpressions = _supportedExpressions
                .Where(key => key.Preset == ExpressionPreset.custom)
                .GroupBy(key => key.Name, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);
            _affectFallbacks = BuildAffectFallbacks();
            var affectCapabilities = string.Join(",", Enum.GetValues(typeof(AvatarAffectPreset))
                .Cast<AvatarAffectPreset>()
                .Select(preset => $"{preset}:{(SupportsAffect(preset) ? "yes" : "no")}"));
            Debug.Log($"KATARUNE_AVATAR_EXPRESSION_CAPABILITIES effective={_supportedExpressions.Count} custom={_customExpressions.Count} affects={affectCapabilities}");
            CaptureBone(HumanBodyBones.Hips);
            CaptureBone(HumanBodyBones.Spine);
            CaptureBone(HumanBodyBones.Chest);
            CaptureBone(HumanBodyBones.UpperChest);
            CaptureBone(HumanBodyBones.Neck);
            CaptureBone(HumanBodyBones.Head);
            CaptureBone(HumanBodyBones.LeftUpperArm);
            CaptureBone(HumanBodyBones.RightUpperArm);
            CaptureBone(HumanBodyBones.LeftLowerArm);
            CaptureBone(HumanBodyBones.RightLowerArm);
            _instance.LookAtTargetType = VRM10ObjectLookAt.LookAtTargetTypes.YawPitchValue;
        }

        public bool SupportsAffect(AvatarAffectPreset preset)
        {
            if (preset == AvatarAffectPreset.Neutral) return true;
            return _supportedExpressions.Contains(GetAffectKey(preset))
                || (_affectFallbacks.TryGetValue(preset, out var bindings) && bindings.Length > 0);
        }

        public bool TryGetGazeGeometry(out AvatarGazeGeometry geometry)
        {
            var origin = _runtime.LookAt.LookAtOriginTransform;
            if (origin == null || _instance == null)
            {
                geometry = default;
                return false;
            }

            geometry = new AvatarGazeGeometry(origin.position, _instance.transform.rotation);
            return true;
        }

        public void Apply(AvatarPoseFrame frame)
        {
            if (frame == null) throw new ArgumentNullException(nameof(frame));
            _runtime.SpringBone.SetModelLevel(
                _instance.transform,
                new BlittableModelLevel(
                    externalForce: frame.SpringBoneExternalForce,
                    supportsScalingAtRuntime: true));
            if (!frame.HasAuthoredBodyPose) RestoreBones();
            var authoredGazeCompensation = Vector2.zero;
            if (frame.HasAuthoredBodyPose && _bones.TryGetValue(HumanBodyBones.Head, out var head))
            {
                var forward = Quaternion.Inverse(_instance.transform.rotation) * head.Transform.forward;
                authoredGazeCompensation = new Vector2(
                    Mathf.Atan2(forward.x, forward.z) * Mathf.Rad2Deg,
                    -Mathf.Asin(Mathf.Clamp(forward.y, -1f, 1f)) * Mathf.Rad2Deg);
            }
            var bodyWeight = Mathf.Clamp01(frame.ProceduralBodyWeight);
            ApplyPosition(HumanBodyBones.Hips, frame.HipsPositionOffset, bodyWeight, frame.HasAuthoredBodyPose);
            ApplyRotation(HumanBodyBones.Spine, frame.SpineEuler, bodyWeight, frame.HasAuthoredBodyPose);
            ApplyRotation(HumanBodyBones.Chest, frame.ChestEuler, bodyWeight, frame.HasAuthoredBodyPose);
            ApplyRotation(HumanBodyBones.UpperChest, frame.UpperChestEuler, bodyWeight, frame.HasAuthoredBodyPose);
            ApplyRotation(HumanBodyBones.Neck, frame.NeckEuler, bodyWeight, frame.HasAuthoredBodyPose);
            ApplyRotation(HumanBodyBones.Head, frame.HeadEuler, bodyWeight, frame.HasAuthoredBodyPose);
            var armWeight = Mathf.Clamp01(frame.ProceduralArmWeight);
            if (armWeight > 0f)
            {
                ApplyRotation(HumanBodyBones.LeftUpperArm, frame.LeftUpperArmEuler, armWeight, false);
                ApplyRotation(HumanBodyBones.RightUpperArm, frame.RightUpperArmEuler, armWeight, false);
                ApplyRotation(HumanBodyBones.LeftLowerArm, frame.LeftLowerArmEuler, armWeight, false);
                ApplyRotation(HumanBodyBones.RightLowerArm, frame.RightLowerArmEuler, armWeight, false);
            }

            _runtime.LookAt.SetYawPitchManually(
                AvatarCoordinateSpace.ViewportYawToAvatarYaw(
                    frame.GazeYaw + authoredGazeCompensation.x + frame.ProceduralGazeCompensation.x * bodyWeight),
                frame.GazePitch + authoredGazeCompensation.y + frame.ProceduralGazeCompensation.y * bodyWeight);
            SetBlink(frame.Blink);
            ApplyAffects(frame);
            SetWeight(ExpressionKey.Aa, frame.Aa);
            SetWeight(ExpressionKey.Ih, frame.Ih);
            SetWeight(ExpressionKey.Ou, frame.Ou);
            SetWeight(ExpressionKey.Ee, frame.Ee);
            SetWeight(ExpressionKey.Oh, frame.Oh);
        }

        public void ResetPose()
        {
            RestoreBones();
            _runtime.SpringBone.SetModelLevel(
                _instance.transform,
                new BlittableModelLevel(supportsScalingAtRuntime: true));
            _runtime.LookAt.SetYawPitchManually(0f, 0f);
            SetWeight(ExpressionKey.Blink, 0f);
            SetWeight(ExpressionKey.Happy, 0f);
            SetWeight(ExpressionKey.Relaxed, 0f);
            SetWeight(ExpressionKey.Sad, 0f);
            SetWeight(ExpressionKey.Angry, 0f);
            SetWeight(ExpressionKey.Surprised, 0f);
            SetWeight(ExpressionKey.Aa, 0f);
            SetWeight(ExpressionKey.Ih, 0f);
            SetWeight(ExpressionKey.Ou, 0f);
            SetWeight(ExpressionKey.Ee, 0f);
            SetWeight(ExpressionKey.Oh, 0f);
            foreach (var key in _customAffectWeights.Keys.ToArray()) SetWeight(key, 0f);
            SetCustomWeight("eyeBlinkLeft", 0f);
            SetCustomWeight("eyeBlinkRight", 0f);
        }

        public void Dispose()
        {
            if (_instance != null) ResetPose();
        }

        private void CaptureBone(HumanBodyBones bone)
        {
            var transform = _runtime.ControlRig.GetBoneTransform(bone);
            if (transform == null) return;
            _bones[bone] = new BoneBaseline(transform, transform.localPosition, transform.localRotation);
        }

        private void RestoreBones()
        {
            foreach (var baseline in _bones.Values)
            {
                if (baseline.Transform == null) continue;
                baseline.Transform.localPosition = baseline.LocalPosition;
                baseline.Transform.localRotation = baseline.LocalRotation;
            }
        }

        private void ApplyPosition(
            HumanBodyBones bone,
            Vector3 offset,
            float weight,
            bool useCurrentPose)
        {
            if (!_bones.TryGetValue(bone, out var baseline) || baseline.Transform == null) return;
            var position = useCurrentPose ? baseline.Transform.localPosition : baseline.LocalPosition;
            baseline.Transform.localPosition = position + offset * weight;
        }

        private void ApplyRotation(
            HumanBodyBones bone,
            Vector3 euler,
            float weight,
            bool useCurrentPose)
        {
            if (!_bones.TryGetValue(bone, out var baseline) || baseline.Transform == null) return;
            var rotation = useCurrentPose ? baseline.Transform.localRotation : baseline.LocalRotation;
            baseline.Transform.localRotation = rotation * Quaternion.Euler(euler * weight);
        }

        private void SetWeight(ExpressionKey key, float value)
        {
            if (!_supportedExpressions.Contains(key)) return;
            _runtime.Expression.SetWeight(key, Mathf.Clamp01(value));
        }

        private void SetBlink(float value)
        {
            if (_supportedExpressions.Contains(ExpressionKey.Blink))
            {
                SetWeight(ExpressionKey.Blink, value);
                return;
            }

            SetCustomWeight("eyeBlinkLeft", value);
            SetCustomWeight("eyeBlinkRight", value);
        }

        private void ApplyAffects(AvatarPoseFrame frame)
        {
            foreach (var key in _customAffectWeights.Keys.ToArray()) _customAffectWeights[key] = 0f;
            AccumulateAffect(AvatarAffectPreset.Happy, ExpressionKey.Happy, frame.Happy);
            AccumulateAffect(AvatarAffectPreset.Relaxed, ExpressionKey.Relaxed, frame.Relaxed);
            AccumulateAffect(AvatarAffectPreset.Sad, ExpressionKey.Sad, frame.Sad);
            AccumulateAffect(AvatarAffectPreset.Angry, ExpressionKey.Angry, frame.Angry);
            AccumulateAffect(AvatarAffectPreset.Surprised, ExpressionKey.Surprised, frame.Surprised);
            foreach (var (key, weight) in _customAffectWeights) SetWeight(key, weight);
        }

        private void AccumulateAffect(AvatarAffectPreset preset, ExpressionKey standardKey, float weight)
        {
            if (_supportedExpressions.Contains(standardKey))
            {
                SetWeight(standardKey, weight);
                return;
            }

            if (!_affectFallbacks.TryGetValue(preset, out var bindings)) return;
            foreach (var binding in bindings)
            {
                var weighted = Mathf.Clamp01(weight * binding.Multiplier);
                if (_customAffectWeights.TryGetValue(binding.Key, out var current))
                {
                    _customAffectWeights[binding.Key] = Mathf.Max(current, weighted);
                }
                else
                {
                    _customAffectWeights.Add(binding.Key, weighted);
                }
            }
        }

        private Dictionary<AvatarAffectPreset, CustomExpressionBinding[]> BuildAffectFallbacks()
        {
            return new Dictionary<AvatarAffectPreset, CustomExpressionBinding[]>
            {
                [AvatarAffectPreset.Happy] = BuildBindings(
                    ("mouthSmileLeft", 1f), ("mouthSmileRight", 1f),
                    ("cheekSquintLeft", 0.35f), ("cheekSquintRight", 0.35f)),
                [AvatarAffectPreset.Relaxed] = BuildBindings(
                    ("mouthSmileLeft", 0.25f), ("mouthSmileRight", 0.25f),
                    ("eyeSquintLeft", 0.25f), ("eyeSquintRight", 0.25f)),
                [AvatarAffectPreset.Sad] = BuildBindings(
                    ("mouthFrownLeft", 0.8f), ("mouthFrownRight", 0.8f),
                    ("browInnerUp", 0.45f)),
                [AvatarAffectPreset.Angry] = BuildBindings(
                    ("browDownLeft", 0.9f), ("browDownRight", 0.9f),
                    ("noseSneerLeft", 0.25f), ("noseSneerRight", 0.25f),
                    ("mouthPressLeft", 0.25f), ("mouthPressRight", 0.25f)),
                [AvatarAffectPreset.Surprised] = BuildBindings(
                    ("browInnerUp", 0.8f),
                    ("browOuterUpLeft", 0.65f), ("browOuterUpRight", 0.65f),
                    ("eyeWideLeft", 0.7f), ("eyeWideRight", 0.7f)),
            };
        }

        private CustomExpressionBinding[] BuildBindings(params (string Name, float Multiplier)[] candidates)
        {
            var bindings = new List<CustomExpressionBinding>();
            foreach (var candidate in candidates)
            {
                if (_customExpressions.TryGetValue(candidate.Name, out var key))
                {
                    bindings.Add(new CustomExpressionBinding(key, candidate.Multiplier));
                }
            }
            return bindings.ToArray();
        }

        private void SetCustomWeight(string name, float value)
        {
            if (_customExpressions.TryGetValue(name, out var key)) SetWeight(key, value);
        }

        private static bool HasBindings(VRM10Expression expression)
        {
            return expression != null
                && ((expression.MorphTargetBindings?.Length ?? 0) > 0
                    || (expression.MaterialColorBindings?.Length ?? 0) > 0
                    || (expression.MaterialUVBindings?.Length ?? 0) > 0);
        }

        private static ExpressionKey GetAffectKey(AvatarAffectPreset preset)
        {
            switch (preset)
            {
                case AvatarAffectPreset.Happy: return ExpressionKey.Happy;
                case AvatarAffectPreset.Relaxed: return ExpressionKey.Relaxed;
                case AvatarAffectPreset.Sad: return ExpressionKey.Sad;
                case AvatarAffectPreset.Angry: return ExpressionKey.Angry;
                case AvatarAffectPreset.Surprised: return ExpressionKey.Surprised;
                default: return ExpressionKey.Neutral;
            }
        }

        private readonly struct BoneBaseline
        {
            public BoneBaseline(Transform transform, Vector3 localPosition, Quaternion localRotation)
            {
                Transform = transform;
                LocalPosition = localPosition;
                LocalRotation = localRotation;
            }

            public Transform Transform { get; }
            public Vector3 LocalPosition { get; }
            public Quaternion LocalRotation { get; }
        }

        private readonly struct CustomExpressionBinding
        {
            public CustomExpressionBinding(ExpressionKey key, float multiplier)
            {
                Key = key;
                Multiplier = multiplier;
            }

            public ExpressionKey Key { get; }
            public float Multiplier { get; }
        }
    }
}
