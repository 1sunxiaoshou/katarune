using System.IO;

namespace Katarune.Avatar
{
    public static class AvatarDefaultAssets
    {
        public const string IdleMotionFileName = "idle-standing-breathing.vrma";
        public const int IdleVariationCount = 4;

        public static string IdleVariationFileName(int number)
        {
            if (number < 1 || number > IdleVariationCount) throw new System.ArgumentOutOfRangeException(nameof(number));
            return $"idle-variant-{number:D2}.vrma";
        }

        public static string IdleVariationPath(string dataPath, int number) =>
            Path.GetFullPath(Path.Combine(dataPath, "KataruneLocal", "Motions", IdleVariationFileName(number)));

        // Only Editor previews and baking resolve repository resources themselves.
        // The standalone Player receives a package descriptor or an explicit --vrm path.
        public static string EditorModelPath(string assetsPath) =>
            Path.GetFullPath(Path.Combine(assetsPath, "..", "..", "..", "resources", "characters", "default-package", "avatar", "model.vrm"));

        public static string IdleMotionPath(string dataPath) =>
            Path.GetFullPath(Path.Combine(dataPath, "KataruneLocal", "Motions", IdleMotionFileName));
    }
}
