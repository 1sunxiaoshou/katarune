using System;
using System.Collections.Generic;
using UnityEngine;
using VRM10.MToon10;

namespace Katarune.Avatar
{
    public sealed class AvatarVisualSettings
    {
        public bool SoftOutlineEnabled { get; internal set; }

        public void Reset(bool softOutlineEnabled = false)
        {
            SoftOutlineEnabled = softOutlineEnabled;
        }
    }

    public sealed class AvatarVisualController : MonoBehaviour
    {
        private AvatarVisualProfile _profile;
        private IAvatarVisualInstance _active;
        private bool _ownsProfile;

        public AvatarVisualSettings Settings { get; } = new AvatarVisualSettings();
        public bool HasVisuals => _active != null;

        public void Configure(
            AvatarVisualProfile profile = null,
            bool softOutlineEnabled = false)
        {
            _profile = profile != null ? profile : AvatarVisualProfile.LoadDefault();
            _ownsProfile = (_profile.hideFlags & HideFlags.DontSave) != 0;
            Settings.Reset(softOutlineEnabled);
        }

        public AvatarVisualInstance Prepare(GameObject avatar)
        {
            if (_profile == null) throw new InvalidOperationException("The avatar visual controller has not been configured.");
            return AvatarVisualInstance.Create(avatar, _profile, Settings);
        }

        public AvatarVisualInstance Prepare(GameObject avatar, AvatarPresentationSettings presentation)
        {
            if (_profile == null) throw new InvalidOperationException("The avatar visual controller has not been configured.");
            var settings = new AvatarVisualSettings();
            settings.Reset(presentation.SoftOutlineEnabled);
            return AvatarVisualInstance.Create(avatar, _profile, settings);
        }

        internal IAvatarVisualInstance ReplaceActive(IAvatarVisualInstance instance)
        {
            var previous = _active;
            _active = instance;
            if (_active is AvatarVisualInstance visual) LogMaterialSummary(visual.Statistics);
            return previous;
        }

        public void Unbind()
        {
            ReplaceActive(null)?.Dispose();
        }

        public void SetSoftOutlineEnabled(bool enabled)
        {
            Settings.SoftOutlineEnabled = enabled;
            _active?.ApplySoftOutline(enabled);
        }

        private static void LogMaterialSummary(AvatarMaterialStatistics statistics)
        {
            if (statistics == null) return;
            Debug.Log(
                $"KATARUNE_AVATAR_MATERIALS total={statistics.Total} "
                + $"mtoon={statistics.Supported} unsupported={statistics.Unsupported} "
                + $"details={string.Join("|", statistics.Entries)}");
        }

        private void OnDestroy()
        {
            Unbind();
            if (_ownsProfile && _profile != null) DestroyRuntimeObject(_profile);
            _profile = null;
        }

