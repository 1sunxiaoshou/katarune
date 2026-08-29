using UnityEngine;

namespace Katarune.Avatar
{
    [DefaultExecutionOrder(10000)]
    public sealed class AvatarBehaviorController : MonoBehaviour
    {
        private AvatarBehaviorModel _model;
        private IAvatarDriver _driver;
        private IAvatarMotionPoseSource _motion;
        private Camera _camera;

        private AvatarBehaviorModel Model => _model ??= new AvatarBehaviorModel();
        public bool HasDriver => _driver != null;
        public AvatarPoseFrame CurrentFrame => Model.CurrentFrame;
        public AvatarBehaviorSettings Settings => Model.Settings;

        public void Bind(IAvatarDriver driver)
        {
            var previous = ReplaceDriver(driver);
            if (previous != null)
            {
                previous.ResetPose();
                previous.Dispose();
            }
            Model.Reset();
        }

        public void Unbind()
        {
            var previous = ReplaceDriver(null);
            if (previous == null) return;
            previous.ResetPose();
            previous.Dispose();
        }

        internal IAvatarDriver ReplaceDriver(IAvatarDriver driver)
        {
            var previous = _driver;
            _driver = driver;
            return previous;
        }

        internal void SetMotionSource(IAvatarMotionPoseSource motion)
        {
            _motion = motion;
        }

        public bool SupportsAffect(AvatarAffectPreset preset)
        {
            return _driver == null || _driver.SupportsAffect(preset);
        }

        public void SetAffect(AvatarAffectPreset affect, float intensity) => Model.SetAffect(affect, intensity);
        public void ApplySettings(AvatarBehaviorSettings settings) => Model.ApplySettings(settings);
        public void SetManualVisemes(AvatarVisemeWeights weights) => Model.SetManualVisemes(weights);
        public void RequestBlink() => Model.RequestBlink();
        public void ResetBehavior() => Model.Reset();

        private void LateUpdate()
        {
            if (_driver == null) return;
            var gazeTargetAngles = ResolvePointerGazeTarget();
            var frame = Model.Tick(Time.deltaTime, gazeTargetAngles);
            frame.HasAuthoredBodyPose = _motion?.HasAuthoredBodyPose ?? false;
            frame.ProceduralBodyWeight = Mathf.Clamp01(_motion?.ProceduralBodyWeight ?? 1f);
            frame.ProceduralArmWeight = Mathf.Clamp01(_motion?.ProceduralArmWeight ?? 1f);
            _driver.Apply(frame);
        }

        private Vector2 ResolvePointerGazeTarget()
        {
            if (!Model.PointerGazeTrackingEnabled
                || !(_driver is IAvatarGazeGeometryProvider geometryProvider)
                || !geometryProvider.TryGetGazeGeometry(out var geometry))
            {
                return Vector2.zero;
            }

            if (_camera == null) _camera = Camera.main;
            if (_camera == null) return Vector2.zero;

            var pointer = Input.mousePosition;
            var screenPosition = new Vector2(
                Mathf.Clamp(pointer.x, 0f, Mathf.Max(1f, Screen.width) - 1f),
                Mathf.Clamp(pointer.y, 0f, Mathf.Max(1f, Screen.height) - 1f));
            return AvatarPointerGazeProjection.TryProject(
                _camera,
                screenPosition,
                geometry,
                out var angles)
                ? angles
                : Vector2.zero;
        }

        private void OnDestroy()
        {
            Unbind();
        }
    }
}
