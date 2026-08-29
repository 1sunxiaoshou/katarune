using UnityEngine;

namespace Katarune.Avatar
{
    public readonly struct HeadEyeGazePose
    {
        public HeadEyeGazePose(Vector2 eyes, Vector2 head)
        {
            Eyes = eyes;
            Head = head;
        }

        public Vector2 Eyes { get; }
        public Vector2 Head { get; }
        public Vector2 Combined => Eyes + Head;
        public static HeadEyeGazePose Zero => new HeadEyeGazePose(Vector2.zero, Vector2.zero);
    }

    public readonly struct HeadEyeGazeProfile
    {
        public HeadEyeGazeProfile(
            float yawLimit,
            float pitchLimit,
            float trackingResponseSeconds,
            float trackingJumpThreshold,
            float fixationShiftMinimumSeconds,
            float fixationShiftMaximumSeconds,
            float headFollowDelaySeconds,
            float headFollowResponseSeconds,
            float headYawDeadZone,
            float headPitchDeadZone,
            float headYawFollowRatio,
            float headPitchFollowRatio,
            float headYawMaximum,
            float headPitchMaximum)
        {
            YawLimit = yawLimit;
            PitchLimit = pitchLimit;
            TrackingResponseSeconds = trackingResponseSeconds;
            TrackingJumpThreshold = trackingJumpThreshold;
            FixationShiftMinimumSeconds = fixationShiftMinimumSeconds;
            FixationShiftMaximumSeconds = fixationShiftMaximumSeconds;
            HeadFollowDelaySeconds = headFollowDelaySeconds;
            HeadFollowResponseSeconds = headFollowResponseSeconds;
            HeadYawDeadZone = headYawDeadZone;
            HeadPitchDeadZone = headPitchDeadZone;
            HeadYawFollowRatio = headYawFollowRatio;
            HeadPitchFollowRatio = headPitchFollowRatio;
            HeadYawMaximum = headYawMaximum;
            HeadPitchMaximum = headPitchMaximum;
        }

        public float YawLimit { get; }
        public float PitchLimit { get; }
        public float TrackingResponseSeconds { get; }
        public float TrackingJumpThreshold { get; }
        public float FixationShiftMinimumSeconds { get; }
        public float FixationShiftMaximumSeconds { get; }
        public float HeadFollowDelaySeconds { get; }
        public float HeadFollowResponseSeconds { get; }
        public float HeadYawDeadZone { get; }
        public float HeadPitchDeadZone { get; }
        public float HeadYawFollowRatio { get; }
        public float HeadPitchFollowRatio { get; }
        public float HeadYawMaximum { get; }
        public float HeadPitchMaximum { get; }

        public static HeadEyeGazeProfile Default => new HeadEyeGazeProfile(
            18f,
            10f,
            0.09f,
            4f,
            0.08f,
            0.14f,
            0.06f,
            0.26f,
            3f,
            2f,
            0.8f,
            0.75f,
            12f,
            6f);
    }

    /// <summary>
    /// Converts either discrete fixation changes or continuous tracked targets into one
    /// coordinated eye/head pose. Inputs are viewport-relative yaw and pitch in degrees.
    /// </summary>
    public sealed class HeadEyeGazeCoordinator
    {
        private readonly HeadEyeGazeProfile _profile;
        private Vector2 _target;
        private Vector2 _fixationStart;
        private Vector2 _totalGaze;
        private Vector2 _headGaze;
        private Vector2 _headVelocity;
        private float _fixationElapsed;
        private float _fixationDuration;
        private float _headFollowWait;
        private bool _isFixationShift;

        public HeadEyeGazeCoordinator(HeadEyeGazeProfile profile)
        {
            _profile = profile;
            Reset();
        }

        public HeadEyeGazePose Current => ComposePose();

        public void Reset()
        {
            _target = Vector2.zero;
            _fixationStart = Vector2.zero;
            _totalGaze = Vector2.zero;
            _headGaze = Vector2.zero;
            _headVelocity = Vector2.zero;
            _fixationElapsed = 0f;
            _fixationDuration = _profile.FixationShiftMinimumSeconds;
            _headFollowWait = _profile.HeadFollowDelaySeconds;
            _isFixationShift = false;
        }