        internal static void DestroyRuntimeObject(UnityEngine.Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) Destroy(value);
            else DestroyImmediate(value);
        }
    }

    public sealed class AvatarVisualInstance : IAvatarVisualInstance
    {
        private const string MToonUrpShader = "VRM10/Universal Render Pipeline/MToon10";

        private readonly AvatarVisualProfile _profile;
        private readonly List<MaterialEntry> _materials;
        private bool _disposed;

        private AvatarVisualInstance(
            AvatarVisualProfile profile,
            List<MaterialEntry> materials,
            AvatarMaterialStatistics statistics)
        {
            _profile = profile;
            _materials = materials;
            Statistics = statistics;
        }

        public AvatarMaterialStatistics Statistics { get; }

        public static AvatarVisualInstance Create(
            GameObject avatar,
            AvatarVisualProfile profile,
            AvatarVisualSettings settings)
        {
            if (avatar == null) throw new ArgumentNullException(nameof(avatar));
            if (profile == null) throw new ArgumentNullException(nameof(profile));
            if (settings == null) throw new ArgumentNullException(nameof(settings));

            var materials = new List<MaterialEntry>();
            var statistics = new AvatarMaterialStatistics();
            var seen = new HashSet<Material>();
            foreach (var renderer in avatar.GetComponentsInChildren<Renderer>(true))
            {
                foreach (var material in renderer.sharedMaterials)
                {
                    if (material == null || !seen.Add(material)) continue;
                    var role = profile.ResolveRole(material.name, renderer.name);
                    var supported = IsSupportedMToon(material);
                    statistics.Add(role, supported, renderer.name, material.name);
                    if (supported) materials.Add(new MaterialEntry(material, role));
                }
            }

            var instance = new AvatarVisualInstance(profile, materials, statistics);
            instance.Apply(settings);
            return instance;
        }

        public void Apply(AvatarVisualSettings settings)
        {
            if (_disposed) return;
            foreach (var entry in _materials) entry.RestoreOutline();
            if (!settings.SoftOutlineEnabled) return;
            foreach (var entry in _materials) ApplySoftOutline(entry);
        }

        public void ApplySoftOutline(bool enabled)
        {
            var settings = new AvatarVisualSettings();
            settings.Reset(enabled);
            Apply(settings);
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            foreach (var entry in _materials) entry.Dispose();
            _materials.Clear();
        }

        private void ApplySoftOutline(MaterialEntry entry)
        {
            var context = new MToon10Context(entry.Material);
            var target = _profile.GetSoftOutline(entry.Role);
            var alphaAllowsOutline = context.AlphaMode != MToon10AlphaMode.Transparent
                || entry.Role == AvatarMaterialRole.Hair;
            if (!target.Enabled || !alphaAllowsOutline)
            {
                context.OutlineWidthMode = MToon10OutlineMode.None;
                context.OutlineWidthFactor = 0f;
                context.Validate();
                return;
            }

            context.OutlineWidthMode = MToon10OutlineMode.Screen;
            context.OutlineWidthFactor = target.Width * _profile.OutlineIntensity;
            var baseColor = context.BaseColorFactorSrgb;
            var derivedOutline = new Color(
                Mathf.Clamp01(baseColor.r * 0.18f + 0.018f),
                Mathf.Clamp01(baseColor.g * 0.18f + 0.022f),
                Mathf.Clamp01(baseColor.b * 0.22f + 0.03f),
                1f);
            context.OutlineColorFactorSrgb = Color.Lerp(
                context.OutlineColorFactorSrgb,
                derivedOutline,
                _profile.OutlineColorBlend);
            context.OutlineLightingMixFactor = Mathf.Lerp(
                context.OutlineLightingMixFactor,
                _profile.OutlineLightingMix,
                _profile.OutlineColorBlend);
            context.Validate();
        }

        private static bool IsSupportedMToon(Material material)
        {
            return material.shader != null
                && string.Equals(material.shader.name, MToonUrpShader, StringComparison.Ordinal)
                && material.HasProperty("_OutlineWidth");
        }

        private sealed class MaterialEntry : IDisposable
        {
            private readonly MToon10OutlineMode _outlineMode;
            private readonly float _outlineWidth;
            private readonly Color _outlineColor;
            private readonly float _outlineLightingMix;

            public MaterialEntry(Material material, AvatarMaterialRole role)
            {
                Material = material;
                Role = role;
                var context = new MToon10Context(material);
                _outlineMode = context.OutlineWidthMode;
                _outlineWidth = context.OutlineWidthFactor;
                _outlineColor = context.OutlineColorFactorSrgb;
                _outlineLightingMix = context.OutlineLightingMixFactor;
            }

            public Material Material { get; }
            public AvatarMaterialRole Role { get; }

            public void RestoreOutline()
            {
                if (Material == null) return;
                var context = new MToon10Context(Material);
                context.OutlineWidthMode = _outlineMode;
                context.OutlineWidthFactor = _outlineWidth;
                context.OutlineColorFactorSrgb = _outlineColor;
                context.OutlineLightingMixFactor = _outlineLightingMix;
                context.Validate();
            }

            public void Dispose()
            {
                RestoreOutline();
            }
        }
    }
}
