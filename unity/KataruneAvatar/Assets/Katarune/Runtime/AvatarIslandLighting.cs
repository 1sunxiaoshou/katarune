using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Katarune.Avatar
{
    // Scoped to the visible island. Desktop, other backgrounds and live restoration
    // retain their original lighting and camera settings.
    internal sealed class AvatarIslandLighting : System.IDisposable
    {
        private readonly Camera _camera;
        private readonly Light _sun;
        private readonly Volume _volume;
        private readonly VolumeProfile _profile;
        private readonly List<(Light light, bool enabled)> _previousLights = new();
        private UniversalAdditionalCameraData _cameraData;
        private Light _previousSun;
        private AmbientMode _ambientMode;
        private Color _sky, _equator, _ground;
        private bool _active, _postProcessing;
        private CameraOverrideOption _depthOption;

        internal AvatarIslandLighting(GameObject root, Camera camera)
        {
            _camera = camera;
            var lightRoot = new GameObject("Island afternoon sun");
            lightRoot.transform.SetParent(root.transform, false);
            lightRoot.transform.localRotation = Quaternion.Euler(48, 145, 0);
            _sun = lightRoot.AddComponent<Light>();
            _sun.type = LightType.Directional;
            _sun.color = new Color(1f, .94f, .82f);
            _sun.intensity = .9f;
            _sun.shadows = LightShadows.Soft;
            _sun.shadowStrength = .85f;
            _sun.shadowBias = .025f;
            _sun.shadowNormalBias = .12f;
            // Main-light atlas resolution is owned by the existing URP asset.
            _sun.enabled = false;

            _profile = ScriptableObject.CreateInstance<VolumeProfile>();
            _profile.name = "Island cel finish";
            var bloom = _profile.Add<Bloom>();
            bloom.threshold.Override(.86f);
            bloom.intensity.Override(.12f);
            bloom.scatter.Override(.42f);
            bloom.maxIterations.Override(3);
            var color = _profile.Add<ColorAdjustments>();
            color.contrast.Override(5);
            color.saturation.Override(5);
            var split = _profile.Add<SplitToning>();
            split.shadows.Override(new Color(.47f, .48f, .54f));
            split.highlights.Override(new Color(.53f, .51f, .47f));
            split.balance.Override(8);
            var vignette = _profile.Add<Vignette>();
            vignette.intensity.Override(.10f);
            vignette.smoothness.Override(.65f);
            _volume = root.AddComponent<Volume>();
            _volume.isGlobal = true;
            _volume.priority = 100;
            _volume.sharedProfile = _profile;
            _volume.weight = 0;
        }

        internal void Update(float opacity)
        {
            var active = opacity > 0;
            if (active != _active)
            {
                if (active) Enter(); else Leave();
                _active = active;
            }
            _volume.weight = opacity;
        }

        private void Enter()
        {
            _previousSun = RenderSettings.sun;
            _ambientMode = RenderSettings.ambientMode;
            _sky = RenderSettings.ambientSkyColor;
            _equator = RenderSettings.ambientEquatorColor;
            _ground = RenderSettings.ambientGroundColor;
            foreach (var light in Object.FindObjectsByType<Light>(FindObjectsSortMode.None))
            {
                if (light == _sun || light.type != LightType.Directional) continue;
                _previousLights.Add((light, light.enabled));
                light.enabled = false;
            }
            RenderSettings.sun = _sun;
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(.38f, .47f, .63f);
            RenderSettings.ambientEquatorColor = new Color(.29f, .34f, .46f);
            RenderSettings.ambientGroundColor = new Color(.34f, .30f, .26f);
            _sun.enabled = true;
            if (_camera != null)
            {
                _cameraData = _camera.GetUniversalAdditionalCameraData();
                _postProcessing = _cameraData.renderPostProcessing;
                _depthOption = _cameraData.requiresDepthOption;
                _cameraData.renderPostProcessing = true;
                _cameraData.requiresDepthTexture = true;
            }
        }

        private void Leave()
        {
            _sun.enabled = false;
            foreach (var entry in _previousLights)
                if (entry.light != null) entry.light.enabled = entry.enabled;
            _previousLights.Clear();
            RenderSettings.sun = _previousSun;
            RenderSettings.ambientMode = _ambientMode;
            RenderSettings.ambientSkyColor = _sky;
            RenderSettings.ambientEquatorColor = _equator;
            RenderSettings.ambientGroundColor = _ground;
            if (_cameraData != null)
            {
                _cameraData.renderPostProcessing = _postProcessing;
                _cameraData.requiresDepthOption = _depthOption;
            }
        }

        public void Dispose()
        {
            if (_active) { Leave(); _active = false; }
            foreach (var component in _profile.components) Release(component);
            Release(_profile);
        }

        private static void Release(Object value)
        {
            if (Application.isPlaying) Object.Destroy(value); else Object.DestroyImmediate(value);
        }
    }
}
