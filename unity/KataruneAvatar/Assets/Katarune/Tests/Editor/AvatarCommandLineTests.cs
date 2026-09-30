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
        public void ParseAllowsOpaqueWindow()
        {
            var options = AvatarCommandLine.Parse(new[] { "app.exe", "--opaque-window" });
            Assert.That(options.TransparentWindow, Is.False);
        }

        [Test]
        public void ParseRecognizesSoftOutlineOption()
        {
            var options = AvatarCommandLine.Parse(new[] { "app.exe", "--soft-outline" });
            Assert.That(options.SoftOutlineEnabled, Is.True);
        }

        [Test]
        public void ParseDefaultsToOriginalMaterials()
        {
            var options = AvatarCommandLine.Parse(new[] { "app.exe" });
            Assert.That(options.SoftOutlineEnabled, Is.False);
        }

        [Test]
        public void ParseRecognizesCaptureDelayForVisualSmokeTests()
        {
            var options = AvatarCommandLine.Parse(new[] { "app.exe", "--capture-delay", "1.5" });

            Assert.That(options.CaptureDelaySeconds, Is.EqualTo(1.5f));
        }

        [TestCase("-1")]
        [TestCase("31")]
        [TestCase("later")]
        public void ParseRejectsInvalidCaptureDelay(string value)
        {
            Assert.Throws<ArgumentException>(() =>
                AvatarCommandLine.Parse(new[] { "app.exe", "--capture-delay", value }));
        }

        [Test]
        public void ParseRecognizesInitialActionForVisualSmokeTests()
        {
            var options = AvatarCommandLine.Parse(new[] { "app.exe", "--action", "greet-wave" });

            Assert.That(options.InitialAction, Is.EqualTo("greet-wave"));
        }

        [Test]
        public void ParseRejectsMissingPathValue()
        {
            Assert.Throws<ArgumentException>(() => AvatarCommandLine.Parse(new[] { "app.exe", "--vrm" }));
        }

        [TestCase("right-hand-offer", AvatarPresetAction.RightHandOffer)]
        [TestCase("right-hand-open", AvatarPresetAction.RightHandOpen)]
        [TestCase("right-hand-to-chest", AvatarPresetAction.RightHandToChest)]
        [TestCase("left-hand-open-twice", AvatarPresetAction.LeftHandOpenTwice)]
        [TestCase("dance-delusion-angel", AvatarPresetAction.DanceDelusionAngel)]
        public void ParseRecognizesLocalGestureActions(string name, AvatarPresetAction action)
        {
            Assert.That(AvatarCommandLine.Parse(new[] { "app.exe", "--action", name }).InitialAction,
                Is.EqualTo(AvatarActionIds.FromPreset(action)));
        }

        [Test]
        public void DefaultModelResolutionPrefersTheCommandLinePath()
        {
            const string requestedPath = "C:/Models/Explicit.vrm";

            Assert.That(
                AvatarBootstrap.ResolveInitialModelPath(requestedPath, "C:/Project/Assets"),
                Is.EqualTo(requestedPath));
        }

        [Test]
        public void DefaultModelResolutionUsesTheLocalIgnoredModelWhenPresent()
        {
            var assetsPath = Path.Combine(
                Path.GetTempPath(),
                "katarune-avatar-tests",
                Guid.NewGuid().ToString("N"),
                "Assets");
            var modelPath = Path.Combine(
                assetsPath,
                "KataruneLocal",
                "Models",
                AvatarDefaultAssets.ModelFileName);
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(modelPath)!);
                File.WriteAllBytes(modelPath, new byte[] { 0x56, 0x52, 0x4D });

                Assert.That(
                    AvatarBootstrap.ResolveInitialModelPath(null, assetsPath),
                    Is.EqualTo(Path.GetFullPath(modelPath)));
            }
            finally
            {
                var testRoot = Directory.GetParent(assetsPath)?.FullName;
                if (!string.IsNullOrWhiteSpace(testRoot) && Directory.Exists(testRoot))
                {
                    Directory.Delete(testRoot, recursive: true);
                }
            }
        }

        [Test]
        public void DefaultModelResolutionLeavesTheRuntimeEmptyWhenNoLocalModelExists()
        {
            var assetsPath = Path.Combine(
                Path.GetTempPath(),
                "katarune-avatar-tests",
                Guid.NewGuid().ToString("N"),
                "Assets");

            Assert.That(AvatarBootstrap.ResolveInitialModelPath(null, assetsPath), Is.Null);
        }
    }
}
