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
            Assert.That(buffer.Ready, Is.True);
            var output = new float[4000];
            buffer.Read(output);
            Assert.That(buffer.Consumed, Is.EqualTo(2400));
            buffer.Read(output);
            Assert.That(buffer.Consumed, Is.EqualTo(2400));
            buffer.Write(new byte[2000]);
            buffer.Read(output);
            Assert.That(buffer.Consumed, Is.EqualTo(2400));
            buffer.Complete();
            buffer.Read(output);
            Assert.That(buffer.Consumed, Is.EqualTo(3400));
            Assert.That(buffer.Drained, Is.True);
        }

        [Test]
        public void FullBufferBackpressuresProducerAndCancelUnblocksIt()
        {
            using var buffer = new AvatarPcmBuffer(8000);
            buffer.Write(new byte[32000]);
            var task = Task.Run(() => { try { buffer.Write(new byte[2]); return false; } catch (OperationCanceledException) { return true; } });
            Assert.That(task.Wait(30), Is.False);
            buffer.Dispose();
            Assert.That(task.Wait(1000), Is.True);
            Assert.That(task.Result, Is.True);
        }

        [Test]
        public void LateAlignmentDoesNotRewindDisplayedSubtitle()
        {
            var timeline = new AvatarSpeechSubtitles.StreamingTimeline("你好。再见。");
            Assert.That(timeline.TextAt(0, null, 0), Is.EqualTo("你好。"));
            Assert.That(timeline.TextAt(1.5f, null, 0), Is.EqualTo("再见。"));
            Assert.That(timeline.TextAt(1.5f, new[] {
                new AvatarSpeechSegment { text = "你好。", startSeconds = 0, endSeconds = 2 },
                new AvatarSpeechSegment { text = "再见。", startSeconds = 2, endSeconds = 3 },
            }, 3), Is.EqualTo("再见。"));
        }
    }
}
