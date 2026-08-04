using System;
using UnityEngine;

namespace Katarune.Avatar
{
    public sealed class AvatarLightingRig : MonoBehaviour
    {
        private const float LightingTransitionSpeed = 4.5f;

        private Light _key;
        private Light _fill;
        private Light _rim;
        private LightingState _current;
        private LightingState _target;
        private AvatarRenderQuality _quality = AvatarRenderQuality.High;

        public void Configure()
        {
            _key = CreateDirectionalLight("Avatar Key Light", new Color(1f, 0.91f, 0.85f));
            _key.transform.rotation = Quaternion.Euler(32f, -38f, 0f);
            _key.shadows = LightShadows.Soft;
            _key.shadowStrength = 0.58f;
            _key.shadowBias = 0.025f;
            _key.shadowNormalBias = 0.22f;

            _fill = CreateDirectionalLight("Avatar Fill Light", new Color(0.58f, 0.69f, 1f));
            _fill.transform.rotation = Quaternion.Euler(18f, 142f, 0f);
            _fill.shadows = LightShadows.None;

            _rim = CreateDirectionalLight("Avatar Rim Light", new Color(0.5f, 0.66f, 1f));
            _rim.transform.rotation = Quaternion.Euler(8f, 205f, 0f);
            _rim.shadows = LightShadows.None;

            RenderSettings.sun = _key;
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            _current = GetState(AvatarActivityState.Idle);
            _target = _current;
            Apply(_current);
        }

        public void SetActivity(AvatarActivityState activity)
        {
            _target = GetState(activity);
        }

        public void SetQuality(AvatarRenderQuality quality)
        {
            _quality = quality;
            if (_key == null) return;
            _key.shadows = quality == AvatarRenderQuality.Low ? LightShadows.None : LightShadows.Soft;
            _key.shadowStrength = quality == AvatarRenderQuality.Medium ? 0.48f : 0.58f;
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
            var qualityScale = _quality == AvatarRenderQuality.Low ? 0.86f : 1f;
            _key.intensity = state.KeyIntensity * qualityScale;
            _key.color = state.KeyColor;
            _fill.intensity = state.FillIntensity * qualityScale;
            _fill.color = state.FillColor;
            _rim.intensity = state.RimIntensity * qualityScale;
            _rim.color = state.RimColor;
            RenderSettings.ambientLight = state.AmbientColor;
        }

        private static LightingState GetState(AvatarActivityState activity)
        {
            switch (activity)
            {
                case AvatarActivityState.Listening:
                    return new LightingState(
                        1.08f, new Color(1f, 0.92f, 0.86f),
                        0.42f, new Color(0.58f, 0.72f, 1f),
                        0.54f, new Color(0.48f, 0.7f, 1f),
                        new Color(0.285f, 0.31f, 0.39f));
                case AvatarActivityState.Thinking:
                    return new LightingState(
                        0.98f, new Color(0.96f, 0.9f, 0.9f),
                        0.4f, new Color(0.57f, 0.63f, 0.94f),
                        0.58f, new Color(0.63f, 0.53f, 1f),
                        new Color(0.275f, 0.285f, 0.37f));
                case AvatarActivityState.Speaking:
                    return new LightingState(
                        1.12f, new Color(1f, 0.9f, 0.82f),
                        0.43f, new Color(0.63f, 0.73f, 1f),
                        0.58f, new Color(0.5f, 0.7f, 1f),
                        new Color(0.3f, 0.315f, 0.39f));
                default:
                    return new LightingState(
                        1.04f, new Color(1f, 0.92f, 0.86f),
                        0.38f, new Color(0.6f, 0.7f, 1f),
                        0.5f, new Color(0.52f, 0.67f, 1f),
                        new Color(0.29f, 0.305f, 0.38f));
            }
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
            DestroyLight(_fill);
            DestroyLight(_rim);
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
                float fillIntensity,
                Color fillColor,
                float rimIntensity,
                Color rimColor,
                Color ambientColor)
            {
                KeyIntensity = keyIntensity;
                KeyColor = keyColor;
                FillIntensity = fillIntensity;
                FillColor = fillColor;
                RimIntensity = rimIntensity;
                RimColor = rimColor;
                AmbientColor = ambientColor;
            }

            public float KeyIntensity { get; }
            public Color KeyColor { get; }
            public float FillIntensity { get; }
            public Color FillColor { get; }
            public float RimIntensity { get; }
            public Color RimColor { get; }
            public Color AmbientColor { get; }

            public static LightingState Lerp(LightingState from, LightingState to, float value)
            {
                return new LightingState(
                    Mathf.Lerp(from.KeyIntensity, to.KeyIntensity, value),
                    Color.Lerp(from.KeyColor, to.KeyColor, value),
                    Mathf.Lerp(from.FillIntensity, to.FillIntensity, value),
                    Color.Lerp(from.FillColor, to.FillColor, value),
                    Mathf.Lerp(from.RimIntensity, to.RimIntensity, value),
                    Color.Lerp(from.RimColor, to.RimColor, value),
                    Color.Lerp(from.AmbientColor, to.AmbientColor, value));
            }
        }
    }
}
