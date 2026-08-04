using System;
using System.Collections.Generic;
using UnityEngine;

namespace Katarune.Avatar
{
    public enum AvatarRenderQuality
    {
        Low,
        Medium,
        High,
    }

    public enum AvatarMaterialRole
    {
        Generic,
        Face,
        Skin,
        Hair,
        Eye,
        Detail,
        Clothing,
    }

    [Serializable]
    public sealed class AvatarMaterialRoleOverride
    {
        [SerializeField] private string nameContains = string.Empty;
        [SerializeField] private AvatarMaterialRole role = AvatarMaterialRole.Generic;

        public string NameContains => nameContains;
        public AvatarMaterialRole Role => role;
    }

    public readonly struct AvatarMaterialStyleTarget
    {
        public AvatarMaterialStyleTarget(
            float shadingToony,
            float shadingShift,
            float giEqualization,
            Color shadeTint,
            Color rimColor,
            float rimPower,
            float rimLift,
            float outlineWidth,
            bool allowOutline,
            bool hairHighlight,
            bool eyeEmission)
        {
            ShadingToony = shadingToony;
            ShadingShift = shadingShift;
            GiEqualization = giEqualization;
            ShadeTint = shadeTint;
            RimColor = rimColor;
            RimPower = rimPower;
            RimLift = rimLift;
            OutlineWidth = outlineWidth;
            AllowOutline = allowOutline;
            HairHighlight = hairHighlight;
            EyeEmission = eyeEmission;
        }

        public float ShadingToony { get; }
        public float ShadingShift { get; }
        public float GiEqualization { get; }
        public Color ShadeTint { get; }
        public Color RimColor { get; }
        public float RimPower { get; }
        public float RimLift { get; }
        public float OutlineWidth { get; }
        public bool AllowOutline { get; }
        public bool HairHighlight { get; }
        public bool EyeEmission { get; }
    }

    [CreateAssetMenu(fileName = "AvatarVisualProfile", menuName = "Katarune/Avatar Visual Profile")]
    public sealed class AvatarVisualProfile : ScriptableObject
    {
        [Header("默认表现")]
        [SerializeField, Range(0f, 1f)] private float styleStrength = 0.82f;
        [SerializeField, Range(0f, 1.5f)] private float rimIntensity = 0.72f;
        [SerializeField, Range(0f, 1.5f)] private float outlineIntensity = 0.78f;
        [SerializeField, Range(0f, 1.5f)] private float hairHighlightIntensity = 0.58f;
        [SerializeField] private AvatarRenderQuality quality = AvatarRenderQuality.High;
        [SerializeField] private bool outlineEnabled = true;
        [SerializeField] private bool hairHighlightEnabled = true;

        [Header("颜色设计")]
        [SerializeField] private Color warmShadowTint = new Color(0.86f, 0.72f, 0.76f, 1f);
        [SerializeField] private Color coolShadowTint = new Color(0.69f, 0.75f, 0.9f, 1f);
        [SerializeField] private Color neutralShadowTint = new Color(0.76f, 0.78f, 0.86f, 1f);
        [SerializeField] private Color warmRimColor = new Color(1f, 0.77f, 0.68f, 1f);
        [SerializeField] private Color coolRimColor = new Color(0.55f, 0.72f, 1f, 1f);
        [SerializeField] private Color hairHighlightColor = new Color(0.76f, 0.83f, 1f, 1f);

        [Header("模型专属覆盖")]
        [SerializeField] private List<AvatarMaterialRoleOverride> materialOverrides = new List<AvatarMaterialRoleOverride>();

        public float StyleStrength => styleStrength;
        public float RimIntensity => rimIntensity;
        public float OutlineIntensity => outlineIntensity;
        public float HairHighlightIntensity => hairHighlightIntensity;
        public AvatarRenderQuality Quality => quality;
        public bool OutlineEnabled => outlineEnabled;
        public bool HairHighlightEnabled => hairHighlightEnabled;
        public Color HairHighlightColor => hairHighlightColor;

        public static AvatarVisualProfile LoadDefault()
        {
            var profile = Resources.Load<AvatarVisualProfile>("AvatarVisualProfile");
            if (profile != null) return profile;

            profile = CreateInstance<AvatarVisualProfile>();
            profile.name = "Runtime Avatar Visual Profile";
            profile.hideFlags = HideFlags.DontSave;
            return profile;
        }

