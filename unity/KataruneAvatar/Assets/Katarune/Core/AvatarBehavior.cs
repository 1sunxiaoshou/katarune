using System;
using UnityEngine;

namespace Katarune.Avatar
{
    public enum AvatarAffectPreset
    {
        Neutral,
        Happy,
        Relaxed,
        Sad,
        Angry,
        Surprised,
    }

    public static class AvatarCoordinateSpace
    {
        public static float ViewportYawToAvatarYaw(float viewportYaw)
        {
            return -viewportYaw;
        }

        public static float AvatarYawToViewportYaw(float avatarYaw)
        {
            return -avatarYaw;
        }
    }

    public interface IAvatarRandom
    {
        float Range(float minimum, float maximum);
        int Range(int minimumInclusive, int maximumExclusive);
    }

    public sealed class SystemAvatarRandom : IAvatarRandom
    {
        private readonly System.Random _random;

        public SystemAvatarRandom(int? seed = null)
        {
            _random = seed.HasValue ? new System.Random(seed.Value) : new System.Random();
        }

        public float Range(float minimum, float maximum)
        {
            return Mathf.Lerp(minimum, maximum, (float)_random.NextDouble());
        }

        public int Range(int minimumInclusive, int maximumExclusive)
        {
            return _random.Next(minimumInclusive, maximumExclusive);
        }
    }

    public sealed class AvatarPoseFrame
    {
        public bool HasAuthoredBodyPose;
        public float ProceduralBodyWeight = 1f;
        public float ProceduralArmWeight = 1f;
        public float Blink;
        public float GazeYaw;
        public float GazePitch;
        public Vector2 ProceduralGazeCompensation;
        public float Happy;
        public float Relaxed;
        public float Sad;
        public float Angry;
        public float Surprised;
        public float Aa;
        public float Ih;
        public float Ou;
        public float Ee;
        public float Oh;
        public Vector3 SpringBoneExternalForce;
        public Vector3 HipsPositionOffset;
        public Vector3 SpineEuler;
        public Vector3 ChestEuler;
        public Vector3 UpperChestEuler;
        public Vector3 NeckEuler;
        public Vector3 HeadEuler;
        public Vector3 LeftUpperArmEuler;
        public Vector3 RightUpperArmEuler;
        public Vector3 LeftLowerArmEuler;
        public Vector3 RightLowerArmEuler;
    }

    public sealed class AvatarBehaviorModel
    {
        private const float BlinkClosingSeconds = 0.07f;
        private const float BlinkClosedSeconds = 0.04f;
        private const float BlinkOpeningSeconds = 0.11f;
        private const float DoubleBlinkPauseSeconds = 0.09f;
        private const float ExpressionResponseSeconds = 0.12f;

        private readonly IAvatarRandom _random;
        private readonly HeadEyeGazeProfile _gazeProfile;
        private readonly HeadEyeGazeCoordinator _gazeCoordinator;
        private readonly AvatarPoseFrame _frame = new AvatarPoseFrame();
        private readonly float[] _expressionWeights = new float[5];
        private readonly float[] _mouthWeights = new float[5];
        private readonly float[] _mouthTargets = new float[5];
        private readonly float[] _manualMouth = new float[5];

        private float _elapsed;
        private float _blinkWait;
        private float _blinkElapsed;
        private int _blinkStage;
        private bool _doubleBlinkPending;
        private float _blinkWeight;
        private bool _lastPointerGazeTrackingEnabled;

        public AvatarBehaviorModel(IAvatarRandom random = null)
        {
            _random = random ?? new SystemAvatarRandom();
            _gazeProfile = HeadEyeGazeProfile.Default;
            _gazeCoordinator = new HeadEyeGazeCoordinator(_gazeProfile);
            Reset();
        }

        public AvatarAffectPreset Affect { get; private set; }
        public bool PointerGazeTrackingEnabled { get; private set; }
        public float AffectIntensity { get; private set; }
        public bool BlinkingEnabled { get; private set; }
        public AvatarPoseFrame CurrentFrame => _frame;

        public AvatarBehaviorSettings Settings => new AvatarBehaviorSettings(
            Affect,
            AffectIntensity,
            BlinkingEnabled,
            PointerGazeTrackingEnabled);

        public void SetAffect(AvatarAffectPreset affect, float intensity)
        {
            Affect = affect;
            AffectIntensity = Mathf.Clamp01(intensity);
        }

        public void ApplySettings(AvatarBehaviorSettings settings)
        {
            SetAffect(settings.Affect, settings.AffectIntensity);
            BlinkingEnabled = settings.BlinkingEnabled;
            PointerGazeTrackingEnabled = settings.PointerGazeTrackingEnabled;
        }

