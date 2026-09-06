using NUnit.Framework;
using UnityEngine;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarLightingProfileTests
    {
        [Test]
        public void ProfileUsesTheDefaultAvatarLighting()
        {
            var profile = ScriptableObject.CreateInstance<AvatarLightingProfile>();

            Assert.That(profile.DefaultLighting.KeyIntensity, Is.EqualTo(0.9f));
            Assert.That(profile.DefaultLighting.KeyColor, Is.EqualTo(new Color(1f, 0.97f, 0.94f)));
            Assert.That(profile.DefaultLighting.AmbientColor, Is.EqualTo(new Color(0.34f, 0.36f, 0.4f)));

            Object.DestroyImmediate(profile);
        }

        [Test]
        public void DefaultLightingProfileIsAvailableFromResources()
        {
            var profile = Resources.Load<AvatarLightingProfile>("AvatarLightingProfile");

            Assert.That(profile, Is.Not.Null);
        }
    }
}
