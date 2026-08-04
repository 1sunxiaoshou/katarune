using NUnit.Framework;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarSceneRigTests
    {
        [TestCase(1f, 0.7f)]
        [TestCase(1.7f, 0.75f)]
        [TestCase(2.4f, 0.8f)]
        [TestCase(3f, 0.8f)]
        public void DesiredViewportCenterStaysOnRightAndAdaptsToAspect(float aspect, float expected)
        {
            Assert.That(AvatarSceneRig.GetDesiredViewportCenterX(aspect), Is.EqualTo(expected).Within(0.005f));
        }
    }
}
