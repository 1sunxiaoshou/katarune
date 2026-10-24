using NUnit.Framework;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarSpeechSubtitleTests
    {
        [Test]
        public void PagesShowOnlyBetweenTheirStartAndEndTimes()
        {
            var timeline = new AvatarSpeechSubtitles.Timeline("你好！下一句。", new[] {
                new AvatarSpeechSegment { text = "你", startSeconds = .2f, endSeconds = .4f },
                new AvatarSpeechSegment { text = "好！", startSeconds = .4f, endSeconds = 1f },
                new AvatarSpeechSegment { text = "下一句。", startSeconds = 1.5f, endSeconds = 2f },
            }, 2.1f);
            Assert.That(timeline.TextAt(.1f), Is.Empty);
            Assert.That(timeline.TextAt(.2f), Is.EqualTo("你好！"));
            Assert.That(timeline.TextAt(1.2f), Is.Empty);
            Assert.That(timeline.TextAt(1.5f), Is.EqualTo("下一句。"));
            Assert.That(timeline.TextAt(2f), Is.Empty);
            Assert.That(timeline.TextAt(2.1f), Is.Empty);
        }

        [Test]
        public void PagesClearDuringPausesAndWhitespaceDoesNotShiftBoundaries()
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
        }

        [Test]
        public void LongStreamingSentenceDoesNotRewindWhenAlignmentIsDiscardedAtStreamEnd()
        {
            var first = new string('甲', 20) + "，";
            var last = new string('乙', 20) + "。";
            var timeline = new AvatarSpeechSubtitles.StreamingTimeline(first + last);
            var segments = new[] {
                new AvatarSpeechSegment { text = first, startSeconds = 0, endSeconds = 1 },
                new AvatarSpeechSegment { text = last, startSeconds = 1, endSeconds = 8 },
            };
            Assert.That(timeline.TextAt(.5f, segments, 0), Is.EqualTo(first));
            Assert.That(timeline.TextAt(1.5f, segments, 0), Is.EqualTo(last));
            // Final validation can discard timestamps before the remaining PCM has played.
            Assert.That(timeline.TextAt(2, System.Array.Empty<AvatarSpeechSegment>(), 0), Is.EqualTo(last));
            Assert.That(timeline.TextAt(2, null, 10), Is.EqualTo(last));
            Assert.That(timeline.TextAt(9.9f, null, 10), Is.EqualTo(last));
            Assert.That(timeline.TextAt(10, null, 10), Is.Empty);
        }

        [Test]
        public void StreamingPagesClearAtTheirEndsWithoutReturningToEarlierPages()
        {
            var timeline = new AvatarSpeechSubtitles.StreamingTimeline("第一句。第二句。最后一句。");
            var segments = new[] {
                new AvatarSpeechSegment { text = "第一句。", startSeconds = 0, endSeconds = 1 },
                new AvatarSpeechSegment { text = "第二句。", startSeconds = 3, endSeconds = 4 },
                new AvatarSpeechSegment { text = "最后一句。", startSeconds = 6, endSeconds = 6.2f },
            };
            Assert.That(timeline.TextAt(.5f, segments, 0), Is.EqualTo("第一句。"));
            Assert.That(timeline.TextAt(1.5f, segments, 0), Is.Empty);
            Assert.That(timeline.TextAt(3, segments, 0), Is.EqualTo("第二句。"));
            Assert.That(timeline.TextAt(5, segments, 8), Is.Empty);
            Assert.That(timeline.TextAt(6.1f, segments, 8), Is.EqualTo("最后一句。"));
            Assert.That(timeline.TextAt(6.5f, segments, 8), Is.Empty);
            Assert.That(timeline.TextAt(8, segments, 8), Is.Empty);
        }

        [Test]
        public void EndedPagesStayClearedWhenAlignmentChangesOrDisappears()
        {
            var timeline = new AvatarSpeechSubtitles.StreamingTimeline("第一句。第二句。");
            var segments = new[] {
                new AvatarSpeechSegment { text = "第一句。", startSeconds = 0, endSeconds = 1 },
                new AvatarSpeechSegment { text = "第二句。", startSeconds = 3, endSeconds = 4 },
            };
            Assert.That(timeline.TextAt(.5f, segments, 0), Is.EqualTo("第一句。"));
            Assert.That(timeline.TextAt(1.1f, segments, 0), Is.Empty);
            var revised = new[] {
                new AvatarSpeechSegment { text = "第一句。", startSeconds = 0, endSeconds = 2.5f },
                segments[1],
            };
            Assert.That(timeline.TextAt(1.2f, revised, 0), Is.Empty);
            Assert.That(timeline.TextAt(1.3f, null, 5), Is.Empty);
            Assert.That(timeline.TextAt(3.1f, revised, 5), Is.EqualTo("第二句。"));
        }

        [Test]
        public void ZeroDurationSegmentsDoNotDiscardOtherTextInThePage()
        {
            var timeline = new AvatarSpeechSubtitles.Timeline("你好。再见。", new[] {
                new AvatarSpeechSegment { text = "你", startSeconds = 0, endSeconds = 0 },
                new AvatarSpeechSegment { text = "好。", startSeconds = .4f, endSeconds = 1 },
                new AvatarSpeechSegment { text = "再", startSeconds = 1.5f, endSeconds = 1.5f },
                new AvatarSpeechSegment { text = "见。", startSeconds = 1.8f, endSeconds = 2 },
            }, 3);
            Assert.That(timeline.TextAt(0), Is.EqualTo("你好。"));
            Assert.That(timeline.TextAt(.9f), Is.EqualTo("你好。"));
            Assert.That(timeline.TextAt(1), Is.Empty);
            Assert.That(timeline.TextAt(1.5f), Is.EqualTo("再见。"));
            Assert.That(timeline.TextAt(2), Is.Empty);
        }

        [Test]
        public void RevisedStreamingAlignmentStillDelaysPagesThatHaveNotBeenDisplayed()
        {
            var timeline = new AvatarSpeechSubtitles.StreamingTimeline("第一句。第二句。第三句。");
            var segments = new[] {
                new AvatarSpeechSegment { text = "第一句。", startSeconds = 0, endSeconds = 1 },
                new AvatarSpeechSegment { text = "第二句。", startSeconds = 1, endSeconds = 2 },
                new AvatarSpeechSegment { text = "第三句。", startSeconds = 2, endSeconds = 3 },
            };
            Assert.That(timeline.TextAt(1.2f, segments, 0), Is.EqualTo("第二句。"));
            var revised = new[] {
                new AvatarSpeechSegment { text = "第一句。", startSeconds = 0, endSeconds = 2 },
                new AvatarSpeechSegment { text = "第二句。", startSeconds = 2, endSeconds = 4 },
                new AvatarSpeechSegment { text = "第三句。", startSeconds = 4, endSeconds = 6 },
            };
            Assert.That(timeline.TextAt(1.2f, revised, 0), Is.EqualTo("第二句。"));
            Assert.That(timeline.TextAt(3, revised, 0), Is.EqualTo("第二句。"));
            Assert.That(timeline.TextAt(4, revised, 0), Is.EqualTo("第三句。"));
        }
    }
}
