using System;
using System.IO;
using NUnit.Framework;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarCommandLineTests
    {
        [Test]
        public void ParseResolvesModelAndScreenshotPaths()
        {
            var options = AvatarCommandLine.Parse(new[] { "app.exe", "--vrm", "model.vrm", "--screenshot", "capture.png" });
            Assert.That(options.ModelPath, Is.EqualTo(Path.GetFullPath("model.vrm")));
            Assert.That(options.ScreenshotPath, Is.EqualTo(Path.GetFullPath("capture.png")));
        }

        [Test]
        public void ParseRecognizesExitFlags()
        {
            var options = AvatarCommandLine.Parse(new[] { "app.exe", "--exit-after-capture", "--exit-on-error" });
            Assert.That(options.ExitAfterCapture, Is.True);
            Assert.That(options.ExitOnError, Is.True);
            Assert.That(options.TransparentWindow, Is.True);
        }

        [Test]
        public void ParseAllowsOpaqueDebugWindow()
        {
            var options = AvatarCommandLine.Parse(new[] { "app.exe", "--opaque-window", "--debug-ui" });
            Assert.That(options.TransparentWindow, Is.False);
            Assert.That(options.DebugUi, Is.True);
        }

        [Test]
        public void ParseRecognizesNprOptions()
        {
            var options = AvatarCommandLine.Parse(new[] { "app.exe", "--render-quality", "medium", "--no-npr" });
            Assert.That(options.RenderQuality, Is.EqualTo(AvatarRenderQuality.Medium));
            Assert.That(options.NprEnabled, Is.False);
        }

        [Test]
        public void ParseRejectsUnknownRenderQuality()
        {
            Assert.Throws<ArgumentException>(() => AvatarCommandLine.Parse(new[] { "app.exe", "--render-quality", "cinematic" }));
        }

        [Test]
        public void ParseRejectsMissingPathValue()
        {
            Assert.Throws<ArgumentException>(() => AvatarCommandLine.Parse(new[] { "app.exe", "--vrm" }));
        }
    }
}
