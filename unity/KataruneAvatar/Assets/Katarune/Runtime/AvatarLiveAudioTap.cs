using System;
using System.IO;
using System.Text;
using System.Threading;
using UnityEngine;

namespace Katarune.Avatar
{
    // Copy the program mix, then mute Unity's live monitor. The preview player
    // owns local monitoring so it hears the same timeline as its displayed video.
    // The audio thread never allocates, encodes, waits for I/O, or logs.
    [RequireComponent(typeof(AudioListener))]
    internal sealed class AvatarLiveAudioTap : MonoBehaviour
    {
        private const int Capacity = 256, MaxSamples = 16384;
        private readonly byte[][] _blocks = new byte[Capacity][];
        private readonly int[] _lengths = new int[Capacity];
        private int _write, _read, _channels, _sampleRate;
        private long _samples;
        private long _clockOrigin;
        private volatile bool _active;
        internal volatile bool Overflow;
        internal volatile bool FormatChanged;
        internal bool Acceptance;
        internal volatile bool Pulse;
        internal long Samples => Interlocked.Read(ref _samples);
        internal int SampleRate => _sampleRate;
        // Samples is the END of the last mixed block, not a continuous frame clock.
        // Unity's DSP time is also block-quantized on this Windows backend. Use
        // the monotonic counter to interpolate within the current audio block.
        // Refresh its origin from the sample position every callback, preventing
        // long-running drift between the audio device and the system clock.
        internal double TimeSeconds => Math.Max(0,(System.Diagnostics.Stopwatch.GetTimestamp()-Interlocked.Read(ref _clockOrigin))/(double)System.Diagnostics.Stopwatch.Frequency);
        internal void Begin()
        {
            _sampleRate = AudioSettings.outputSampleRate;
            for (var index=0; index<Capacity; index++) _blocks[index] = new byte[MaxSamples * 4];
            _write=0; _read=0; _samples=0; _clockOrigin=System.Diagnostics.Stopwatch.GetTimestamp(); Overflow=false; _active=true;
        }
        internal void End() { _active=false; }
        private void OnAudioFilterRead(float[] data, int channels)
        {
            if (!_active) return;
            Interlocked.Exchange(ref _clockOrigin,System.Diagnostics.Stopwatch.GetTimestamp()-(long)(_samples*(double)System.Diagnostics.Stopwatch.Frequency/_sampleRate));
            if(_channels!=0 && _channels!=channels) { FormatChanged=true; return; }
            if (Acceptance) {
                var pulse=false;
                for(var sample=0;sample<data.Length;sample++) if(Math.Abs(data[sample])>.05f) { pulse=true; break; }
                Pulse=pulse;
            }
            var index=_write % Capacity;
            if (data.Length > MaxSamples || _write - Volatile.Read(ref _read) >= Capacity) Overflow=true;
            else {
                _channels=channels;
                Buffer.BlockCopy(data,0,_blocks[index],0,data.Length*4); _lengths[index]=data.Length*4;
                Interlocked.Add(ref _samples,data.Length/channels);
                Volatile.Write(ref _write,_write+1);
            }
            Array.Clear(data,0,data.Length);
        }
        internal void WriteTo(Stream stream, CancellationToken cancellation)
        {
            while (_active && Volatile.Read(ref _write)==0) { cancellation.ThrowIfCancellationRequested(); Thread.Sleep(2); }
            if (!_active) return;
            using var writer=new BinaryWriter(stream,Encoding.UTF8,true);
            writer.Write(Encoding.ASCII.GetBytes("RIFF")); writer.Write(uint.MaxValue);
            writer.Write(Encoding.ASCII.GetBytes("WAVEfmt ")); writer.Write(16u); writer.Write((ushort)3);
            writer.Write((ushort)_channels); writer.Write((uint)_sampleRate); writer.Write((uint)(_sampleRate*_channels*4));
            writer.Write((ushort)(_channels*4)); writer.Write((ushort)32);
            writer.Write(Encoding.ASCII.GetBytes("data")); writer.Write(uint.MaxValue); writer.Flush();
            while (_active && !cancellation.IsCancellationRequested) {
                if (Volatile.Read(ref _write)==_read) { Thread.Sleep(2); continue; }
                var index=_read % Capacity;
                stream.Write(_blocks[index],0,_lengths[index]); Volatile.Write(ref _read,_read+1);
            }
        }
        private void OnDestroy() => End();
    }
}
