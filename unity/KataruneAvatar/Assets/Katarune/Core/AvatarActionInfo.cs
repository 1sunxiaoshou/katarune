using System;

namespace Katarune.Avatar
{
    public readonly struct AvatarActionInfo
    {
        public AvatarActionInfo(string id, string displayName) { Id = id; DisplayName = displayName; }
        public string Id { get; }
        public string DisplayName { get; }
    }

    public static class AvatarActionIds
    {
        private static readonly string[] Ids =
        {
            "greet-wave", "explain", "celebrate", "cough", "right-hand-offer",
            "right-hand-open", "right-hand-to-chest", "left-hand-open-twice", "dance-delusion-angel",
        };
        private static readonly string[] Names =
        {
            "挥手", "解释", "庆祝", "咳嗽", "右手前递", "右手摊手", "右手放胸口", "左手摊手两下", "妄想天使之舞",
        };

        public static string FromPreset(AvatarPresetAction action) =>
            (int)action >= 0 && (int)action < Ids.Length ? Ids[(int)action]
                : throw new ArgumentOutOfRangeException(nameof(action));
        public static AvatarPresetAction? ToPreset(string id)
        {
            var index = Array.IndexOf(Ids, id);
            return index < 0 ? null : (AvatarPresetAction?)index;
        }
        public static string PresetName(AvatarPresetAction action) => Names[(int)action];

        public static bool IsValid(string id)
        {
            if (string.IsNullOrWhiteSpace(id) || id.Length > 128) return false;
            foreach (var c in id)
                if (!(c >= 'a' && c <= 'z') && !(c >= '0' && c <= '9') && c != '-' && c != '_' && c != '.')
                    return false;
            return id[0] != '.' && id[0] != '-';
        }
    }
}