        public void SetManualVisemes(float aa, float ih, float ou, float ee, float oh)
        {
            _manualMouth[0] = Mathf.Clamp01(aa);
            _manualMouth[1] = Mathf.Clamp01(ih);
            _manualMouth[2] = Mathf.Clamp01(ou);
            _manualMouth[3] = Mathf.Clamp01(ee);
            _manualMouth[4] = Mathf.Clamp01(oh);
            // A cleared speech input is a lifecycle boundary, not an asymptotic fade.
            if (aa == 0f && ih == 0f && ou == 0f && ee == 0f && oh == 0f)
            {
                Array.Clear(_mouthWeights, 0, _mouthWeights.Length);
                _frame.Aa = _frame.Ih = _frame.Ou = _frame.Ee = _frame.Oh = 0f;
            }
        }

        public void SetManualVisemes(AvatarVisemeWeights weights)
        {
            SetManualVisemes(weights.Aa, weights.Ih, weights.Ou, weights.Ee, weights.Oh);
        }

        public void RequestBlink()
        {
            StartBlink(false);
        }

        public void Reset()
        {
            Affect = AvatarAffectPreset.Neutral;
            AffectIntensity = 0f;
            BlinkingEnabled = true;
            PointerGazeTrackingEnabled = false;
            _elapsed = 0f;
            _blinkStage = 0;
            _blinkElapsed = 0f;
            _blinkWeight = 0f;
            _doubleBlinkPending = false;
            ScheduleBlink();
            _lastPointerGazeTrackingEnabled = false;
            _gazeCoordinator.Reset();
            Array.Clear(_expressionWeights, 0, _expressionWeights.Length);
            Array.Clear(_mouthWeights, 0, _mouthWeights.Length);
            Array.Clear(_mouthTargets, 0, _mouthTargets.Length);
            Array.Clear(_manualMouth, 0, _manualMouth.Length);
            WriteFrame(AvatarBasePoseProfile.Default, HeadEyeGazePose.Zero);
        }

        public AvatarPoseFrame Tick(float deltaTime, Vector2 gazeTargetAngles)
        {
            deltaTime = Mathf.Max(0f, deltaTime);
            _elapsed += deltaTime;
            var profile = AvatarBasePoseProfile.Default;

            UpdateBlink(deltaTime);
            var gaze = UpdateGaze(deltaTime, gazeTargetAngles, profile);
            UpdateExpression(deltaTime);
            UpdateMouth(deltaTime);
            WriteFrame(profile, gaze);
            return _frame;
        }

        private void UpdateBlink(float deltaTime)
        {
            if (!BlinkingEnabled)
            {
                _blinkStage = 0;
                _blinkWeight = Mathf.MoveTowards(_blinkWeight, 0f, deltaTime / BlinkOpeningSeconds);
                return;
            }

            switch (_blinkStage)
            {
                case 0:
                    _blinkWait -= deltaTime;
                    if (_blinkWait <= 0f) StartBlink(true);
                    break;
                case 1:
                    _blinkElapsed += deltaTime;
                    _blinkWeight = Mathf.Clamp01(_blinkElapsed / BlinkClosingSeconds);
                    if (_blinkElapsed >= BlinkClosingSeconds) AdvanceBlinkStage(2);
                    break;
                case 2:
                    _blinkElapsed += deltaTime;
                    _blinkWeight = 1f;
                    if (_blinkElapsed >= BlinkClosedSeconds) AdvanceBlinkStage(3);
                    break;
                case 3:
                    _blinkElapsed += deltaTime;
                    _blinkWeight = 1f - Mathf.Clamp01(_blinkElapsed / BlinkOpeningSeconds);
                    if (_blinkElapsed >= BlinkOpeningSeconds)
                    {
                        _blinkWeight = 0f;
                        if (_doubleBlinkPending)
                        {
                            _doubleBlinkPending = false;
                            AdvanceBlinkStage(4);
                        }
                        else
                        {
                            _blinkStage = 0;
                            ScheduleBlink();
                        }
                    }
                    break;
                case 4:
                    _blinkElapsed += deltaTime;
                    if (_blinkElapsed >= DoubleBlinkPauseSeconds) AdvanceBlinkStage(1);
                    break;
            }
        }

        private void StartBlink(bool allowDoubleBlink)
        {
            if (_blinkStage != 0) return;
            _doubleBlinkPending = allowDoubleBlink && _random.Range(0f, 1f) < 0.12f;
            AdvanceBlinkStage(1);
        }

        private void AdvanceBlinkStage(int stage)
        {
            _blinkStage = stage;
            _blinkElapsed = 0f;
        }

        private void ScheduleBlink()
        {
            _blinkWait = _random.Range(2.5f, 6f);
        }

