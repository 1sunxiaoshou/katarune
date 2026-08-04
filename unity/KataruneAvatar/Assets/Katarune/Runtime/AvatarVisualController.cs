using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using VRM10.MToon10;

namespace Katarune.Avatar
{
    public sealed class AvatarVisualSettings
    {
        public bool Enabled { get; internal set; }
        public bool OutlineEnabled { get; internal set; }
        public bool HairHighlightEnabled { get; internal set; }
        public AvatarRenderQuality Quality { get; internal set; }
        public float StyleStrength { get; internal set; }
        public float RimIntensity { get; internal set; }
        public float OutlineIntensity { get; internal set; }
        public float HairHighlightIntensity { get; internal set; }

        public void Reset(AvatarVisualProfile profile, AvatarRenderQuality? quality = null, bool enabled = true)
        {
            Enabled = enabled;
            OutlineEnabled = profile.OutlineEnabled;
            HairHighlightEnabled = profile.HairHighlightEnabled;
            Quality = quality ?? profile.Quality;
            StyleStrength = profile.StyleStrength;
            RimIntensity = profile.RimIntensity;
            OutlineIntensity = profile.OutlineIntensity;
            HairHighlightIntensity = profile.HairHighlightIntensity;
        }
    }

    public sealed class AvatarVisualController : MonoBehaviour
    {
        private AvatarSceneRig _sceneRig;
        private AvatarBehaviorController _behavior;
        private AvatarVisualProfile _profile;
        private AvatarVisualInstance _active;
        private bool _ownsProfile;

        public AvatarVisualSettings Settings { get; } = new AvatarVisualSettings();
        public AvatarMaterialStatistics Statistics => _active?.Statistics;
        public bool HasVisuals => _active != null;

        public void Configure(
            AvatarSceneRig sceneRig,
            AvatarBehaviorController behavior,
            AvatarVisualProfile profile = null,
            AvatarRenderQuality? quality = null,
            bool enabled = true)
        {
            _sceneRig = sceneRig ?? throw new ArgumentNullException(nameof(sceneRig));
            _behavior = behavior ?? throw new ArgumentNullException(nameof(behavior));
            _profile = profile != null ? profile : AvatarVisualProfile.LoadDefault();
            _ownsProfile = (_profile.hideFlags & HideFlags.DontSave) != 0;
            Settings.Reset(_profile, quality, enabled);
            _sceneRig.SetRenderQuality(Settings.Quality);
        }

        public AvatarVisualInstance Prepare(GameObject avatar)
        {
            if (_profile == null) throw new InvalidOperationException("The avatar visual controller has not been configured.");
            return AvatarVisualInstance.Create(avatar, _profile, Settings);
        }

        public void Commit(AvatarVisualInstance instance)
        {
            if (instance == null) throw new ArgumentNullException(nameof(instance));
            var previous = _active;
            _active = instance;
            _active.Apply(Settings);
            previous?.Dispose();
            LogMaterialSummary(_active.Statistics);
        }

        public void Unbind()
        {
            _active?.Dispose();
            _active = null;
        }

        public void SetEnabled(bool enabled)
        {
            if (Settings.Enabled == enabled) return;
            Settings.Enabled = enabled;
            Reapply();
        }

        public void SetOutlineEnabled(bool enabled)
        {
            if (Settings.OutlineEnabled == enabled) return;
            Settings.OutlineEnabled = enabled;
            Reapply();
        }

        public void SetHairHighlightEnabled(bool enabled)
        {
            if (Settings.HairHighlightEnabled == enabled) return;
            Settings.HairHighlightEnabled = enabled;
            Reapply();
        }

        public void SetQuality(AvatarRenderQuality quality)
        {
            if (Settings.Quality == quality) return;
            Settings.Quality = quality;
            _sceneRig?.SetRenderQuality(quality);
            Reapply();
        }

        public void SetStyleStrength(float value)
        {
            Settings.StyleStrength = Mathf.Clamp01(value);
            Reapply();
        }

        public void SetRimIntensity(float value)
        {
            Settings.RimIntensity = Mathf.Clamp(value, 0f, 1.5f);
            Reapply();
        }

        public void SetOutlineIntensity(float value)
        {
            Settings.OutlineIntensity = Mathf.Clamp(value, 0f, 1.5f);
            Reapply();
        }

        public void SetHairHighlightIntensity(float value)
        {
            Settings.HairHighlightIntensity = Mathf.Clamp(value, 0f, 1.5f);
            Reapply();
        }

        public void ResetVisuals()
        {
            if (_profile == null) return;
            Settings.Reset(_profile);
            _sceneRig?.SetRenderQuality(Settings.Quality);
            Reapply();
        }

