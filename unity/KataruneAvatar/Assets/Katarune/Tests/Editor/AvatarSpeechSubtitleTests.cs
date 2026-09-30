using NUnit.Framework;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarSpeechSubtitleTests
    {
        [Test]
        public void SentencePagesUseWordTimesAndHoldAcrossShortPauses()
        {
            var timeline = new AvatarSpeechSubtitles.Timeline("你好！下一句。", new[] {
                new AvatarSpeechSegment { text = "你", startSeconds = .2f, endSeconds = .4f },
                new AvatarSpeechSegment { text = "好！", startSeconds = .4f, endSeconds = 1f },
                new AvatarSpeechSegment { text = "下一句。", startSeconds = 1.5f, endSeconds = 2f },
            }, 2.1f);
            Assert.That(timeline.TextAt(.1f), Is.Empty);
            Assert.That(timeline.TextAt(.2f), Is.EqualTo("你好！"));
            Assert.That(timeline.TextAt(1.2f), Is.EqualTo("你好！"));
            Assert.That(timeline.TextAt(1.5f), Is.EqualTo("下一句。"));
            Assert.That(timeline.TextAt(2f), Is.Empty);
        }

        [Test]
        public void LongSilenceIsEmptyAndWhitespaceDoesNotShiftBoundaries()
        {
            var timeline = new AvatarSpeechSubtitles.Timeline("Hello!  Next.", new[] {
                new AvatarSpeechSegment { text = "Hello!  ", startSeconds = 0, endSeconds = 1 },
                new AvatarSpeechSegment { text = "Next.", startSeconds = 2, endSeconds = 3 },
            }, 3);
            Assert.That(timeline.TextAt(.99f), Is.EqualTo("Hello!"));
            Assert.That(timeline.TextAt(1.5f), Is.Empty);
            Assert.That(timeline.TextAt(2), Is.EqualTo("Next."));
        }

        [TestCase(float.NaN)]
        [TestCase(9f)]
        [TestCase(-1f)]
        public void InvalidAlignmentStillUsesSameSentencePages(float end)
        {
            var timeline = new AvatarSpeechSubtitles.Timeline("你好。再见。", new[] {
                new AvatarSpeechSegment { text = "normalized", startSeconds = 0, endSeconds = end },
            }, 2f);
            Assert.That(timeline.TextAt(.5f), Is.EqualTo("你好。"));
            Assert.That(timeline.TextAt(1f), Is.EqualTo("再见。"));
        }

        [Test]
        public void CoarseAlignmentStillSplitsSentences()
        {
            var timeline = new AvatarSpeechSubtitles.Timeline("你好。再见。", new[] {
                new AvatarSpeechSegment { text = "你好。再见。", startSeconds = 0, endSeconds = 2 },
            }, 2f);
            Assert.That(timeline.TextAt(.5f), Is.EqualTo("你好。"));
            Assert.That(timeline.TextAt(1f), Is.EqualTo("再见。"));
        }
        [Test]
        public void VoiceAndSilentPagesAgreeForLongSentences()
        {
            var text = new string('甲', 20) + "，" + new string('乙', 20) + "。结束！";
            var segments = new AvatarSpeechSegment[text.Length];
            for (var i = 0; i < text.Length; i++)
                segments[i] = new AvatarSpeechSegment { text = text[i].ToString(), startSeconds = i, endSeconds = i + 1 };
            var voiced = new AvatarSpeechSubtitles.Timeline(text, segments, text.Length);
            var untimed = new AvatarSpeechSubtitles.Timeline(text, null, text.Length);
            var offset = 0;
            while (offset < text.Length)
            {
                var page = AvatarSpeechSubtitles.ReadPage(text.Substring(offset), true, out var consumed, out _);
                Assert.That(voiced.TextAt(offset + .1f), Is.EqualTo(page));
                Assert.That(untimed.TextAt(offset + .1f), Is.EqualTo(page));
                offset += consumed;
            }
        }    }
}
