using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using Object = UnityEngine.Object;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarDancePlayerTests
    {
        [UnityTest] public IEnumerator CameraTrackRestoresFramingBeforeCompletionWithoutChangingMode()
        {
            var cameraObject = new GameObject("Dance camera"); cameraObject.AddComponent<Camera>();
            var rig = cameraObject.AddComponent<AvatarSceneRig>(); rig.Configure(false);
            var avatar = GameObject.CreatePrimitive(PrimitiveType.Cube); rig.Frame(avatar);
            rig.SetCharacterShowcaseControlEnabled(true);
            var before = rig.CaptureFraming();
            var runtime = new FakeDanceRuntime(.2f, new[] { new AvatarDanceCameraCue { at = 0f, view = "center" }, new AvatarDanceCameraCue { at = .05f, view = "closeup" } });
            var playerObject = new GameObject("Dance player"); var player = playerObject.AddComponent<AvatarDancePlayer>(); player.Configure(runtime, rig);
            var events = new List<string>(); var restoredAtCompletion = false;
            player.Play("dance", (status, error) => {
                events.Add(status);
                if (status == "completed") restoredAtCompletion = !rig.DancePresentationActive && !runtime.DanceActive
                    && Vector3.Distance(cameraObject.transform.position, before.CameraPosition) < .0001f
                    && Quaternion.Angle(cameraObject.transform.rotation, before.CameraRotation) < .001f;
            });
            yield return null; yield return null;
            Assert.That(events, Is.EqualTo(new[] { "started" }));
            Assert.That(rig.Immersive, Is.False); Assert.That(rig.CameraView, Is.EqualTo("overhead"));
            Assert.That(rig.CharacterShowcaseControlEnabled, Is.False);
            Assert.Throws<InvalidOperationException>(() => player.Play("dance", null));
            var deadline = Time.realtimeSinceStartup + 3f;
            while (player.Active && Time.realtimeSinceStartup < deadline) yield return null;
            Assert.That(events, Is.EqualTo(new[] { "started", "completed" })); Assert.That(restoredAtCompletion, Is.True);
            Assert.That(rig.EffectiveCameraView, Is.EqualTo("overhead")); Assert.That(rig.Immersive, Is.False);
            Assert.That(rig.CharacterShowcaseControlEnabled, Is.True);
            Object.Destroy(playerObject); Object.Destroy(avatar); Object.Destroy(cameraObject); yield return null;
        }

        [UnityTest] public IEnumerator AccompanimentHasIndependentSourceAndNeverWritesVisemes()
        {
            var path = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
            using (var writer = new BinaryWriter(File.Create(path))) {
                writer.Write(System.Text.Encoding.ASCII.GetBytes("RIFF")); writer.Write(36 + 16000);
                writer.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt ")); writer.Write(16); writer.Write((ushort)1); writer.Write((ushort)1);
                writer.Write(16000); writer.Write(32000); writer.Write((ushort)2); writer.Write((ushort)16);
                writer.Write(System.Text.Encoding.ASCII.GetBytes("data")); writer.Write(16000); writer.Write(new byte[16000]);
            }
            var runtime = new FakeDanceRuntime(.4f, null, path);
            var playerObject = new GameObject("Music only"); var player = playerObject.AddComponent<AvatarDancePlayer>(); player.Configure(runtime, null);
            var events = new List<string>(); player.Play("dance", (status, error) => events.Add(status));
            var deadline = Time.realtimeSinceStartup + 3f;
            while (!player.Started && player.Active && Time.realtimeSinceStartup < deadline) yield return null;
            Assert.That(events, Is.EqualTo(new[] { "started" }));
            Assert.That(playerObject.GetComponent<AudioSource>().isPlaying, Is.True);
            Assert.That(playerObject.GetComponent<AvatarLipSync>(), Is.Null); Assert.That(runtime.VisemeWrites, Is.Zero);
            playerObject.GetComponent<AudioSource>().Stop();
            yield return null; yield return null;
            Assert.That(events, Is.EqualTo(new[] { "started", "failed" }));
            Assert.That(runtime.DanceActive, Is.False); Assert.That(runtime.VisemeWrites, Is.Zero);
            Object.Destroy(playerObject); File.Delete(path); yield return null;
        }

        [UnityTest] public IEnumerator LyricsOwnTheSubtitleAreaIncludingGapsAndRejectOrdinarySubtitles()
        {
            var audio = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
            var subtitles = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
            WriteSilentWav(audio, 2);
            File.WriteAllText(subtitles, "1\n00:00:00,000 --> 00:00:00,300\n第一句\n\n2\n00:00:00,800 --> 00:00:01,100\n第二句\n\n3\n00:00:01,300 --> 00:00:01,700\n末句");
            var playerObject = new GameObject("Lyrics and dialogue");
            var player = playerObject.AddComponent<AvatarDancePlayer>();
            var connection = playerObject.AddComponent<AvatarControlConnection>(); connection.enabled = false;
            typeof(AvatarControlConnection).GetField("_dance", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(connection, player);
            var runtime = new FakeDanceRuntime(1.8f, null, audio, subtitles); player.Configure(runtime, null);
            var events = new List<string>();
            try
            {
                player.Play("dance", (status, error) => events.Add(status));
                var deadline = Time.realtimeSinceStartup + 4f;
                while (!player.Started && player.Active && Time.realtimeSinceStartup < deadline) yield return null;
                Assert.That(events, Is.EqualTo(new[] { "started" }));
                var source = playerObject.GetComponent<AudioSource>();
                source.timeSamples = (int)(source.clip.frequency * .1f); yield return null; yield return null;
                Assert.That(player.SubtitleText, Is.EqualTo("第一句"));
                Assert.That(connection.CurrentSubtitle, Is.EqualTo("第一句"));
                Assert.That(connection.ShowingDanceSubtitle, Is.True);
                Assert.That(connection.CurrentSubtitleColor, Is.EqualTo(new Color(1f, 143f / 255f, 179f / 255f)));

                Publish(connection, "ShowUserSubtitle", "用户说话");
                Assert.That(connection.CurrentSubtitle, Is.EqualTo("第一句"));
                Assert.That(connection.ShowingDanceSubtitle, Is.True);
                Publish(connection, "ShowSubtitle", "普通对白");
                Assert.That(connection.CurrentSubtitleColor, Is.EqualTo(new Color(1f, 143f / 255f, 179f / 255f)));
                source.timeSamples = (int)(source.clip.frequency * .85f); yield return null; yield return null;
                Assert.That(player.SubtitleText, Is.EqualTo("第二句"));
                Assert.That(connection.CurrentSubtitle, Is.EqualTo("第二句"));
                Publish(connection, "ClearSubtitle");
                Assert.That(connection.CurrentSubtitle, Is.EqualTo("第二句"), "Resume the current lyric, not the missed first one.");
                Assert.That(connection.ShowingDanceSubtitle, Is.True);

                source.timeSamples = (int)(source.clip.frequency * 1.2f); yield return null; yield return null;
                Assert.That(player.SubtitleText, Is.Empty); Assert.That(connection.CurrentSubtitle, Is.Empty);
                source.timeSamples = (int)(source.clip.frequency * 1.4f); yield return null; yield return null;
                Assert.That(player.SubtitleText, Is.EqualTo("末句"));
                player.Cancel("测试会话重置");
                Assert.That(events, Is.EqualTo(new[] { "started", "cancelled" }));
                Assert.That(player.SubtitleText, Is.Empty); Assert.That(connection.CurrentSubtitle, Is.Empty);

                events.Clear(); player.Play("dance", (status, error) => events.Add(status));
                deadline = Time.realtimeSinceStartup + 4f;
                while (!player.Started && player.Active && Time.realtimeSinceStartup < deadline) yield return null;
                Assert.That(events, Is.EqualTo(new[] { "started" }));
                source.timeSamples = (int)(source.clip.frequency * 1.75f);
                while (player.Active && Time.realtimeSinceStartup < deadline) yield return null;
                Assert.That(events, Is.EqualTo(new[] { "started", "completed" }));
                Assert.That(player.SubtitleText, Is.Empty); Assert.That(connection.CurrentSubtitle, Is.Empty);
                Assert.That(connection.CurrentSubtitleColor, Is.EqualTo(Color.white));
            }
            finally { Object.Destroy(playerObject); File.Delete(audio); File.Delete(subtitles); }
            yield return null;
        }

        [UnityTest] public IEnumerator ConfiguredMissingSubtitlesFailBeforeStartupAndNoSubtitleDanceLeavesDisplayFree()
        {
            var missing = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
            var playerObject = new GameObject("Subtitle resource failure");
            var player = playerObject.AddComponent<AvatarDancePlayer>();
            var runtime = new FakeDanceRuntime(.2f, null, subtitles: missing); player.Configure(runtime, null);
            var events = new List<string>(); string failure = null;
            try
            {
                player.Play("dance", (status, error) => { events.Add(status); failure = error; });
                var deadline = Time.realtimeSinceStartup + 3f;
                while (player.Active && Time.realtimeSinceStartup < deadline) yield return null;
                Assert.That(events, Is.EqualTo(new[] { "failed" })); Assert.That(player.Started, Is.False);
                Assert.That(failure, Does.Contain("字幕").And.Not.Contain(missing));
                Assert.That(player.SubtitleText, Is.Empty); Assert.That(runtime.DanceActive, Is.False);
            }
            finally { Object.Destroy(playerObject); }
            yield return null;
            playerObject = new GameObject("No subtitles"); player = playerObject.AddComponent<AvatarDancePlayer>();
            player.Configure(new FakeDanceRuntime(.1f, null), null);
            try
            {
                player.Play("dance", null);
                var deadline = Time.realtimeSinceStartup + 2f;
                while (player.Active && Time.realtimeSinceStartup < deadline)
                { Assert.That(player.SubtitleText, Is.Empty); yield return null; }
                Assert.That(player.SubtitleText, Is.Empty);
            }
            finally { Object.Destroy(playerObject); }
            yield return null;
        }

        private static void Publish(AvatarControlConnection connection, string method, params object[] args)
            => typeof(AvatarControlConnection).GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic).Invoke(connection, args);

        private static void WriteSilentWav(string path, int seconds)
        {
            using var writer = new BinaryWriter(File.Create(path));
            var bytes = 16000 * seconds * 2;
            writer.Write(System.Text.Encoding.ASCII.GetBytes("RIFF")); writer.Write(36 + bytes);
            writer.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt ")); writer.Write(16); writer.Write((ushort)1); writer.Write((ushort)1);
            writer.Write(16000); writer.Write(32000); writer.Write((ushort)2); writer.Write((ushort)16);
            writer.Write(System.Text.Encoding.ASCII.GetBytes("data")); writer.Write(bytes); writer.Write(new byte[bytes]);
        }

        private sealed class FakeDanceRuntime : IAvatarRuntimeFacade, IAvatarDanceRuntime
        {
            private readonly AvatarPackagePlayback _playback;
            internal int VisemeWrites;
            public bool DanceActive { get; private set; }
            public string DanceError => null;
            public IReadOnlyList<AvatarActionInfo> AvailableActions { get; }
            internal FakeDanceRuntime(float seconds, AvatarDanceCameraCue[] camera, string audio = null, string subtitles = null)
            { AvailableActions = new[] { new AvatarActionInfo("dance", "舞蹈", seconds, kind: "performance") }; _playback = new AvatarPackagePlayback { kind = "performance", camera = camera == null ? null : new AvatarPackageCamera { kind = "presets", keys = camera }, audio = audio, subtitles = subtitles }; }
            public AvatarPackagePlayback GetDancePlayback(string actionId) => actionId == "dance" ? _playback : null;
            public void BeginDance(string actionId) => DanceActive = true;
            public void SampleDance(string actionId, float seconds) { }
            public void EndDance(bool immediate = false) => DanceActive = false;
            public AvatarRuntimeSnapshot Snapshot => new(0, AvatarRuntimeState.Ready, null, null, AvatarBehaviorSettings.Default, default, new AvatarCapabilitySet((AvatarAffectCapabilities)63));
            public AvatarPoseFrame CurrentPose => new();
            public event Action<AvatarRuntimeSnapshot> Changed { add { } remove { } }
            public void ApplyBehavior(AvatarBehaviorSettings settings) { }
            public void ApplyPresentation(AvatarPresentationSettings settings) { }
            public void SetManualVisemes(AvatarVisemeWeights weights, bool immediate = false) => VisemeWrites++;
            public void RequestBlink() { }
            public void CancelAction() => EndDance(true);
            public Task<AvatarLoadResult> LoadAsync(string path, CancellationToken cancellationToken = default) => throw new NotSupportedException();
            public void Unload() => EndDance(true);
            public AvatarActionRequestResult RequestAction(string id) => throw new NotSupportedException();
            public AvatarActionRequestResult RequestAction(AvatarPresetAction action) => throw new NotSupportedException();
            public BehaviorRequestResult RequestBehavior(BehaviorIntent intent, PerformanceRequestPolicy policy = PerformanceRequestPolicy.Queue) => throw new NotSupportedException();
            public PerformanceTransitionOutcome ApplyPerformanceCommand(string instanceId, PerformanceCommand command) => throw new NotSupportedException();
            public void Dispose() { }
        }
    }
}