        private void Update()
        {
            if (_sceneRig != null && _behavior != null)
            {
                _sceneRig.SetActivityLighting(_behavior.Model.Activity);
            }
        }

        private void Reapply()
        {
            _active?.Apply(Settings);
        }

        private static void LogMaterialSummary(AvatarMaterialStatistics statistics)
        {
            if (statistics == null) return;
            var roles = string.Join(",", Enum.GetValues(typeof(AvatarMaterialRole))
                .Cast<AvatarMaterialRole>()
                .Select(role => $"{role}:{statistics.GetCount(role)}"));
            Debug.Log($"KATARUNE_AVATAR_VISUALS materials={statistics.Total} styled={statistics.Styled} unsupported={statistics.Unsupported} roles={roles} details={string.Join("|", statistics.Entries)}");
        }

        private void OnDestroy()
        {
            Unbind();
            if (_ownsProfile && _profile != null) DestroyObject(_profile);
            _profile = null;
        }

        internal static void DestroyObject(UnityEngine.Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) Destroy(value);
            else DestroyImmediate(value);
        }
    }

    public sealed class AvatarVisualInstance : IDisposable
    {
        private const string MToonUrpShader = "VRM10/Universal Render Pipeline/MToon10";

        private readonly AvatarVisualProfile _profile;
        private readonly List<MaterialEntry> _materials;
        private Texture2D _hairHighlightTexture;
        private bool _disposed;

        private AvatarVisualInstance(AvatarVisualProfile profile, List<MaterialEntry> materials, AvatarMaterialStatistics statistics)
        {
            _profile = profile;
            _materials = materials;
            Statistics = statistics;
        }

        public AvatarMaterialStatistics Statistics { get; }

        public static AvatarVisualInstance Create(GameObject avatar, AvatarVisualProfile profile, AvatarVisualSettings settings)
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
            foreach (var entry in _materials) entry.Restore();
            if (!settings.Enabled) return;

            foreach (var entry in _materials)
            {
                ApplyMaterial(entry, settings);
            }
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            foreach (var entry in _materials) entry.Dispose();
            _materials.Clear();
            if (_hairHighlightTexture != null) AvatarVisualController.DestroyObject(_hairHighlightTexture);
            _hairHighlightTexture = null;
        }

        private void ApplyMaterial(MaterialEntry entry, AvatarVisualSettings settings)
        {
            var material = entry.Material;
            var context = new MToon10Context(material);
            var target = _profile.GetStyle(entry.Role);
            var strength = Mathf.Clamp01(settings.StyleStrength);

            context.ShadingToonyFactor = Mathf.Lerp(context.ShadingToonyFactor, target.ShadingToony, strength);
            context.ShadingShiftFactor = Mathf.Lerp(context.ShadingShiftFactor, target.ShadingShift, strength);
            context.GiEqualizationFactor = Mathf.Lerp(context.GiEqualizationFactor, target.GiEqualization, strength);
            context.ShadeColorFactorSrgb = MultiplyColor(
                context.ShadeColorFactorSrgb,
                Color.Lerp(Color.white, target.ShadeTint, strength * 0.7f));

            var qualityFactor = GetQualityFactor(settings.Quality);
            var rimBlend = Mathf.Clamp01(strength * settings.RimIntensity * qualityFactor);
            context.ParametricRimColorFactorSrgb = Color.Lerp(
                context.ParametricRimColorFactorSrgb,
                target.RimColor,
                rimBlend * 0.62f);
            context.ParametricRimFresnelPowerFactor = Mathf.Lerp(
                context.ParametricRimFresnelPowerFactor,
                target.RimPower,
                rimBlend);
            context.ParametricRimLiftFactor = Mathf.Lerp(
                context.ParametricRimLiftFactor,
                target.RimLift,
                rimBlend);
            context.RimLightingMixFactor = Mathf.Lerp(context.RimLightingMixFactor, 0.35f, rimBlend);

            if (target.HairHighlight && settings.HairHighlightEnabled && settings.Quality != AvatarRenderQuality.Low)
            {
                context.MatcapTexture = GetHairHighlightTexture();
                var highlightBlend = Mathf.Clamp01(settings.HairHighlightIntensity * strength * qualityFactor);
                context.MatcapColorFactorSrgb = Color.Lerp(
                    context.MatcapColorFactorSrgb,
                    _profile.HairHighlightColor,
                    highlightBlend * 0.42f);
            }

            if (target.EyeEmission && settings.Quality == AvatarRenderQuality.High)
            {
                var baseColor = context.BaseColorFactorSrgb;
                var eyeGlow = new Color(baseColor.r * 0.055f, baseColor.g * 0.055f, baseColor.b * 0.065f, 1f);
                context.EmissiveFactorLinear = Color.Lerp(context.EmissiveFactorLinear, eyeGlow, strength * 0.45f);
            }

            var alphaMode = context.AlphaMode;
            var outlineAllowed = settings.OutlineEnabled
                && settings.Quality != AvatarRenderQuality.Low
                && target.AllowOutline
                && (alphaMode != MToon10AlphaMode.Transparent || entry.Role == AvatarMaterialRole.Hair);
            if (outlineAllowed)
            {
                var outlineAmount = Mathf.Clamp(settings.OutlineIntensity * qualityFactor, 0f, 1.5f);
                context.OutlineWidthMode = MToon10OutlineMode.Screen;
                context.OutlineWidthFactor = target.OutlineWidth * outlineAmount;
                var baseColor = context.BaseColorFactorSrgb;
                var derivedOutline = new Color(
                    Mathf.Clamp01(baseColor.r * 0.18f + 0.018f),
                    Mathf.Clamp01(baseColor.g * 0.18f + 0.022f),
                    Mathf.Clamp01(baseColor.b * 0.22f + 0.03f),
                    1f);
                context.OutlineColorFactorSrgb = Color.Lerp(context.OutlineColorFactorSrgb, derivedOutline, strength);
                context.OutlineLightingMixFactor = Mathf.Lerp(context.OutlineLightingMixFactor, 0.18f, strength);
            }
            else
            {
                context.OutlineWidthMode = MToon10OutlineMode.None;
                context.OutlineWidthFactor = 0f;
            }

            context.Validate();
        }

        private Texture2D GetHairHighlightTexture()
        {
            if (_hairHighlightTexture != null) return _hairHighlightTexture;
            const int size = 64;
            _hairHighlightTexture = new Texture2D(size, size, TextureFormat.RGBA32, false, true)
            {
                name = "Katarune Procedural Hair Highlight",
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
                hideFlags = HideFlags.DontSave,
            };

            var pixels = new Color[size * size];
            for (var y = 0; y < size; y += 1)
            {
                var normalizedY = y / (size - 1f);
                for (var x = 0; x < size; x += 1)
                {
                    var normalizedX = x / (size - 1f) * 2f - 1f;
                    var bandCenter = 0.61f - normalizedX * normalizedX * 0.16f;
                    var band = Mathf.Exp(-Mathf.Pow((normalizedY - bandCenter) / 0.105f, 2f));
                    var edgeFade = Mathf.SmoothStep(0f, 1f, 1f - Mathf.Abs(normalizedX));
                    var value = band * edgeFade * 0.72f;
                    pixels[y * size + x] = new Color(value, value, value, 1f);
                }
            }
            _hairHighlightTexture.SetPixels(pixels);
            _hairHighlightTexture.Apply(false, true);
            return _hairHighlightTexture;
        }

        private static bool IsSupportedMToon(Material material)
        {
            return material.shader != null
                && string.Equals(material.shader.name, MToonUrpShader, StringComparison.Ordinal)
                && material.HasProperty("_ShadingToonyFactor")
                && material.HasProperty("_OutlineWidth");
        }

        private static float GetQualityFactor(AvatarRenderQuality quality)
        {
            switch (quality)
            {
                case AvatarRenderQuality.Low: return 0.35f;
                case AvatarRenderQuality.Medium: return 0.72f;
                default: return 1f;
            }
        }

        private static Color MultiplyColor(Color source, Color tint)
        {
            return new Color(source.r * tint.r, source.g * tint.g, source.b * tint.b, source.a);
        }

        private sealed class MaterialEntry : IDisposable
        {
            private readonly Material _snapshot;
            private readonly string[] _keywords;
            private readonly int _renderQueue;

            public MaterialEntry(Material material, AvatarMaterialRole role)
            {
                Material = material;
                Role = role;
                _snapshot = new Material(material)
                {
                    name = $"{material.name} NPR Baseline",
                    hideFlags = HideFlags.DontSave,
                };
                _keywords = material.shaderKeywords.ToArray();
                _renderQueue = material.renderQueue;
            }

            public Material Material { get; }
            public AvatarMaterialRole Role { get; }

            public void Restore()
            {
                if (Material == null || _snapshot == null) return;
                Material.CopyPropertiesFromMaterial(_snapshot);
                Material.shaderKeywords = _keywords;
                Material.renderQueue = _renderQueue;
            }

            public void Dispose()
            {
                Restore();
                AvatarVisualController.DestroyObject(_snapshot);
            }
        }
    }
}