        public AvatarMaterialRole ResolveRole(string materialName, string rendererName)
        {
            var combined = $"{rendererName}/{materialName}";
            foreach (var entry in materialOverrides)
            {
                if (entry == null || string.IsNullOrWhiteSpace(entry.NameContains)) continue;
                if (combined.IndexOf(entry.NameContains, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    return entry.Role;
                }
            }

            return AvatarMaterialClassifier.Classify(materialName, rendererName);
        }

        public AvatarMaterialStyleTarget GetStyle(AvatarMaterialRole role)
        {
            switch (role)
            {
                case AvatarMaterialRole.Face:
                    return new AvatarMaterialStyleTarget(0.98f, -0.11f, 0.88f, warmShadowTint, warmRimColor, 4.8f, 0.08f, 0.0013f, true, false, false);
                case AvatarMaterialRole.Skin:
                    return new AvatarMaterialStyleTarget(0.96f, -0.08f, 0.82f, warmShadowTint, warmRimColor, 4.5f, 0.06f, 0.0015f, true, false, false);
                case AvatarMaterialRole.Hair:
                    return new AvatarMaterialStyleTarget(0.94f, -0.045f, 0.7f, coolShadowTint, coolRimColor, 3.6f, 0.12f, 0.0022f, true, true, false);
                case AvatarMaterialRole.Eye:
                    return new AvatarMaterialStyleTarget(0.99f, 0.08f, 1f, Color.white, coolRimColor, 5.5f, 0.02f, 0f, false, false, true);
                case AvatarMaterialRole.Detail:
                    return new AvatarMaterialStyleTarget(0.98f, 0.03f, 0.96f, neutralShadowTint, coolRimColor, 5f, 0.02f, 0f, false, false, false);
                case AvatarMaterialRole.Clothing:
                    return new AvatarMaterialStyleTarget(0.9f, -0.035f, 0.73f, coolShadowTint, coolRimColor, 4f, 0.08f, 0.0018f, true, false, false);
                default:
                    return new AvatarMaterialStyleTarget(0.91f, -0.025f, 0.76f, neutralShadowTint, coolRimColor, 4.2f, 0.07f, 0.0016f, true, false, false);
            }
        }
    }

    public static class AvatarMaterialClassifier
    {
        private static readonly string[] EyeTokens =
        {
            "eye", "iris", "pupil", "cornea", "eyeball", "瞳", "眼球", "目玉", "白目",
        };

        private static readonly string[] DetailTokens =
        {
            "eyelash", "lash", "eyebrow", "brow", "mouth", "lip", "teeth", "tooth", "tongue",
            "まつげ", "眉", "口", "唇", "歯", "舌",
        };

        private static readonly string[] HairTokens =
        {
            "hair", "bang", "fringe", "ahoge", "ponytail", "髪", "前髪", "後髪", "毛",
        };

        private static readonly string[] FaceTokens =
        {
            "face", "head", "cheek", "facial", "顔", "頬", "头", "脸",
        };

        private static readonly string[] SkinTokens =
        {
            "skin", "body", "hand", "arm", "leg", "肌", "素体", "身体", "皮肤",
        };

        private static readonly string[] ClothingTokens =
        {
            "cloth", "dress", "shirt", "skirt", "coat", "jacket", "uniform", "shoe", "sock", "ribbon",
            "服", "衣", "靴", "鞋", "袜", "リボン",
        };

        public static AvatarMaterialRole Classify(string materialName, string rendererName)
        {
            var material = Normalize(materialName);
            var materialRole = ClassifyName(material);
            return materialRole != AvatarMaterialRole.Generic
                ? materialRole
                : ClassifyName(Normalize(rendererName));
        }

        private static AvatarMaterialRole ClassifyName(string value)
        {
            // More specific facial details must be tested before broad tokens such as "eye".
            if (ContainsAny(value, DetailTokens)) return AvatarMaterialRole.Detail;
            if (ContainsAny(value, EyeTokens)) return AvatarMaterialRole.Eye;
            if (ContainsAny(value, HairTokens)) return AvatarMaterialRole.Hair;
            if (ContainsAny(value, FaceTokens)) return AvatarMaterialRole.Face;
            if (ContainsAny(value, ClothingTokens)) return AvatarMaterialRole.Clothing;
            if (ContainsAny(value, SkinTokens)) return AvatarMaterialRole.Skin;
            return AvatarMaterialRole.Generic;
        }

        private static string Normalize(string value)
        {
            return (value ?? string.Empty).ToLowerInvariant().Replace("(instance)", string.Empty);
        }

        private static bool ContainsAny(string value, IEnumerable<string> tokens)
        {
            foreach (var token in tokens)
            {
                if (value.Contains(token)) return true;
            }
            return false;
        }
    }

    public sealed class AvatarMaterialStatistics
    {
        private readonly int[] _roleCounts = new int[Enum.GetValues(typeof(AvatarMaterialRole)).Length];
        private readonly List<string> _entries = new List<string>();

        public int Total { get; private set; }
        public int Styled { get; private set; }
        public int Unsupported => Total - Styled;
        public IReadOnlyList<string> Entries => _entries;

        public int GetCount(AvatarMaterialRole role) => _roleCounts[(int)role];

        internal void Add(AvatarMaterialRole role, bool styled, string rendererName, string materialName)
        {
            Total += 1;
            if (styled) Styled += 1;
            _roleCounts[(int)role] += 1;
            _entries.Add($"{rendererName}/{materialName}:{role}:{(styled ? "mtoon" : "unsupported")}");
        }
    }
}
