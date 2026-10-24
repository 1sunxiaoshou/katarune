using System;
using System.Threading.Tasks;
using NUnit.Framework;

namespace Katarune.Avatar.Tests
{
    public class AvatarPcmStreamTests
    {
        [Test]
        public void UnderrunDoesNotAdvanceSpeechClockAndShortTailDrains()
        {
            using var buffer = new AvatarPcmBuffer(8000);
            buffer.Write(new byte[4800]);
            Assert.That(buffer.Ready, Is.False);
            var output = new float[4000];
            buffer.Read(output);
            Assert.That(buffer.Consumed, Is.Zero);
            buffer.Write(new byte[15200]);
            Assert.That(buffer.Ready, Is.True);
            buffer.Read(output);
            Assert.That(buffer.Consumed, Is.EqualTo(4000));
            buffer.Read(output);
            Assert.That(buffer.Consumed, Is.EqualTo(8000));
            buffer.Read(output);
            Assert.That(buffer.Consumed, Is.EqualTo(8000), "partial callback data must remain buffered");
            buffer.Write(new byte[20000]);
            buffer.Read(output);
            Assert.That(buffer.Consumed, Is.EqualTo(12000));
            buffer.Complete();
            buffer.Read(output);
            buffer.Read(output);
            Assert.That(buffer.Consumed, Is.EqualTo(20000));
            Assert.That(buffer.Drained, Is.True);
        }

        [Test]
        public void FullBufferBackpressuresProducerAndCancelUnblocksIt()
        {
            using var buffer = new AvatarPcmBuffer(8000);
            buffer.Write(new byte[buffer.CapacitySamples * 2]);
            var task = Task.Run(() => { try { buffer.Write(new byte[2]); return false; } catch (OperationCanceledException) { return true; } });
            Assert.That(task.Wait(30), Is.False);
            buffer.Dispose();
            Assert.That(task.Wait(1000), Is.True);
            Assert.That(task.Result, Is.True);
        }

        [Test]
        public void LateAlignmentControlsFutureBoundariesWithoutRewindingDisplayedPages()
        {
            var timeline = new AvatarSpeechSubtitles.StreamingTimeline("你好。再见。");
            Assert.That(timeline.TextAt(0, null, 0), Is.EqualTo("你好。"));
            Assert.That(timeline.TextAt(1.5f, null, 0), Is.EqualTo("你好。"));
            Assert.That(timeline.TextAt(1.5f, new[] {
                new AvatarSpeechSegment { text = "你好。", startSeconds = 0, endSeconds = 1 },
                new AvatarSpeechSegment { text = "再见。", startSeconds = 1, endSeconds = 3 },
            }, 0), Is.EqualTo("再见。"));
            var corrected = new[] {
                new AvatarSpeechSegment { text = "你好。", startSeconds = 0, endSeconds = 2 },
                new AvatarSpeechSegment { text = "再见。", startSeconds = 2, endSeconds = 3 },
            };
            Assert.That(timeline.TextAt(1.5f, corrected, 0), Is.EqualTo("再见。"));
            Assert.That(timeline.TextAt(2.1f, corrected, 0), Is.EqualTo("再见。"));
        }
        [Test]
        public void TimelyRefillAfterExactDepletionDoesNotRebuffer()
        {
            using var buffer = new AvatarPcmBuffer(8000);
            var output = new float[10000];
            buffer.Write(new byte[20000]); buffer.Read(output);
            Assert.That(buffer.Consumed, Is.EqualTo(10000));
            // A refill smaller than the startup/recovery threshold is sufficient
            // when it arrived before the next audio callback actually ran dry.
            buffer.Write(new byte[1600]); buffer.Read(new float[800]);
            Assert.That(buffer.Consumed, Is.EqualTo(10800));
            Assert.That(buffer.Underruns, Is.Zero);
        }

        [Test]
        public void RepeatedUnderrunsRaiseRecoveryMarginAndCompletedTailStillDrains()
        {
            using var buffer = new AvatarPcmBuffer(8000);
            var output = new float[10000];
            buffer.Write(new byte[20000]); buffer.Read(output); buffer.Read(output);
            Assert.That(buffer.Underruns, Is.EqualTo(1));
            buffer.Write(new byte[24000]); buffer.Read(new float[12000]);
            Assert.That(buffer.Consumed, Is.EqualTo(22000));
            buffer.Read(output); Assert.That(buffer.Underruns, Is.EqualTo(2));
            buffer.Write(new byte[24000]); buffer.Read(output);
            Assert.That(buffer.Consumed, Is.EqualTo(22000), "a second starvation needs more than the first recovery margin");
            buffer.Write(new byte[8000]); buffer.Read(output);
            Assert.That(buffer.Consumed, Is.EqualTo(32000));
            buffer.Complete(); buffer.Read(output);
            Assert.That(buffer.Drained, Is.True);
        }

        [Test]
        public void JitteryBurstsKeepPlayingContinuouslyAfterStartup()
        {
            using var buffer = new AvatarPcmBuffer(8000);
            var callback = new float[800]; // 100 ms of audio consumption
            var started = false;
            for (var tick = 0; tick < 45; tick++)
            {
                // A source faster than playback overall, but with occasional 1.3 s gaps.
                if (tick == 0 || tick == 13 || tick == 21 || tick == 31 || tick == 43) buffer.Write(new byte[16000]);
                if (!started && !buffer.Ready) continue;
                started = true;
                var consumed = buffer.Consumed;
                buffer.Read(callback);
                Assert.That(buffer.Consumed - consumed, Is.EqualTo(callback.Length), $"Playback underrun at tick {tick}");
            }
            Assert.That(started, Is.True);
        }
    }
}
