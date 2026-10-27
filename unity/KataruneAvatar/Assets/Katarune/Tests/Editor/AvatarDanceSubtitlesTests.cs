using System;
using System.IO;
using System.Text;
using NUnit.Framework;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarDanceSubtitlesTests
    {
        private const string First = "1\n00:00:00,100 --> 00:00:00,300\n第一行\n第二行";

        [Test] public void UsesExclusiveEndsAndClearsGapsEvenWhenSeekingBackwards()
        {
            var timeline = AvatarDanceSubtitles.Parse("\uFEFF" + First.Replace("\n", "\r\n")
                + "\r\n\r\n3\r\n00:00:00,500 --> 00:00:01,000\r\n下一句\r\n");
            Assert.That(timeline.Count, Is.EqualTo(2));
            Assert.That(timeline.TextAt(.099f), Is.Empty);
            Assert.That(timeline.TextAt(.1f), Is.EqualTo("第一行\n第二行"));
            Assert.That(timeline.TextAt(.3f), Is.Empty);
            Assert.That(timeline.TextAt(.5f), Is.EqualTo("下一句"));
            Assert.That(timeline.TextAt(1f), Is.Empty);
            Assert.That(timeline.TextAt(.2f), Is.EqualTo("第一行\n第二行"));
            Assert.That(timeline.TextAt(float.NaN), Is.Empty);
            Assert.That(timeline.TextAt(float.PositiveInfinity), Is.Empty);
        }

        [TestCase("2\n00:00:00,000 --> 00:00:01,000\ntext")]
        [TestCase("2147483648\n00:00:00,000 --> 00:00:01,000\ntext")]
        [TestCase("1\n00:00:00,300 --> 00:00:00,100\ntext")]
        [TestCase("1\n00:01:60,000 --> 00:02:01,000\ntext")]
        [TestCase("1\n00:59:59,000 --> 01:00:00,001\ntext")]
        [TestCase("1\n00:00:00,000 --> 00:00:01,000\n\n")]
        [TestCase("1\n00:00:00,000 --> 00:00:01,000\ntext\ttext")]
        [TestCase("1\n00:00:00,000 --> 00:00:01,000\ntext\0text")]
        public void RejectsMalformedOrUnboundedCues(string source)
            => Assert.Throws<InvalidDataException>(() => AvatarDanceSubtitles.Parse(source));

        [Test] public void RejectsOverlapAndRepeatedIndices()
        {
            Assert.Throws<InvalidDataException>(() => AvatarDanceSubtitles.Parse(First
                + "\n\n2\n00:00:00,200 --> 00:00:00,400\noverlap"));
            Assert.Throws<InvalidDataException>(() => AvatarDanceSubtitles.Parse(First
                + "\n\n1\n00:00:00,500 --> 00:00:00,700\nrepeated"));
        }

        [Test] public void CountsUnicodeCodePointsAndKeepsMarkupAsLiteralText()
        {
            var emoji = string.Concat(System.Linq.Enumerable.Repeat("🙂", 1000));
            var prefix = "1\n00:00:00,000 --> 00:00:01,000\n";
            Assert.That(AvatarDanceSubtitles.Parse(prefix + emoji).TextAt(0f), Is.EqualTo(emoji));
            Assert.Throws<InvalidDataException>(() => AvatarDanceSubtitles.Parse(prefix + emoji + "a"));
            Assert.That(AvatarDanceSubtitles.Parse(prefix + "<color=red>literal</color>").TextAt(0f), Is.EqualTo("<color=red>literal</color>"));
            Assert.Throws<InvalidDataException>(() => AvatarDanceSubtitles.Parse(new string(' ', AvatarDanceSubtitles.MaxBytes + 1)));
        }

        [Test] public void ValidatesTheRealMotionDuration()
        {
            var timeline = AvatarDanceSubtitles.Parse("1\n00:00:00,000 --> 00:00:01,000\ntext");
            Assert.DoesNotThrow(() => timeline.ValidateDuration(1f));
            Assert.Throws<InvalidDataException>(() => timeline.ValidateDuration(.9f));
        }

        [Test] public void InvalidEncodingAndMissingFilesGiveReadableErrorsWithoutPaths()
        {
            var path = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
            try
            {
                var missing = Assert.Throws<InvalidDataException>(() => AvatarDanceSubtitles.Read(path));
                Assert.That(missing.Message, Does.Not.Contain(path)); Assert.That(missing.InnerException, Is.Null);
                File.WriteAllBytes(path, new byte[] { 0xC0, 0xAF });
                Assert.Throws<InvalidDataException>(() => AvatarDanceSubtitles.Read(path));
                File.WriteAllText(path, First, new UTF8Encoding(true));
                Assert.That(AvatarDanceSubtitles.Read(path).TextAt(.1f), Is.EqualTo("第一行\n第二行"));
            }
            finally { if (File.Exists(path)) File.Delete(path); }
        }
    }
}
