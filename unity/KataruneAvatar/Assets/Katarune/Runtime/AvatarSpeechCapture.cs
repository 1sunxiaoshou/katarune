using System;
using System.Collections;
using System.Collections.Concurrent;
using System.IO;
using System.Linq;
using UnityEngine;

namespace Katarune.Avatar
{
    // Opt-in local acceptance capture. Records only this AudioSource and this Player's frames.
    public sealed class AvatarSpeechCapture : MonoBehaviour
    {
        private readonly ConcurrentQueue<(double time, int channels, float[] samples)> _audio = new();
        private string _directory;
        private StreamWriter _frames;
        private StreamWriter _blocks;
        private BinaryWriter _pcm;
        private IAvatarRuntimeFacade _runtime;
        private AvatarSpeechPlayer _player;
        private volatile bool _recording;
        private long _sampleOffset;
        private Transform _head;
        private bool _closeup;
        private AvatarControlConnection _connection;
        [Serializable] private sealed class Frame {
            public string file, playbackId, subtitle; public double time; public float position, duration;
            public float aa, ih, ou, ee, oh;
            public string actionId, modelPath; public Quaternion headRotation;
        }
        [Serializable] private sealed class Block { public double time; public int channels, samples; public long offset; }

        public void Configure(string directory, IAvatarRuntimeFacade runtime, AvatarSpeechPlayer player)
        {
            _directory = Path.GetFullPath(directory);
            Directory.CreateDirectory(_directory);
            _runtime = runtime; _player = player;
            _closeup = Environment.GetEnvironmentVariable("KATARUNE_SPEECH_CLOSEUP") == "1";
            _frames = new StreamWriter(Path.Combine(_directory, "frames.jsonl")) { AutoFlush = true };
            _blocks = new StreamWriter(Path.Combine(_directory, "audio.jsonl")) { AutoFlush = true };
            _pcm = new BinaryWriter(File.Create(Path.Combine(_directory, "audio.f32")));
            File.WriteAllText(Path.Combine(_directory, "sample-rate.txt"), AudioSettings.outputSampleRate.ToString());
            _recording = true;
            StartCoroutine(Capture());
        }

        private void OnAudioFilterRead(float[] data, int channels)
        {
            if (_recording && _audio.Count < 256)
                _audio.Enqueue((AudioSettings.dspTime, channels, (float[])data.Clone()));
        }

        private void FlushAudio()
        {
            while (_audio.TryDequeue(out var block)) {
                _blocks.WriteLine(JsonUtility.ToJson(new Block { time = block.time, channels = block.channels,
                    samples = block.samples.Length, offset = _sampleOffset }));
                foreach (var sample in block.samples) _pcm.Write(sample);
                _sampleOffset += block.samples.Length;
            }
            _pcm.Flush();
        }

        private void LateUpdate()
        {
            if (!_closeup || _runtime.Snapshot.RuntimeState != AvatarRuntimeState.Ready) return;
            if (_head == null) foreach (var animator in FindObjectsByType<Animator>(FindObjectsSortMode.None))
                if (animator.isHuman) { _head = animator.GetBoneTransform(HumanBodyBones.Head); break; }
            var camera = Camera.main;
            if (_head == null || camera == null) return;
            var target = _head.position + Vector3.up * .02f;
            camera.transform.position = target + new Vector3(0, .015f, .75f);
            camera.transform.LookAt(target);
            camera.lensShift = Vector2.zero;
            camera.fieldOfView = 35;
        }

        private IEnumerator Capture()
        {
            var index = 0;
            while (_recording) {
                yield return new WaitForEndOfFrame();
                FlushAudio();
                if (_runtime.Snapshot.RuntimeState != AvatarRuntimeState.Ready) continue;
                var time = AudioSettings.dspTime;
                var pose = _runtime.CurrentPose;
                if (_head == null) foreach (var animator in FindObjectsByType<Animator>(FindObjectsSortMode.None))
                    if (animator.isHuman && animator.GetComponentsInChildren<Renderer>().Any(r => r.enabled)) { _head = animator.GetBoneTransform(HumanBodyBones.Head); break; }
                var frame = new Frame { file = $"frame-{index++:D5}.jpg", time = time,
                    playbackId = _player.PlaybackId, position = _player.PositionSeconds, duration = _player.DurationSeconds,
                    aa = pose.Aa, ih = pose.Ih, ou = pose.Ou, ee = pose.Ee, oh = pose.Oh,
                    actionId = _runtime.Snapshot.Motion.CurrentActionId ?? "", modelPath = _runtime.Snapshot.Model?.Path ?? "",
                    headRotation = _head != null ? _head.localRotation : Quaternion.identity };
                _connection ??= FindFirstObjectByType<AvatarControlConnection>();
                frame.subtitle = _connection != null ? _connection.CurrentSubtitle : "";
                var texture = ScreenCapture.CaptureScreenshotAsTexture();
                File.WriteAllBytes(Path.Combine(_directory, frame.file), texture.EncodeToJPG(85));
                Destroy(texture);
                _frames.WriteLine(JsonUtility.ToJson(frame));
            }
        }

        private void OnDestroy()
        {
            _recording = false;
            if (_pcm == null) return;
            FlushAudio(); _pcm.Dispose(); _frames.Dispose(); _blocks.Dispose();
        }
    }
}
