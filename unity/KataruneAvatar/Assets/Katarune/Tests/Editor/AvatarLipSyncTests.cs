using System.Collections.Generic;
using NUnit.Framework;
using uLipSync;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarLipSyncTests
    {
        [Test]
        public void ClearingSpeechInputClosesImmediatelyWithoutResettingAffect()
        {
            var model = new AvatarBehaviorModel();
            model.SetAffect(AvatarAffectPreset.Happy, .5f);
            model.SetManualVisemes(new AvatarVisemeWeights(1, 0, 0, 0, 0));
            model.Tick(.1f, UnityEngine.Vector2.zero);
            Assert.That(model.CurrentFrame.Aa, Is.GreaterThan(0));
            model.SetManualVisemes(default(AvatarVisemeWeights), immediate: true);
            Assert.That(model.CurrentFrame.Aa, Is.Zero);
            Assert.That(model.Affect, Is.EqualTo(AvatarAffectPreset.Happy));
        }
        [Test]
        public void MapsFiveVowelsAndPreservesNoiseShare()
        {
            var result = AvatarLipSync.Map(new LipSyncInfo {
                rawVolume = 1f,
                phonemeRatios = new Dictionary<string, float> {
                    ["A"] = .1f, ["I"] = .2f, ["U"] = .15f,
                    ["E"] = .05f, ["O"] = .1f, ["-"] = .4f,
                },
            });
            Assert.That(result.Aa, Is.EqualTo(.1f));
            Assert.That(result.Ih, Is.EqualTo(.2f));
            Assert.That(result.Ou, Is.EqualTo(.15f));
            Assert.That(result.Ee, Is.EqualTo(.05f));
            Assert.That(result.Oh, Is.EqualTo(.1f));
        }

        [TestCase(0f)]
        [TestCase(.00001f)]
        [TestCase(float.NaN)]
        [TestCase(float.PositiveInfinity)]
        public void SilenceAndInvalidVolumeCloseMouth(float volume)
        {
            Assert.That(AvatarLipSync.Map(new LipSyncInfo {
                rawVolume = volume, phonemeRatios = new Dictionary<string, float> { ["A"] = 1f },
            }).Aa, Is.Zero);
        }

        [Test]
        public void InvalidRatiosCannotPoisonPose()
        {
            var result = AvatarLipSync.Map(new LipSyncInfo {
                rawVolume = 1f,
                phonemeRatios = new Dictionary<string, float> { ["A"] = float.NaN, ["I"] = -1f, ["U"] = 10f, ["O"] = 10f },
            });
            Assert.That(result.Aa, Is.Zero);
            Assert.That(result.Ih, Is.Zero);
            Assert.That(result.Ou + result.Oh, Is.EqualTo(1f));
        }
    }
}
