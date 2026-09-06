using System;
using UnityEngine;

namespace Katarune.Avatar
{
    public sealed class AvatarLightingRig : MonoBehaviour
    {
        private const float LightingTransitionSpeed = 4.5f;

        private Light _key;
        private AvatarLightingProfile _profile;
        private LightingState _current;
        private LightingState _target;

        public void Configure(AvatarLightingProfile profile = null)
        {
            _profile = profile != null ? profile : AvatarLightingProfile.LoadDefault();
            _key = CreateDirectionalLight("Avatar Soft Key Light", new Color(1f, 0.98f, 0.96f));
            var directionToLight = new Vector3(-0.45f, 0.75f, 0.55f).normalized;
            _key.transform.rotation = Quaternion.LookRotation(-directionToLight, Vector3.up);
            _key.shadows = LightShadows.None;

            RenderSettings.sun = _key;
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            _current = LightingState.From(_profile.DefaultLighting);
            _target = _current;
            Apply(_current);
        }

        private void Update()
        {
            if (_key == null) return;
            _target = LightingState.From(_profile.DefaultLighting);
            var blend = 1f - Mathf.Exp(-LightingTransitionSpeed * Time.unscaledDeltaTime);
            _current = LightingState.Lerp(_current, _target, blend);
            Apply(_current);
        }

        private void Apply(LightingState state)
        {
            _key.intensity = state.KeyIntensity;
            _key.color = state.KeyColor;
            RenderSettings.ambientLight = state.AmbientColor;
        }

        private static Light CreateDirectionalLight(string name, Color color)
        {
            var lightObject = new GameObject(name);
            var light = lightObject.AddComponent<Light>();
            light.type = LightType.Directional;
            light.color = color;
            light.renderMode = LightRenderMode.ForcePixel;
            return light;
        }

        private void OnDestroy()
        {
            if (RenderSettings.sun == _key) RenderSettings.sun = null;
            DestroyLight(_key);
        }

        private static void DestroyLight(Light light)
        {
            if (light != null) Destroy(light.gameObject);
        }

        private readonly struct LightingState
        {
            public LightingState(
                float keyIntensity,
                Color keyColor,
                Color ambientColor)
            {
                KeyIntensity = keyIntensity;
                KeyColor = keyColor;
                AmbientColor = ambientColor;
            }

            public float KeyIntensity { get; }
            public Color KeyColor { get; }
            public Color AmbientColor { get; }

            public static LightingState From(AvatarLightingPreset preset)
            {
                if (preset == null) throw new ArgumentNullException(nameof(preset));
                return new LightingState(
                    preset.KeyIntensity,
                    preset.KeyColor,
                    preset.AmbientColor);
            }

            public static LightingState Lerp(LightingState from, LightingState to, float value)
            {
                return new LightingState(
                    Mathf.Lerp(from.KeyIntensity, to.KeyIntensity, value),
                    Color.Lerp(from.KeyColor, to.KeyColor, value),
                    Color.Lerp(from.AmbientColor, to.AmbientColor, value));
            }
        }
    }
}
