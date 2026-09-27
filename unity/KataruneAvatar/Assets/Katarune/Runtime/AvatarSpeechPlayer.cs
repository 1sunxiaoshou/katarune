using System;
using System.Collections;
using System.Collections.Concurrent;
using System.IO;
using UnityEngine;
using UnityEngine.Networking;

namespace Katarune.Avatar
{
    public sealed class AvatarSpeechPlayer : MonoBehaviour
    {
        private AudioSource _source;
        private AvatarLipSync _lipSync;
        private UnityWebRequest _loading;
        private AudioClip _clip;
        private string _id;
        private Action<string, string, string> _notify;
        private IAvatarRuntimeFacade _runtime;
        private uLipSync.Profile _customProfile;
        private AvatarPcmStream _stream;
        private volatile bool _consumeStream;
        private bool _paused;
        private readonly float[] _outputSamples = new float[256];
        private readonly ConcurrentQueue<(long output, long audio, int count)> _streamSpans = new();
        private long _streamOutput, _streamPlayed, _streamPosition;
        private int _streamPreviousSample;
        public bool IsStreaming => _stream != null;
        public bool IsPaused => _paused;
        public float OutputLevel()
        {
            if (_source == null || !_source.isPlaying || _paused) return 0f;
            _source.GetOutputData(_outputSamples, 0);
            var power = 0f;
            foreach (var sample in _outputSamples) power += sample * sample;
            return Mathf.Clamp01(Mathf.Sqrt(power / _outputSamples.Length) * 5f);
        }
        public AvatarSpeechSegment[] StreamSegments => _stream?.Segments;
        public string PlaybackId => _id;
        public float PositionSeconds => _stream != null ? StreamPosition()
            : _clip == null ? 0f : (float)_source.timeSamples / _clip.frequency;
        public float DurationSeconds => _stream != null ? (_stream.Buffer?.Ended == true ? (float)_stream.Buffer.Received / _stream.SampleRate : 0)
            : _clip == null ? 0f : (float)_clip.samples / _clip.frequency;

        public void Configure(IAvatarRuntimeFacade runtime)
        {
            _runtime = runtime;
            _source = gameObject.AddComponent<AudioSource>();
            _source.playOnAwake = false;
            _source.spatialBlend = 0f;
            _source.loop = false;
            _lipSync = gameObject.AddComponent<AvatarLipSync>();
            var profile = Resources.Load<uLipSync.Profile>("AvatarLipSyncProfile");
            if (profile == null) throw new InvalidOperationException("Avatar lip sync profile is missing.");
            _lipSync.Configure(runtime, profile);
            runtime.Changed += OnRuntimeChanged;
        }

        public void Play(string id, string path, Action<string, string, string> notify, string profilePath = null, bool streaming = false)
        {
            Stop();
            if (_customProfile != null) Destroy(_customProfile);
            _customProfile = null;
            var profile = Resources.Load<uLipSync.Profile>("AvatarLipSyncProfile");
            if (!string.IsNullOrEmpty(profilePath) && File.Exists(profilePath))
            {
                var candidate = uLipSync.Profile.Create();
                try {
                    if (candidate.Import(profilePath)) { _customProfile = candidate; profile = candidate; }
                } catch (Exception) { Debug.LogWarning("Unable to load speech profile; using default example."); }
                if (_customProfile == null) Destroy(candidate);
            }
            Debug.Log("KATARUNE_LIPSYNC_PROFILE source=" + (_customProfile == null ? "default-example" : "voice-calibration"));
            _lipSync.Configure(_runtime, profile);
            if (!streaming && (!Path.IsPathFullyQualified(path) || !File.Exists(path)))
                throw new ArgumentException("Speech audio file is missing.");
            _id = id;
            _notify = notify;
            StartCoroutine(streaming ? PlayStream(path) : PlayFile(path));
        }