        private HeadEyeGazePose UpdateGaze(float deltaTime, Vector2 gazeTargetAngles, AvatarBasePoseProfile profile)
        {
            var trackingChanged = _lastPointerGazeTrackingEnabled != PointerGazeTrackingEnabled;
            _lastPointerGazeTrackingEnabled = PointerGazeTrackingEnabled;
            if (PointerGazeTrackingEnabled)
            {
                if (trackingChanged) _gazeCoordinator.SetFixationTarget(gazeTargetAngles);
                else _gazeCoordinator.TrackTarget(gazeTargetAngles);
            }
            else if (trackingChanged)
            {
                _gazeCoordinator.SetFixationTarget(profile.GazeOffset);
            }

            return _gazeCoordinator.Tick(deltaTime);
        }

        private void UpdateExpression(float deltaTime)
        {
            var targetIndex = Affect == AvatarAffectPreset.Neutral ? -1 : (int)Affect - 1;
            var blend = 1f - Mathf.Exp(-deltaTime / ExpressionResponseSeconds);
            for (var index = 0; index < _expressionWeights.Length; index += 1)
            {
                var target = index == targetIndex ? Mathf.Clamp01(AffectIntensity) : 0f;
                _expressionWeights[index] = Mathf.Lerp(_expressionWeights[index], target, blend);
            }
        }

        private void UpdateMouth(float deltaTime)
        {
            Array.Copy(_manualMouth, _mouthTargets, _mouthTargets.Length);

            var blend = 1f - Mathf.Exp(-deltaTime / 0.055f);
            for (var index = 0; index < _mouthWeights.Length; index += 1)
            {
                _mouthWeights[index] = Mathf.Lerp(_mouthWeights[index], _mouthTargets[index], blend);
            }
        }

        private void WriteFrame(AvatarBasePoseProfile profile, HeadEyeGazePose gaze)
        {
            _frame.Blink = _blinkWeight;
            _frame.GazeYaw = gaze.Eyes.x;
            _frame.GazePitch = gaze.Eyes.y;
            _frame.ProceduralGazeCompensation = Vector2.zero;
            _frame.Happy = _expressionWeights[0];
            _frame.Relaxed = _expressionWeights[1];
            _frame.Sad = _expressionWeights[2];
            _frame.Angry = _expressionWeights[3];
            _frame.Surprised = _expressionWeights[4];
            _frame.Aa = _mouthWeights[0];
            _frame.Ih = _mouthWeights[1];
            _frame.Ou = _mouthWeights[2];
            _frame.Ee = _mouthWeights[3];
            _frame.Oh = _mouthWeights[4];
            _frame.SpringBoneExternalForce = AvatarAmbientWind.Sample(_elapsed);

            var bodyEnergy = profile.BodyEnergy;
            _frame.HipsPositionOffset = Vector3.zero;
            _frame.SpineEuler = new Vector3(profile.SpinePitch, 0f, 0f);
            _frame.ChestEuler = new Vector3(profile.ChestPitch, 0f, 0f);
            _frame.UpperChestEuler = Vector3.zero;
            var avatarYaw = AvatarCoordinateSpace.ViewportYawToAvatarYaw(gaze.Head.x);
            _frame.NeckEuler = new Vector3(
                profile.HeadPitch * 0.25f + gaze.Head.y * -0.3f,
                avatarYaw * 0.35f,
                profile.HeadTilt * 0.35f);
            _frame.HeadEuler = new Vector3(
                profile.HeadPitch + gaze.Head.y * -0.7f,
                avatarYaw * 0.65f,
                profile.HeadTilt);
            _frame.LeftUpperArmEuler = new Vector3(0f, profile.ArmForward, 72f - profile.ArmOpenness);
            _frame.RightUpperArmEuler = new Vector3(0f, -profile.ArmForward, -72f + profile.ArmOpenness);
            _frame.LeftLowerArmEuler = new Vector3(0f, -8f - bodyEnergy * 2f, 0f);
            _frame.RightLowerArmEuler = new Vector3(0f, 8f + bodyEnergy * 2f, 0f);
        }

        private readonly struct AvatarBasePoseProfile
        {
            public AvatarBasePoseProfile(
                float bodyEnergy,
                float spinePitch,
                float chestPitch,
                float headPitch,
                float headTilt,
                float armForward,
                float armOpenness,
                Vector2 gazeOffset)
            {
                BodyEnergy = bodyEnergy;
                SpinePitch = spinePitch;
                ChestPitch = chestPitch;
                HeadPitch = headPitch;
                HeadTilt = headTilt;
                ArmForward = armForward;
                ArmOpenness = armOpenness;
                GazeOffset = gazeOffset;
            }

            public float BodyEnergy { get; }
            public float SpinePitch { get; }
            public float ChestPitch { get; }
            public float HeadPitch { get; }
            public float HeadTilt { get; }
            public float ArmForward { get; }
            public float ArmOpenness { get; }
            public Vector2 GazeOffset { get; }

            public static AvatarBasePoseProfile Default => new AvatarBasePoseProfile(
                0.34f,
                0f,
                0f,
                0f,
                0f,
                0f,
                0f,
                Vector2.zero);
        }
    }
}
