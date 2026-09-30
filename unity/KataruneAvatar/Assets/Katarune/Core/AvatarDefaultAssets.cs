using System.IO;

namespace Katarune.Avatar
{
    public static class AvatarDefaultAssets
    {
        public const string ModelFileName = "default-avatar.vrm";
        public const string IdleMotionFileName = "idle-standing-breathing.vrma";
        public const int IdleVariationCount = 4;

        public static string IdleVariationFileName(int number)
        {
            if (number < 1 || number > IdleVariationCount) throw new System.ArgumentOutOfRangeException(nameof(number));
            return $"idle-variant-{number:D2}.vrma";
        }

        public static string IdleVariationPath(string dataPath, int number) =>
            Path.GetFullPath(Path.Combine(dataPath, "KataruneLocal", "Motions", IdleVariationFileName(number)));

        public static string ModelPath(string dataPath) =>
            Path.GetFullPath(Path.Combine(dataPath, "KataruneLocal", "Models", ModelFileName));

        public static string IdleMotionPath(string dataPath) =>
            Path.GetFullPath(Path.Combine(dataPath, "KataruneLocal", "Motions", IdleMotionFileName));
    }
}
