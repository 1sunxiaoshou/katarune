using NUnit.Framework;
using UnityEngine;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarPackageSerializationTests
    {
        [Test]
        public void OmittedCameraSurvivesJsonUtilityWithoutBecomingAnAuthoredCamera()
        {
            var playback = JsonUtility.FromJson<AvatarPackagePlayback>("{\"kind\":\"oneShot\",\"motion\":\"wave.vrma\"}");
            Assert.That(playback.HasCamera, Is.False);
            var roundTrip = JsonUtility.FromJson<AvatarPackagePlayback>(JsonUtility.ToJson(playback));
            Assert.That(roundTrip.HasCamera, Is.False);
            Assert.That(roundTrip.motion, Is.EqualTo("wave.vrma"));
        }

        [TestCase("{\"kind\":\"track\",\"file\":\"camera.glb\"}")]
        [TestCase("{\"kind\":\"presets\",\"keys\":[{\"at\":0,\"view\":\"center\"}]}")]
        public void TaggedCameraSurvivesJsonUtility(string camera)
        {
            var playback = JsonUtility.FromJson<AvatarPackagePlayback>("{\"kind\":\"performance\",\"motion\":\"show.vrma\",\"camera\":" + camera + "}");
            Assert.That(playback.HasCamera, Is.True);
            Assert.That(playback.camera.kind, Is.EqualTo("track").Or.EqualTo("presets"));
        }
    }
}
