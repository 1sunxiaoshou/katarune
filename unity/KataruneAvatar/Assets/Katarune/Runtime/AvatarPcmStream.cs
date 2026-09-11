using System;
using System.IO;
using System.IO.Pipes;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace Katarune.Avatar
{
    public sealed class AvatarPcmBuffer : IDisposable
    {
        private readonly object _gate = new object();
        private readonly float[] _samples;
        private readonly int _prebuffer;
        private int _head, _count;
        private long _consumed, _received;
        private bool _ended, _disposed, _buffering = true;
        public AvatarPcmBuffer(int sampleRate) { _samples = new float[sampleRate * 2]; _prebuffer = sampleRate * 3 / 10; }
        public long Consumed { get { lock (_gate) return _consumed; } }
        public long Received { get { lock (_gate) return _received; } }
        public bool Ended { get { lock (_gate) return _ended; } }
        public bool Drained { get { lock (_gate) return _ended && _count == 0; } }
        public bool Ready { get { lock (_gate) return _count >= _prebuffer || (_ended && _count > 0); } }

        public void Write(byte[] bytes)
        {
            if (bytes.Length % 2 != 0) throw new InvalidDataException("Incomplete PCM sample.");
            lock (_gate)
            {
                for (var i = 0; i < bytes.Length; i += 2)
                {
                    while (_count == _samples.Length && !_disposed) Monitor.Wait(_gate);
                    if (_disposed) throw new OperationCanceledException();
                    _samples[(_head + _count) % _samples.Length] = (short)(bytes[i] | bytes[i + 1] << 8) / 32768f;
                    _count++; _received++;
                }
            }
        }
        public void Read(float[] output)
        {
            Array.Clear(output, 0, output.Length);
            lock (_gate)
            {
                if (_disposed) return;
                if (_buffering && !_ended && _count < _prebuffer) return;
                _buffering = false;
                var amount = Math.Min(output.Length, _count);
                for (var i = 0; i < amount; i++) output[i] = _samples[(_head + i) % _samples.Length];
                _head = (_head + amount) % _samples.Length;
                _count -= amount; _consumed += amount;
                if (_count == 0 && !_ended) _buffering = true;
                Monitor.PulseAll(_gate);
            }
        }
        public void Complete() { lock (_gate) { _ended = true; Monitor.PulseAll(_gate); } }
        public void Dispose() { lock (_gate) { _disposed = true; _count = 0; Monitor.PulseAll(_gate); } }
    }

    public sealed class AvatarPcmStream : IDisposable
    {
        [Serializable] private sealed class Header { public int sampleRate; public int channels; public string encoding; public AvatarSpeechSegment[] segments; }
        private readonly NamedPipeClientStream _pipe;
        private volatile bool _disposed;
        public volatile AvatarPcmBuffer Buffer;
        public int SampleRate { get; private set; }
        public volatile string Error;
        public volatile AvatarSpeechSegment[] Segments;
        public AvatarPcmStream(string name)
        {
            if (!name.StartsWith("katarune-pcm-", StringComparison.Ordinal) || !Guid.TryParse(name.Substring(13), out _))
                throw new ArgumentException("Invalid speech pipe.");
            _pipe = new NamedPipeClientStream(".", name, PipeDirection.In, PipeOptions.Asynchronous);
            _ = Task.Run(Read);
        }
        private byte[] Exact(int length)
        {
            var bytes = new byte[length];
            var offset = 0;
            while (offset < length)
            {
                var count = _pipe.Read(bytes, offset, length - offset);
                if (count == 0) throw new EndOfStreamException();
                offset += count;
            }
            return bytes;
        }
        private void Read()
        {
            try
            {
                _pipe.Connect(15000);
                while (!_disposed)
                {
                    var length = BitConverter.ToInt32(Exact(4), 0);
                    if (length < 1 || length > 8 * 1024 * 1024 + 1) throw new InvalidDataException("Invalid audio frame size.");
                    var kind = Exact(1)[0];
                    var payload = Exact(length - 1);
                    if (kind == 1)
                    {
                        if (Buffer != null) throw new InvalidDataException("Repeated format.");
                        var header = JsonUtility.FromJson<Header>(System.Text.Encoding.UTF8.GetString(payload));
                        if (header.encoding != "pcm-s16le" || header.channels != 1 || header.sampleRate < 8000 || header.sampleRate > 48000)
                            throw new InvalidDataException("Unsupported PCM format.");
                        SampleRate = header.sampleRate;
                        Buffer = new AvatarPcmBuffer(SampleRate);
                    }
                    else if (Buffer == null) throw new InvalidDataException("Missing PCM format.");
                    else if (kind == 2) Buffer.Write(payload);
                    else if (kind == 3) Segments = JsonUtility.FromJson<Header>(System.Text.Encoding.UTF8.GetString(payload)).segments;
                    else if (kind == 4) { Buffer.Complete(); return; }
                    else throw new InvalidDataException("Speech stream failed.");
                }
            }
            catch (Exception) { if (!_disposed) Error = "Speech stream interrupted."; }
            finally { _pipe.Dispose(); }
        }
        public void Dispose() { _disposed = true; Buffer?.Dispose(); _pipe.Dispose(); }
    }
}
