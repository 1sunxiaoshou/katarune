using UnityEngine;

namespace Katarune.Avatar
{
    [DefaultExecutionOrder(10000)]
    public sealed class AvatarBehaviorController : MonoBehaviour
    {
        private AvatarBehaviorModel _model;
        private IAvatarDriver _driver;
        private IAvatarMotionPoseSource _motion;

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

        public void SetActivity(AvatarActivityState activity) => Model.SetActivity(activity);
        public void SetAffect(AvatarAffectPreset affect, float intensity) => Model.SetAffect(affect, intensity);
        public void ApplySettings(AvatarBehaviorSettings settings) => Model.ApplySettings(settings);
        public void SetManualVisemes(AvatarVisemeWeights weights) => Model.SetManualVisemes(weights);
        public void RequestBlink() => Model.RequestBlink();
        public void ResetBehavior() => Model.Reset();

        private void LateUpdate()
        {
            if (_driver == null) return;
            var width = Mathf.Max(1f, Screen.width);
            var height = Mathf.Max(1f, Screen.height);
            var pointer = new Vector2(
                Mathf.Clamp(Input.mousePosition.x / width * 2f - 1f, -1f, 1f),
                Mathf.Clamp(Input.mousePosition.y / height * 2f - 1f, -1f, 1f));
            var frame = Model.Tick(Time.deltaTime, pointer);
            frame.HasAuthoredBodyPose = _motion?.HasAuthoredBodyPose ?? false;
            frame.ProceduralBodyWeight = Mathf.Clamp01(_motion?.ProceduralBodyWeight ?? 1f);
            frame.ProceduralArmWeight = Mathf.Clamp01(_motion?.ProceduralArmWeight ?? 1f);
            _driver.Apply(frame);
        }

        private void OnDestroy()
        {
            Unbind();
        }
    }
}
