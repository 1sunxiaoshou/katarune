using System;
using UnityEngine;

namespace Katarune.Avatar
{
    [Serializable]
    public sealed class AvatarLightingPreset
    {
        [SerializeField, Min(0f)] private float keyIntensity;
        [SerializeField, ColorUsage(false, false)] private Color keyColor;
        [SerializeField, ColorUsage(false, false)] private Color ambientColor;

        public AvatarLightingPreset(float keyIntensity, Color keyColor, Color ambientColor)
        {
            this.keyIntensity = Mathf.Max(0f, keyIntensity);
            this.keyColor = keyColor;
            this.ambientColor = ambientColor;
        }

        public float KeyIntensity => Mathf.Max(0f, keyIntensity);
        public Color KeyColor => keyColor;
        public Color AmbientColor => ambientColor;
    }

    [CreateAssetMenu(fileName = "AvatarLightingProfile", menuName = "Katarune/Avatar Lighting Profile")]
    public sealed class AvatarLightingProfile : ScriptableObject
    {
        [Header("默认灯光")]
        [SerializeField] private AvatarLightingPreset defaultLighting = new AvatarLightingPreset(
            0.9f,
            new Color(1f, 0.97f, 0.94f),
            new Color(0.34f, 0.36f, 0.4f));

        public AvatarLightingPreset DefaultLighting => defaultLighting;

        public static AvatarLightingProfile LoadDefault()
        {
            var profile = Resources.Load<AvatarLightingProfile>("AvatarLightingProfile");
            if (profile != null) return profile;

            profile = CreateInstance<AvatarLightingProfile>();
            profile.name = "Runtime Avatar Lighting Profile";
            profile.hideFlags = HideFlags.DontSave;
            return profile;
        }

    }
}