        private IEnumerator PlayStream(string name)
        {
            _stream = new AvatarPcmStream(name);
            while (_stream.Error == null && _stream.Buffer?.Ready != true)
            {
                if (_stream.Buffer?.Drained == true) { Finish("failed", "Empty speech stream."); yield break; }
                yield return null;
            }
            if (_stream.Error != null) { Finish("failed", _stream.Error); yield break; }
            var buffer = _stream.Buffer;
            _consumeStream = true;
            _clip = AudioClip.Create("Dialogue stream", _stream.SampleRate, 1, _stream.SampleRate, true,
                data => {
                    if (!_consumeStream) { Array.Clear(data, 0, data.Length); return; }
                    var before = buffer.Consumed;
                    buffer.Read(data);
                    var count = (int)(buffer.Consumed - before);
                    if (count > 0) _streamSpans.Enqueue((_streamOutput, before, count));
                    _streamOutput += data.Length;
                });
            _source.clip = _clip;
            _source.loop = true;
            _lipSync.Begin();
            _source.Play();
            _notify?.Invoke(_id, "started", null);
            while (_stream.Error == null)
            {
                if (!_paused) StreamPosition();
                if (!_paused && buffer.Drained && _streamPosition >= buffer.Received) break;
                yield return null;
            }
            if (_stream.Error != null) { Finish("failed", _stream.Error); yield break; }
            AudioSettings.GetDSPBufferSize(out var length, out var count);
            yield return new WaitForSecondsRealtime((float)(length * count) / AudioSettings.outputSampleRate + .05f);
            while (_paused) yield return null;
            Finish("completed", null);
        }

        // PCMReaderCallback prefetches. Map the AudioSource cursor through the queued
        // audio spans so prefetched samples and inserted silence cannot advance subtitles.
        private float StreamPosition()
        {
            if (_stream?.Buffer == null || _clip == null) return 0;
            var sample = _source.timeSamples;
            _streamPlayed += (sample - _streamPreviousSample + _clip.samples) % _clip.samples;
            _streamPreviousSample = sample;
            while (_streamSpans.TryPeek(out var span) && _streamPlayed >= span.output)
            {
                _streamPosition = span.audio + Math.Min(span.count, _streamPlayed - span.output);
                if (_streamPlayed < span.output + span.count) break;
                _streamSpans.TryDequeue(out _);
            }
            return (float)_streamPosition / _stream.SampleRate;
        }

        private IEnumerator PlayFile(string path)
        {
            var type = Path.GetExtension(path).ToLowerInvariant() switch
            {
                ".wav" => AudioType.WAV,
                ".mp3" => AudioType.MPEG,
                ".ogg" => AudioType.OGGVORBIS,
                _ => AudioType.UNKNOWN,
            };
            if (type == AudioType.UNKNOWN) { Finish("failed", "Unsupported speech audio format."); yield break; }
            _loading = UnityWebRequestMultimedia.GetAudioClip(new Uri(path).AbsoluteUri, type);
            _loading.timeout = 30;
            yield return _loading.SendWebRequest();
            if (_loading.result != UnityWebRequest.Result.Success)
            { Finish("failed", "Unable to decode speech audio."); yield break; }
            _clip = DownloadHandlerAudioClip.GetContent(_loading);
            _loading.Dispose(); _loading = null;
            if (_clip == null || _clip.samples <= 0) { Finish("failed", "Speech audio is empty."); yield break; }
            _source.clip = _clip;
            _lipSync.Begin();
            _source.Play();
            _notify?.Invoke(_id, "started", null);
            while (_source.isPlaying || _paused) yield return null;
            Finish("completed", null);
        }

        public void Pause()
        {
            if (_id == null || _paused || _source == null) return;
            _paused = true;
            _source.Pause();
            _lipSync?.End();
        }

        public void Resume()
        {
            if (_id == null || !_paused || _source == null) return;
            _paused = false;
            _lipSync?.Begin();
            _source.UnPause();
        }

        private void OnRuntimeChanged(AvatarRuntimeSnapshot snapshot)
        {
            if (snapshot.RuntimeState != AvatarRuntimeState.Ready) Stop();
        }

        public void Stop(string id = null)
        {
            if (id != null && id != _id) return;
            StopAllCoroutines();
            Finish("cancelled", null);
        }

        private void Finish(string status, string error)
        {
            _paused = false;
            _consumeStream = false;
            _stream?.Dispose(); _stream = null;
            _loading?.Abort(); _loading?.Dispose(); _loading = null;
            if (_source != null) { _source.Stop(); _source.clip = null; _source.loop = false; }
            _streamSpans.Clear();
            _streamOutput = _streamPlayed = _streamPosition = 0;
            _streamPreviousSample = 0;
            if (_clip != null) Destroy(_clip);
            _clip = null;
            _lipSync?.End();
            var id = _id; var notify = _notify;
            _id = null; _notify = null;
            if (id != null) notify?.Invoke(id, status, error);
        }

        public void Release()
        {
            Stop();
            if (_runtime != null) _runtime.Changed -= OnRuntimeChanged;
            _lipSync?.Release();
            _runtime = null;
            if (_customProfile != null) Destroy(_customProfile);
            _customProfile = null;
        }

        private void OnDestroy() => Release();
    }
}
