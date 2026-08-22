using System;
using System.Collections.Generic;
using UnityEngine;

namespace Katarune.Avatar
{
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

    public readonly struct AvatarSoftOutlineTarget
    {
        public AvatarSoftOutlineTarget(float width, bool enabled)
        {
            Width = width;
            Enabled = enabled;
        }

        public float Width { get; }
        public bool Enabled { get; }
    }

    [CreateAssetMenu(fileName = "AvatarVisualProfile", menuName = "Katarune/Avatar Outline Profile")]
    public sealed class AvatarVisualProfile : ScriptableObject
    {
        [Header("柔和描边")]
        [SerializeField, Range(0f, 1.5f)] private float outlineIntensity = 0.55f;
        [SerializeField, Range(0f, 1f)] private float outlineColorBlend = 0.86f;
        [SerializeField, Range(0f, 1f)] private float outlineLightingMix = 0.18f;
        [SerializeField, Range(0f, 0.004f)] private float genericWidth = 0.0012f;
        [SerializeField, Range(0f, 0.004f)] private float faceWidth = 0.0008f;
        [SerializeField, Range(0f, 0.004f)] private float skinWidth = 0.001f;
        [SerializeField, Range(0f, 0.004f)] private float hairWidth = 0.0015f;
        [SerializeField, Range(0f, 0.004f)] private float clothingWidth = 0.0013f;

        [Header("模型专属材质角色覆盖")]
        [SerializeField] private List<AvatarMaterialRoleOverride> materialOverrides = new List<AvatarMaterialRoleOverride>();

        public float OutlineIntensity => outlineIntensity;
        public float OutlineColorBlend => outlineColorBlend;
        public float OutlineLightingMix => outlineLightingMix;

        public static AvatarVisualProfile LoadDefault()
        {
            var profile = Resources.Load<AvatarVisualProfile>("AvatarVisualProfile");
            if (profile != null) return profile;

            profile = CreateInstance<AvatarVisualProfile>();
            profile.name = "Runtime Avatar Outline Profile";
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

        public AvatarSoftOutlineTarget GetSoftOutline(AvatarMaterialRole role)
        {
            switch (role)
            {
                case AvatarMaterialRole.Face:
                    return new AvatarSoftOutlineTarget(faceWidth, true);
                case AvatarMaterialRole.Skin:
                    return new AvatarSoftOutlineTarget(skinWidth, true);
                case AvatarMaterialRole.Hair:
                    return new AvatarSoftOutlineTarget(hairWidth, true);
                case AvatarMaterialRole.Clothing:
                    return new AvatarSoftOutlineTarget(clothingWidth, true);
                case AvatarMaterialRole.Eye:
                case AvatarMaterialRole.Detail:
                    return new AvatarSoftOutlineTarget(0f, false);
                default:
                    return new AvatarSoftOutlineTarget(genericWidth, true);
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
            var materialRole = ClassifyName(Normalize(materialName));
            return materialRole != AvatarMaterialRole.Generic
                ? materialRole
                : ClassifyName(Normalize(rendererName));
        }

        private static AvatarMaterialRole ClassifyName(string value)
        {
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
        private readonly List<string> _entries = new List<string>();

        public int Total { get; private set; }
        public int Supported { get; private set; }
        public int Unsupported => Total - Supported;
        public IReadOnlyList<string> Entries => _entries;

        internal void Add(AvatarMaterialRole role, bool supported, string rendererName, string materialName)
        {
            Total += 1;
            if (supported) Supported += 1;
            _entries.Add($"{rendererName}/{materialName}:{role}:{(supported ? "mtoon" : "unsupported")}");
        }
    }
}
