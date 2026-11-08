using System;
using NUnit.Framework;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarLiveClockTests
    {
        private const long Frequency=10000000;
        private static long Ticks(double seconds) => (long)Math.Round(seconds*Frequency);

        [TestCase(0)]
        [TestCase(0.001)]
        [TestCase(-0.001)]
        public void JitterAndDeviceDriftStayContinuousForThirtyMinutes(double drift)
        {
            var clock=new AvatarLiveClock(Frequency,48000);
            var random=new Random(71);
            var next=0d; var block=0L; var previous=0d; var lastObservation=0d;
            var maxError=0d; var maxCorrection=0d;
            for(var frame=0;frame<60*1800;frame++) {
                var now=frame/60d;
                while(next<=now) {
                    clock.Observe(block*1024,Ticks(next));
                    lastObservation=next; block++;
                    // Some blocks arrive together; arrivals remain ordered.
                    next=Math.Max(lastObservation,block*1024/(48000*(1+drift))+(random.NextDouble()-.5)*.020);
                }
                var time=clock.Read(Ticks(now));
                Assert.That(time,Is.GreaterThanOrEqualTo(previous));
                if(frame>1) maxCorrection=Math.Max(maxCorrection,Math.Abs(time-previous-1d/60));
                if(now>10) maxError=Math.Max(maxError,Math.Abs(time-now*(1+drift)));
                previous=time;
            }
            Assert.That(maxCorrection,Is.LessThanOrEqualTo(.000084));
            Assert.That(maxError,Is.LessThan(.010));
        }

        [Test]
        public void MissingAudioIsDetectedAndANewSessionHasItsOwnOrigin()
        {
            var clock=new AvatarLiveClock(Frequency,48000);
            Assert.That(clock.Read(Ticks(100)),Is.Zero);
            clock.Observe(0,Ticks(100));
            Assert.That(clock.Read(Ticks(100)),Is.Zero);
            Assert.That(clock.Stalled(Ticks(100.5)),Is.False);
            Assert.That(clock.Stalled(Ticks(101.1)),Is.True);
            var restarted=new AvatarLiveClock(Frequency,48000);
            restarted.Observe(0,Ticks(200));
            Assert.That(restarted.Read(Ticks(200)),Is.Zero);
            Assert.That(restarted.Stalled(Ticks(200)),Is.False);
        }

        [Test]
        public void ADelayedVideoReaderKeepsTheAudioTimeline()
        {
            var clock=new AvatarLiveClock(Frequency,48000);
            clock.Observe(0,0); clock.Read(0);
            clock.Observe(48000,Ticks(1));
            Assert.That(clock.Stalled(Ticks(1.01)),Is.False);
            Assert.That(clock.Read(Ticks(1.01)),Is.EqualTo(1.01).Within(.00001));
            Assert.That(clock.Read(Ticks(1.01)),Is.EqualTo(1.01).Within(.00001));
        }
    }
}
