using System;
using UnityEngine;

namespace Katarune.Avatar
{
    public enum AvatarActivityState
    {
        Idle,
        Listening,
        Thinking,
        Speaking,
    }

    public enum AvatarAffectPreset
    {
        Neutral,
        Happy,
        Relaxed,
        Sad,
        Angry,
        Surprised,
    }

    public enum AvatarGazeMode
    {
        Auto,
        Pointer,
        Manual,
    }

    public static class AvatarCoordinateSpace
    {
        public static float ViewportYawToAvatarYaw(float viewportYaw)
        {
            return -viewportYaw;
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
        public AvatarActivityState Activity;
        public float TransitionProgress;
        public float Blink;
        public float GazeYaw;
        public float GazePitch;
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
        public const float StateTransitionSeconds = 0.25f;

        private const float BlinkClosingSeconds = 0.07f;
        private const float BlinkClosedSeconds = 0.04f;
        private const float BlinkOpeningSeconds = 0.11f;
        private const float DoubleBlinkPauseSeconds = 0.09f;

        private readonly IAvatarRandom _random;
        private readonly AvatarPoseFrame _frame = new AvatarPoseFrame();
        private readonly float[] _expressionWeights = new float[5];
        private readonly float[] _mouthWeights = new float[5];
        private readonly float[] _mouthTargets = new float[5];
        private readonly float[] _manualMouth = new float[5];

        private AvatarActivityProfile _fromProfile;
        private AvatarActivityProfile _toProfile;
        private float _transitionElapsed;
        private float _elapsed;
        private float _swaySeed;
        private float _blinkWait;
        private float _blinkElapsed;
        private int _blinkStage;
        private bool _doubleBlinkPending;
        private float _blinkWeight;
        private float _gazeWait;
        private Vector2 _autoGazeTarget;
        private Vector2 _smoothedGaze;
        private float _mouthWait;

        public AvatarBehaviorModel(IAvatarRandom random = null)
        {
            _random = random ?? new SystemAvatarRandom();
            Reset();
        }

        public AvatarActivityState Activity { get; private set; }
        public AvatarAffectPreset Affect { get; private set; }
        public AvatarGazeMode GazeMode { get; private set; }
        public float AffectIntensity { get; private set; }
        public bool BreathingEnabled { get; private set; }
        public bool BlinkingEnabled { get; private set; }
        public bool SwayEnabled { get; private set; }
        public bool AutoMouthEnabled { get; private set; }
        public float BreathingIntensity { get; private set; }
        public float SwayIntensity { get; private set; }
        public float MouthIntensity { get; private set; }
        public Vector2 ManualGaze { get; private set; }
        public AvatarPoseFrame CurrentFrame => _frame;

        public AvatarBehaviorSettings Settings => new AvatarBehaviorSettings(
            Activity,
            Affect,
            AffectIntensity,
            BreathingEnabled,
            BlinkingEnabled,
            SwayEnabled,
            BreathingIntensity,
            SwayIntensity,
            GazeMode,
            ManualGaze,
            AutoMouthEnabled,
            MouthIntensity);

        public void SetActivity(AvatarActivityState activity)
        {
            if (Activity == activity) return;
            _fromProfile = GetBlendedProfile();
            _toProfile = GetProfile(activity);
            _transitionElapsed = 0f;
            Activity = activity;
            if (activity != AvatarActivityState.Speaking && AutoMouthEnabled) ClearMouthTargets();
        }

        public void SetAffect(AvatarAffectPreset affect, float intensity)
        {
            Affect = affect;
            AffectIntensity = Mathf.Clamp01(intensity);
        }

        public void ApplySettings(AvatarBehaviorSettings settings)
        {
            SetActivity(settings.Activity);
            SetAffect(settings.Affect, settings.AffectIntensity);
            BreathingEnabled = settings.BreathingEnabled;
            BlinkingEnabled = settings.BlinkingEnabled;
            SwayEnabled = settings.SwayEnabled;
            BreathingIntensity = Mathf.Clamp(settings.BreathingIntensity, 0f, 2f);
            SwayIntensity = Mathf.Clamp(settings.SwayIntensity, 0f, 2f);
            GazeMode = settings.GazeMode;
            ManualGaze = new Vector2(
                Mathf.Clamp(settings.ManualGaze.x, -18f, 18f),
                Mathf.Clamp(settings.ManualGaze.y, -10f, 10f));
            AutoMouthEnabled = settings.AutoMouthEnabled;
            MouthIntensity = Mathf.Clamp01(settings.MouthIntensity);
            if (!AutoMouthEnabled) return;
            Array.Clear(_manualMouth, 0, _manualMouth.Length);
        }

        public void SetManualVisemes(float aa, float ih, float ou, float ee, float oh)
        {
            _manualMouth[0] = Mathf.Clamp01(aa);
            _manualMouth[1] = Mathf.Clamp01(ih);
            _manualMouth[2] = Mathf.Clamp01(ou);
            _manualMouth[3] = Mathf.Clamp01(ee);
            _manualMouth[4] = Mathf.Clamp01(oh);
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
            Activity = AvatarActivityState.Idle;
            Affect = AvatarAffectPreset.Neutral;
            GazeMode = AvatarGazeMode.Auto;
            AffectIntensity = 0f;
            BreathingEnabled = true;
            BlinkingEnabled = true;
            SwayEnabled = true;
            AutoMouthEnabled = true;
            BreathingIntensity = 1f;
            SwayIntensity = 1f;
            MouthIntensity = 0.8f;
            ManualGaze = Vector2.zero;
            _fromProfile = GetProfile(Activity);
            _toProfile = _fromProfile;
            _transitionElapsed = StateTransitionSeconds;
            _elapsed = 0f;
            _swaySeed = _random.Range(0f, 100f);
            _blinkStage = 0;
            _blinkElapsed = 0f;
            _blinkWeight = 0f;
            _doubleBlinkPending = false;
            ScheduleBlink();
            _gazeWait = 0f;
            _autoGazeTarget = Vector2.zero;
            _smoothedGaze = Vector2.zero;
            _mouthWait = 0f;
            Array.Clear(_expressionWeights, 0, _expressionWeights.Length);
            Array.Clear(_mouthWeights, 0, _mouthWeights.Length);
            Array.Clear(_mouthTargets, 0, _mouthTargets.Length);
            Array.Clear(_manualMouth, 0, _manualMouth.Length);
            WriteFrame(GetProfile(Activity), Vector2.zero, 0f, 0f);
            _frame.TransitionProgress = 1f;
        }

        public AvatarPoseFrame Tick(float deltaTime, Vector2 pointerNormalized)
        {
            deltaTime = Mathf.Max(0f, deltaTime);
            _elapsed += deltaTime;
            _transitionElapsed = Mathf.Min(StateTransitionSeconds, _transitionElapsed + deltaTime);
            var profile = GetBlendedProfile();
            var transitionProgress = StateTransitionSeconds <= 0f
                ? 1f
                : Mathf.Clamp01(_transitionElapsed / StateTransitionSeconds);

            UpdateBlink(deltaTime);
            var gaze = UpdateGaze(deltaTime, pointerNormalized, profile);
            UpdateExpression(deltaTime);
            UpdateMouth(deltaTime);
            var breathing = BreathingEnabled
                ? Mathf.Sin(_elapsed * Mathf.PI * 2f * profile.BreathFrequency) * BreathingIntensity
                : 0f;
            var sway = SwayEnabled
                ? (Mathf.PerlinNoise(_swaySeed, _elapsed * profile.SwayFrequency) - 0.5f) * 2f * SwayIntensity
                : 0f;

            WriteFrame(profile, gaze, breathing, sway);
            _frame.TransitionProgress = transitionProgress;
            return _frame;
        }

        private AvatarActivityProfile GetBlendedProfile()
        {
            var progress = StateTransitionSeconds <= 0f
                ? 1f
                : Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(_transitionElapsed / StateTransitionSeconds));
            return AvatarActivityProfile.Lerp(_fromProfile, _toProfile, progress);
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

        private Vector2 UpdateGaze(float deltaTime, Vector2 pointerNormalized, AvatarActivityProfile profile)
        {
            Vector2 target;
            switch (GazeMode)
            {
                case AvatarGazeMode.Pointer:
                    target = new Vector2(pointerNormalized.x * 18f, pointerNormalized.y * 10f);
                    break;
                case AvatarGazeMode.Manual:
                    target = new Vector2(
                        Mathf.Clamp(ManualGaze.x, -18f, 18f),
                        Mathf.Clamp(ManualGaze.y, -10f, 10f));
                    break;
                default:
                    _gazeWait -= deltaTime;
                    if (_gazeWait <= 0f)
                    {
                        _autoGazeTarget = new Vector2(
                            _random.Range(-profile.GazeYawRange, profile.GazeYawRange),
                            _random.Range(-profile.GazePitchRange, profile.GazePitchRange));
                        _gazeWait = _random.Range(profile.GazeHoldMinimum, profile.GazeHoldMaximum);
                    }
                    target = _autoGazeTarget + profile.GazeOffset;
                    break;
            }

            target.x = Mathf.Clamp(target.x, -18f, 18f);
            target.y = Mathf.Clamp(target.y, -10f, 10f);
            var blend = 1f - Mathf.Exp(-deltaTime / Mathf.Max(0.01f, profile.GazeResponse));
            _smoothedGaze = Vector2.Lerp(_smoothedGaze, target, blend);
            return _smoothedGaze;
        }

        private void UpdateExpression(float deltaTime)
        {
            var targetIndex = Affect == AvatarAffectPreset.Neutral ? -1 : (int)Affect - 1;
            var blend = 1f - Mathf.Exp(-deltaTime / 0.2f);
            for (var index = 0; index < _expressionWeights.Length; index += 1)
            {
                var target = index == targetIndex ? Mathf.Clamp01(AffectIntensity) : 0f;
                _expressionWeights[index] = Mathf.Lerp(_expressionWeights[index], target, blend);
            }
        }

        private void UpdateMouth(float deltaTime)
        {
            if (AutoMouthEnabled)
            {
                if (Activity == AvatarActivityState.Speaking)
                {
                    _mouthWait -= deltaTime;
                    if (_mouthWait <= 0f)
                    {
                        ClearMouthTargets();
                        var primary = _random.Range(0, _mouthTargets.Length);
                        _mouthTargets[primary] = _random.Range(0.35f, 1f) * MouthIntensity;
                        if (_random.Range(0f, 1f) < 0.3f)
                        {
                            var secondary = (primary + _random.Range(1, _mouthTargets.Length)) % _mouthTargets.Length;
                            _mouthTargets[secondary] = _random.Range(0.08f, 0.28f) * MouthIntensity;
                        }
                        _mouthWait = _random.Range(0.08f, 0.18f);
                    }
                }
                else
                {
                    ClearMouthTargets();
                }
            }
            else
            {
                Array.Copy(_manualMouth, _mouthTargets, _mouthTargets.Length);
            }

            var blend = 1f - Mathf.Exp(-deltaTime / 0.055f);
            for (var index = 0; index < _mouthWeights.Length; index += 1)
            {
                _mouthWeights[index] = Mathf.Lerp(_mouthWeights[index], _mouthTargets[index], blend);
            }
        }

        private void ClearMouthTargets()
        {
            Array.Clear(_mouthTargets, 0, _mouthTargets.Length);
        }

        private void WriteFrame(AvatarActivityProfile profile, Vector2 gaze, float breathing, float sway)
        {
            _frame.Activity = Activity;
            _frame.Blink = _blinkWeight;
            _frame.GazeYaw = gaze.x;
            _frame.GazePitch = gaze.y;
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

            var bodyEnergy = profile.BodyEnergy;
            var breathPitch = breathing * 0.45f * bodyEnergy;
            var swayRoll = sway * 0.55f * bodyEnergy;
            var speakingPulse = Activity == AvatarActivityState.Speaking
                ? Mathf.Sin(_elapsed * 4.2f) * 0.35f * bodyEnergy
                : 0f;
            _frame.HipsPositionOffset = new Vector3(sway * 0.0015f, breathing * 0.0018f, 0f);
            _frame.SpineEuler = new Vector3(profile.SpinePitch + breathPitch, sway * 0.28f, swayRoll * 0.3f);
            _frame.ChestEuler = new Vector3(profile.ChestPitch + breathPitch * 0.8f, sway * 0.35f, swayRoll);
            _frame.UpperChestEuler = new Vector3(breathPitch * 0.6f, sway * 0.2f, swayRoll * 0.55f);
            var avatarYaw = AvatarCoordinateSpace.ViewportYawToAvatarYaw(gaze.x);
            _frame.NeckEuler = new Vector3(profile.HeadPitch * 0.25f + gaze.y * -0.08f, avatarYaw * 0.08f, profile.HeadTilt * 0.35f);
            _frame.HeadEuler = new Vector3(
                profile.HeadPitch + gaze.y * -0.16f + speakingPulse,
                avatarYaw * 0.33f,
                profile.HeadTilt + sway * 0.35f);
            _frame.LeftUpperArmEuler = new Vector3(0f, profile.ArmForward, 72f - profile.ArmOpenness);
            _frame.RightUpperArmEuler = new Vector3(0f, -profile.ArmForward, -72f + profile.ArmOpenness);
            _frame.LeftLowerArmEuler = new Vector3(0f, -8f - bodyEnergy * 2f, 0f);
            _frame.RightLowerArmEuler = new Vector3(0f, 8f + bodyEnergy * 2f, 0f);
        }

        private static AvatarActivityProfile GetProfile(AvatarActivityState state)
        {
            switch (state)
            {
                case AvatarActivityState.Listening:
                    return new AvatarActivityProfile(0.24f, 0.16f, 0.42f, -1.2f, 0.8f, 0.2f, 2f, 4f, 5f, new Vector2(0f, 0f), 8f, 5f, 1.2f, 2.4f, 0.11f);
                case AvatarActivityState.Thinking:
                    return new AvatarActivityProfile(0.18f, 0.1f, 0.48f, 1.2f, 2.8f, 3f, -2f, 2f, 2f, new Vector2(-6f, 3f), 7f, 4f, 0.7f, 1.5f, 0.18f);
                case AvatarActivityState.Speaking:
                    return new AvatarActivityProfile(0.3f, 0.22f, 0.75f, -0.4f, 0.4f, 0.4f, 3f, 6f, 7f, new Vector2(0f, 0f), 10f, 6f, 0.65f, 1.4f, 0.09f);
                default:
                    return new AvatarActivityProfile(0.22f, 0.12f, 0.34f, 0f, 0f, 0f, 0f, 0f, 0f, new Vector2(0f, 0f), 9f, 5f, 0.9f, 2.2f, 0.14f);
            }
        }

        private readonly struct AvatarActivityProfile
        {
            public AvatarActivityProfile(
                float breathFrequency,
                float swayFrequency,
                float bodyEnergy,
                float spinePitch,
                float chestPitch,
                float headPitch,
                float headTilt,
                float armForward,
                float armOpenness,
                Vector2 gazeOffset,
                float gazeYawRange,
                float gazePitchRange,
                float gazeHoldMinimum,
                float gazeHoldMaximum,
                float gazeResponse)
            {
                BreathFrequency = breathFrequency;
                SwayFrequency = swayFrequency;
                BodyEnergy = bodyEnergy;
                SpinePitch = spinePitch;
                ChestPitch = chestPitch;
                HeadPitch = headPitch;
                HeadTilt = headTilt;
                ArmForward = armForward;
                ArmOpenness = armOpenness;
                GazeOffset = gazeOffset;
                GazeYawRange = gazeYawRange;
                GazePitchRange = gazePitchRange;
                GazeHoldMinimum = gazeHoldMinimum;
                GazeHoldMaximum = gazeHoldMaximum;
                GazeResponse = gazeResponse;
            }

            public float BreathFrequency { get; }
            public float SwayFrequency { get; }
            public float BodyEnergy { get; }
            public float SpinePitch { get; }
            public float ChestPitch { get; }
            public float HeadPitch { get; }
            public float HeadTilt { get; }
            public float ArmForward { get; }
            public float ArmOpenness { get; }
            public Vector2 GazeOffset { get; }
            public float GazeYawRange { get; }
            public float GazePitchRange { get; }
            public float GazeHoldMinimum { get; }
            public float GazeHoldMaximum { get; }
            public float GazeResponse { get; }

            public static AvatarActivityProfile Lerp(AvatarActivityProfile from, AvatarActivityProfile to, float amount)
            {
                return new AvatarActivityProfile(
                    Mathf.Lerp(from.BreathFrequency, to.BreathFrequency, amount),
                    Mathf.Lerp(from.SwayFrequency, to.SwayFrequency, amount),
                    Mathf.Lerp(from.BodyEnergy, to.BodyEnergy, amount),
                    Mathf.Lerp(from.SpinePitch, to.SpinePitch, amount),
                    Mathf.Lerp(from.ChestPitch, to.ChestPitch, amount),
                    Mathf.Lerp(from.HeadPitch, to.HeadPitch, amount),
                    Mathf.Lerp(from.HeadTilt, to.HeadTilt, amount),
                    Mathf.Lerp(from.ArmForward, to.ArmForward, amount),
                    Mathf.Lerp(from.ArmOpenness, to.ArmOpenness, amount),
                    Vector2.Lerp(from.GazeOffset, to.GazeOffset, amount),
                    Mathf.Lerp(from.GazeYawRange, to.GazeYawRange, amount),
                    Mathf.Lerp(from.GazePitchRange, to.GazePitchRange, amount),
                    Mathf.Lerp(from.GazeHoldMinimum, to.GazeHoldMinimum, amount),
                    Mathf.Lerp(from.GazeHoldMaximum, to.GazeHoldMaximum, amount),
                    Mathf.Lerp(from.GazeResponse, to.GazeResponse, amount));
            }
        }
    }
}
