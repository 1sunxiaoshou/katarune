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
            AvatarLightingMode lightingMode,
            float captureDelaySeconds,
            AvatarPresetAction? initialAction)
        {
            ModelPath = modelPath;
            ScreenshotPath = screenshotPath;
            ExitAfterCapture = exitAfterCapture;
            ExitOnError = exitOnError;
            TransparentWindow = transparentWindow;
            SoftOutlineEnabled = softOutlineEnabled;
            LightingMode = lightingMode;
            CaptureDelaySeconds = captureDelaySeconds;
            InitialAction = initialAction;
        }

        public string ModelPath { get; }
        public string ScreenshotPath { get; }
        public bool ExitAfterCapture { get; }
        public bool ExitOnError { get; }
        public bool TransparentWindow { get; }
        public bool SoftOutlineEnabled { get; }
        public AvatarLightingMode LightingMode { get; }
        public float CaptureDelaySeconds { get; }
        public AvatarPresetAction? InitialAction { get; }

        public static AvatarCommandLine Parse(string[] args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));

            string modelPath = null;
            string screenshotPath = null;
            var exitAfterCapture = false;
            var exitOnError = false;
            var transparentWindow = true;
            var softOutlineEnabled = false;
            var lightingMode = AvatarLightingMode.LightDesktop;
            var captureDelaySeconds = 0f;
            AvatarPresetAction? initialAction = null;
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
                    case "--lighting":
                        lightingMode = ReadLightingMode(args, ref index);
                        break;
                    case "--capture-delay":
                        captureDelaySeconds = ReadCaptureDelay(args, ref index);
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
                lightingMode,
                captureDelaySeconds,
                initialAction);
        }

        private static AvatarPresetAction ReadAction(string[] args, ref int index)
        {
            var valueIndex = index + 1;
            if (valueIndex >= args.Length || string.IsNullOrWhiteSpace(args[valueIndex]))
            {
                throw new ArgumentException(
                    "--action requires greet-wave, explain, celebrate or cough.",
                    nameof(args));
            }
            index = valueIndex;
            switch (args[valueIndex].ToLowerInvariant())
            {
                case "greet-wave": return AvatarPresetAction.GreetWave;
                case "explain": return AvatarPresetAction.Explain;
                case "celebrate": return AvatarPresetAction.Celebrate;
                case "cough": return AvatarPresetAction.Cough;
                default:
                    throw new ArgumentException(
                        "--action requires greet-wave, explain, celebrate or cough.",
                        nameof(args));
            }
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

        private static AvatarLightingMode ReadLightingMode(string[] args, ref int index)
        {
            var valueIndex = index + 1;
            if (valueIndex >= args.Length || string.IsNullOrWhiteSpace(args[valueIndex]))
            {
                throw new ArgumentException("--lighting requires light or dark.", nameof(args));
            }

            index = valueIndex;
            switch (args[valueIndex].ToLowerInvariant())
            {
                case "light":
                    return AvatarLightingMode.LightDesktop;
                case "dark":
                    return AvatarLightingMode.DarkDesktop;
                default:
                    throw new ArgumentException("--lighting requires light or dark.", nameof(args));
            }
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
