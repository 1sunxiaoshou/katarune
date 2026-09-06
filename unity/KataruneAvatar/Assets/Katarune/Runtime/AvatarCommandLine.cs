using System;
using System.Globalization;
using System.IO;

namespace Katarune.Avatar
{
    public sealed class AvatarCommandLine
    {
        private AvatarCommandLine(
            string modelPath,
            string screenshotPath,
            bool exitAfterCapture,
            bool exitOnError,
            bool transparentWindow,
            bool softOutlineEnabled,
            float captureDelaySeconds,
            string initialAction, string motionPacksDirectory)
        {
            ModelPath = modelPath;
            ScreenshotPath = screenshotPath;
            ExitAfterCapture = exitAfterCapture;
            ExitOnError = exitOnError;
            TransparentWindow = transparentWindow;
            SoftOutlineEnabled = softOutlineEnabled;
            CaptureDelaySeconds = captureDelaySeconds;
            InitialAction = initialAction;
            MotionPacksDirectory = motionPacksDirectory;
        }

        public string ModelPath { get; }
        public string ScreenshotPath { get; }
        public bool ExitAfterCapture { get; }
        public bool ExitOnError { get; }
        public bool TransparentWindow { get; }
        public bool SoftOutlineEnabled { get; }
        public float CaptureDelaySeconds { get; }
        public string InitialAction { get; }
        public string MotionPacksDirectory { get; }

        public static AvatarCommandLine Parse(string[] args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));

            string modelPath = null;
            string screenshotPath = null;
            var exitAfterCapture = false;
            var exitOnError = false;
            var transparentWindow = true;
            var softOutlineEnabled = false;
            var captureDelaySeconds = 0f;
            string initialAction = null;
            string motionPacksDirectory = null;
            for (var index = 0; index < args.Length; index += 1)
            {
                switch (args[index])
                {
                    case "--vrm":
                        modelPath = ReadPathValue(args, ref index, "--vrm");
                        break;
                    case "--screenshot":
                        screenshotPath = ReadPathValue(args, ref index, "--screenshot");
                        break;
                    case "--exit-after-capture":
                        exitAfterCapture = true;
                        break;
                    case "--exit-on-error":
                        exitOnError = true;
                        break;
                    case "--opaque-window":
                        transparentWindow = false;
                        break;
                    case "--soft-outline":
                        softOutlineEnabled = true;
                        break;
                    case "--capture-delay":
                        captureDelaySeconds = ReadCaptureDelay(args, ref index);
                        break;
                    case "--motion-packs":
                        motionPacksDirectory = ReadPathValue(args, ref index, "--motion-packs");
                        break;
                    case "--action":
                        initialAction = ReadAction(args, ref index);
                        break;
                }
            }

            return new AvatarCommandLine(
                modelPath,
                screenshotPath,
                exitAfterCapture,
                exitOnError,
                transparentWindow,
                softOutlineEnabled,
                captureDelaySeconds,
                initialAction, motionPacksDirectory);
        }

        private static string ReadAction(string[] args, ref int index)
        {
            if (index + 1 >= args.Length || !AvatarActionIds.IsValid(args[index + 1]))
                throw new ArgumentException("--action requires an installed action ID (lowercase letters, digits, dots, hyphens or underscores).");
            return args[++index];
        }

        private static float ReadCaptureDelay(string[] args, ref int index)
        {
            var valueIndex = index + 1;
            if (valueIndex >= args.Length
                || !float.TryParse(
                    args[valueIndex],
                    NumberStyles.Float,
                    CultureInfo.InvariantCulture,
                    out var seconds)
                || seconds < 0f
                || seconds > 30f)
            {
                throw new ArgumentException(
                    "--capture-delay requires a number from 0 to 30 seconds.",
                    nameof(args));
            }
            index = valueIndex;
            return seconds;
        }

        private static string ReadPathValue(string[] args, ref int index, string option)
        {
            var valueIndex = index + 1;
            if (valueIndex >= args.Length || string.IsNullOrWhiteSpace(args[valueIndex]))
            {
                throw new ArgumentException($"{option} requires a path value.", nameof(args));
            }

            index = valueIndex;
            return Path.GetFullPath(args[valueIndex]);
        }
    }
}
