using NUnit.Framework;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarWindowInputTests
    {
        [Test]
        public void AdjustmentOnlyAcceptsTheStableCharacterArea()
        {
            var character = new AvatarWindow.Rectangle { x = 700, y = 250, width = 350, height = 650 };
            Assert.That(AvatarWindow.IsInControlArea(850, 500, character, null), Is.True);
            Assert.That(AvatarWindow.IsInControlArea(200, 500, character, null), Is.False);
            Assert.That(AvatarWindow.IsInControlArea(850, 200, character, null), Is.False);
            Assert.That(AvatarWindow.IsInControlArea(1100, 500, character, null), Is.False);
        }

        [Test]
        public void VisibleControlsStayClickableEvenWhenTheyOverlapTheCharacter()
        {
            var character = new AvatarWindow.Rectangle { x = 700, y = 250, width = 350, height = 650 };
            var capsule = new AvatarWindow.Rectangle { x = 800, y = 650, width = 100, height = 64 };
            Assert.That(AvatarWindow.IsInControlArea(850, 680, character, new[] { capsule }), Is.False);
            Assert.That(AvatarWindow.IsInControlArea(850, 720, character, new[] { capsule }), Is.True);
        }
    }
}
