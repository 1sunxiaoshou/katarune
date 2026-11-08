using System;
using System.Threading;

namespace Katarune.Avatar
{
    // Single audio writer, single video reader. Callback arrival jitter is not
    // device drift: filter observations, then slew the continuous clock by at
    // most 0.5%. Neither thread waits for the other.
    internal sealed class AvatarLiveClock
    {
        private readonly double _frequency, _sampleRate;
        private int _sequence, _seen;
        private long _sample, _stamp, _observedStamp, _lastRead;
        private double _origin, _time;
        private bool _initialized;

        internal AvatarLiveClock(long frequency, int sampleRate)
        { _frequency=frequency; _sampleRate=sampleRate; }

        internal void Observe(long sample, long stamp)
        {
            Interlocked.Increment(ref _sequence);
            Interlocked.Exchange(ref _sample,sample);
            Interlocked.Exchange(ref _stamp,stamp);
            Interlocked.Increment(ref _sequence);
        }

        internal bool Stalled(long now) => Volatile.Read(ref _sequence)!=0 && (now-Interlocked.Read(ref _stamp))/_frequency>1;

        internal double Read(long now)
        {
            var sequence=Volatile.Read(ref _sequence);
            var sample=Interlocked.Read(ref _sample);
            var stamp=Interlocked.Read(ref _stamp);
            var consistent=sequence!=0 && (sequence&1)==0 && sequence==Volatile.Read(ref _sequence);
            if(consistent && sequence!=_seen) {
                var origin=stamp/_frequency-sample/_sampleRate;
                if(!_initialized) {
                    _origin=origin; _time=Math.Max(0,(now-stamp)/_frequency+sample/_sampleRate);
                    _lastRead=now; _initialized=true;
                } else {
                    var elapsed=Math.Max(0,(stamp-_observedStamp)/_frequency);
                    _origin+=(origin-_origin)*(1-Math.Exp(-elapsed));
                }
                _observedStamp=stamp; _seen=sequence;
            }
            if(!_initialized) return 0;
            var delta=Math.Max(0,(now-_lastRead)/_frequency);
            var predicted=_time+delta;
            var correction=(now/_frequency-_origin-predicted)*(1-Math.Exp(-delta/2));
            _time=predicted+Math.Max(-delta*.005,Math.Min(delta*.005,correction));
            _lastRead=Math.Max(now,_lastRead);
            return _time;
        }
    }
}