        /// <summary>
        /// Starts an eye-led shift to a newly selected object or semantic fixation.
        /// </summary>
        public void SetFixationTarget(Vector2 viewportAngles, float shiftDurationSeconds = -1f)
        {
            _target = Clamp(viewportAngles);
            _fixationStart = _totalGaze;
            _fixationElapsed = 0f;
            _fixationDuration = shiftDurationSeconds > 0f
                ? shiftDurationSeconds
                : (_profile.FixationShiftMinimumSeconds + _profile.FixationShiftMaximumSeconds) * 0.5f;
            _headFollowWait = _profile.HeadFollowDelaySeconds;
            _isFixationShift = true;
        }

        /// <summary>
        /// Updates a continuously moving target, such as the pointer, without restarting
        /// the head delay every frame.
        /// </summary>
        public void TrackTarget(Vector2 viewportAngles)
        {
            var nextTarget = Clamp(viewportAngles);
            if (Vector2.Distance(_target, nextTarget) >= _profile.TrackingJumpThreshold)
            {
                _headFollowWait = _profile.HeadFollowDelaySeconds;
            }

            _target = nextTarget;
            _isFixationShift = false;
        }

        public HeadEyeGazePose Tick(float deltaTime)
        {
            deltaTime = Mathf.Max(0f, deltaTime);
            if (_isFixationShift)
            {
                _fixationElapsed += deltaTime;
                var progress = Mathf.Clamp01(
                    _fixationElapsed / Mathf.Max(0.01f, _fixationDuration));
                var easedProgress = progress * progress * (3f - 2f * progress);
                _totalGaze = Vector2.LerpUnclamped(_fixationStart, _target, easedProgress);
                if (progress >= 1f) _isFixationShift = false;
            }
            else
            {
                var eyeBlend = 1f - Mathf.Exp(
                    -deltaTime / Mathf.Max(0.01f, _profile.TrackingResponseSeconds));
                _totalGaze = Vector2.Lerp(_totalGaze, _target, eyeBlend);
            }

            _headFollowWait = Mathf.Max(0f, _headFollowWait - deltaTime);
            if (_headFollowWait <= 0f)
            {
                var headTarget = ComputeHeadTarget(_totalGaze);
                _headGaze = Vector2.SmoothDamp(
                    _headGaze,
                    headTarget,
                    ref _headVelocity,
                    Mathf.Max(0.01f, _profile.HeadFollowResponseSeconds),
                    Mathf.Infinity,
                    deltaTime);
            }

            return ComposePose();
        }

        private HeadEyeGazePose ComposePose()
        {
            // UniVRM's manual LookAt input is relative to the current head forward.
            // Eyes therefore receive the remaining angle after head contribution.
            return new HeadEyeGazePose(_totalGaze - _headGaze, _headGaze);
        }

        private Vector2 Clamp(Vector2 angles)
        {
            return new Vector2(
                Mathf.Clamp(angles.x, -_profile.YawLimit, _profile.YawLimit),
                Mathf.Clamp(angles.y, -_profile.PitchLimit, _profile.PitchLimit));
        }

        private Vector2 ComputeHeadTarget(Vector2 totalGaze)
        {
            return new Vector2(
                ComputeHeadAxis(
                    totalGaze.x,
                    _profile.HeadYawDeadZone,
                    _profile.HeadYawFollowRatio,
                    _profile.HeadYawMaximum),
                ComputeHeadAxis(
                    totalGaze.y,
                    _profile.HeadPitchDeadZone,
                    _profile.HeadPitchFollowRatio,
                    _profile.HeadPitchMaximum));
        }

        private static float ComputeHeadAxis(
            float angle,
            float deadZone,
            float followRatio,
            float maximum)
        {
            var magnitude = Mathf.Max(0f, Mathf.Abs(angle) - deadZone);
            return Mathf.Sign(angle) * Mathf.Min(maximum, magnitude * followRatio);
        }
    }
}
