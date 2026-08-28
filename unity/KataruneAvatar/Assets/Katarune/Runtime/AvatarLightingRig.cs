using System;
using UnityEngine;

namespace Katarune.Avatar
{
    public sealed class AvatarLightingRig : MonoBehaviour
    {
        private const float LightingTransitionSpeed = 4.5f;

        private Light _key;
        private LightingState _current;
        private LightingState _target;

        public AvatarLightingMode Mode { get; private set; } = AvatarLightingMode.LightDesktop;

        public void Configure()
        {
            _key = CreateDirectionalLight("Avatar Soft Key Light", new Color(1f, 0.98f, 0.96f));
            var directionToLight = new Vector3(-0.45f, 0.75f, 0.55f).normalized;
            _key.transform.rotation = Quaternion.LookRotation(-directionToLight, Vector3.up);
            _key.shadows = LightShadows.None;

            RenderSettings.sun = _key;
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            _current = GetState(Mode);
            _target = _current;
            Apply(_current);
        }

        public void SetMode(AvatarLightingMode mode)
        {
            if (Mode == mode) return;
            Mode = mode;
            _target = GetState(Mode);
        }

        private void Update()
        {
            if (_key == null) return;
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

        private static LightingState GetState(AvatarLightingMode mode)
        {
            if (mode == AvatarLightingMode.DarkDesktop)
            {
                return new LightingState(
                    0.9f, new Color(1f, 0.97f, 0.94f),
                    new Color(0.32f, 0.33f, 0.38f));
            }

            return new LightingState(
                1.15f, new Color(1f, 0.99f, 0.97f),
                new Color(0.67f, 0.68f, 0.71f));
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
