using UnityEngine;

namespace Katarune.Avatar
{
    [DefaultExecutionOrder(10000)]
    public sealed class AvatarBehaviorController : MonoBehaviour
    {
        private AvatarBehaviorModel _model;
        private IAvatarDriver _driver;

        public AvatarBehaviorModel Model => _model ??= new AvatarBehaviorModel();
        public bool HasDriver => _driver != null;
        public AvatarPoseFrame CurrentFrame => Model.CurrentFrame;

        public void Bind(IAvatarDriver driver)
        {
            Unbind();
            _driver = driver;
            Model.Reset();
        }

        public void Unbind()
        {
            if (_driver == null) return;
            _driver.ResetPose();
            _driver.Dispose();
            _driver = null;
        }

        public bool SupportsAffect(AvatarAffectPreset preset)
        {
            return _driver == null || _driver.SupportsAffect(preset);
        }

        public void SetActivity(AvatarActivityState activity) => Model.SetActivity(activity);
        public void SetAffect(AvatarAffectPreset affect, float intensity) => Model.SetAffect(affect, intensity);
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
            _driver.Apply(Model.Tick(Time.deltaTime, pointer));
        }

        private void OnDestroy()
        {
            Unbind();
        }
    }
}
