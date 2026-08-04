using System;
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
            bool debugUi,
            bool nprEnabled,
            AvatarRenderQuality renderQuality)
        {
            ModelPath = modelPath;
            ScreenshotPath = screenshotPath;
            ExitAfterCapture = exitAfterCapture;
            ExitOnError = exitOnError;
            TransparentWindow = transparentWindow;
            DebugUi = debugUi;
            NprEnabled = nprEnabled;
            RenderQuality = renderQuality;
        }

        public string ModelPath { get; }
        public string ScreenshotPath { get; }
        public bool ExitAfterCapture { get; }
        public bool ExitOnError { get; }
        public bool TransparentWindow { get; }
        public bool DebugUi { get; }
        public bool NprEnabled { get; }
        public AvatarRenderQuality RenderQuality { get; }

        public static AvatarCommandLine Parse(string[] args)
        {
            if (args == null) throw new ArgumentNullException(nameof(args));

            string modelPath = null;
            string screenshotPath = null;
            var exitAfterCapture = false;
            var exitOnError = false;
            var transparentWindow = true;
            var debugUi = false;
            var nprEnabled = true;
            var renderQuality = AvatarRenderQuality.High;
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
                    case "--debug-ui":
                        debugUi = true;
                        break;
                    case "--no-npr":
                        nprEnabled = false;
                        break;
                    case "--render-quality":
                        renderQuality = ReadRenderQuality(args, ref index);
                        break;
                }
            }

            return new AvatarCommandLine(
                modelPath,
                screenshotPath,
                exitAfterCapture,
                exitOnError,
                transparentWindow,
                debugUi,
                nprEnabled,
                renderQuality);
        }

        private static AvatarRenderQuality ReadRenderQuality(string[] args, ref int index)
        {
            var valueIndex = index + 1;
            if (valueIndex >= args.Length || string.IsNullOrWhiteSpace(args[valueIndex]))
            {
                throw new ArgumentException("--render-quality requires low, medium, or high.", nameof(args));
            }

            index = valueIndex;
            if (Enum.TryParse(args[valueIndex], true, out AvatarRenderQuality quality)) return quality;
            throw new ArgumentException("--render-quality requires low, medium, or high.", nameof(args));
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
