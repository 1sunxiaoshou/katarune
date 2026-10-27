using System;
using System.Collections;
using System.IO;
using System.Threading;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarAudioClipLoaderTests
    {
        [UnityTest] public IEnumerator NativeDecoderAcceptsManagedMp3AndFloatWavWithoutFilenameExtensions()
        {
            var path = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
            AudioClip clip = null;
            try
            {
                File.Copy(Path.Combine(Application.dataPath, "Katarune/Tests/Fixtures/native-silence.mp3"), path);
                var loading = AvatarAudioClipLoader.LoadAsync(path);
                var deadline = Time.realtimeSinceStartup + 8f;
                while (!loading.IsCompleted && Time.realtimeSinceStartup < deadline) yield return null;
                Assert.That(loading.IsCompleted, Is.True); Assert.That(loading.IsFaulted, Is.False, loading.Exception?.GetBaseException().Message);
                clip = loading.GetAwaiter().GetResult();
                Assert.That(clip.samples, Is.GreaterThan(0)); Assert.That(clip.frequency, Is.EqualTo(16000));
                Assert.That(clip.channels, Is.EqualTo(1)); Assert.That(clip.length, Is.InRange(.9f, 1.3f));
                AvatarAudioClipLoader.Release(clip); clip = null;

                // Native WAV decoding accepts float samples too; the application has no PCM16 gate.
                using (var writer = new BinaryWriter(File.Create(path)))
                {
                    writer.Write(System.Text.Encoding.ASCII.GetBytes("RIFF")); writer.Write(36 + 64000);
                    writer.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt ")); writer.Write(16);
                    writer.Write((ushort)3); writer.Write((ushort)1); writer.Write(16000); writer.Write(64000);
                    writer.Write((ushort)4); writer.Write((ushort)32); writer.Write(System.Text.Encoding.ASCII.GetBytes("data"));
                    writer.Write(64000); writer.Write(new byte[64000]);
                }
                loading = AvatarAudioClipLoader.LoadAsync(path);
                deadline = Time.realtimeSinceStartup + 8f;
                while (!loading.IsCompleted && Time.realtimeSinceStartup < deadline) yield return null;
                Assert.That(loading.IsCompleted, Is.True); Assert.That(loading.IsFaulted, Is.False, loading.Exception?.GetBaseException().Message);
                clip = loading.GetAwaiter().GetResult();
                Assert.That(clip.samples, Is.EqualTo(16000)); Assert.That(clip.frequency, Is.EqualTo(16000));
                Assert.That(clip.channels, Is.EqualTo(1)); Assert.That(clip.length, Is.EqualTo(1f).Within(.001f));
            }
            finally { AvatarAudioClipLoader.Release(clip); if (File.Exists(path)) File.Delete(path); }
            yield return null;
        }

        [Test] public void MissingOrEmptyAudioFailsWithoutLeakingTheManagedPath()
        {
            var path = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
            try
            {
                var error = Assert.Throws<InvalidDataException>(() => AvatarAudioClipLoader.CreateRequest(path));
                Assert.That(error.Message, Does.Contain("音频").And.Not.Contain(path)); Assert.That(error.InnerException, Is.Null);
                File.WriteAllBytes(path, Array.Empty<byte>());
                Assert.Throws<InvalidDataException>(() => AvatarAudioClipLoader.CreateRequest(path));
            }
            finally { if (File.Exists(path)) File.Delete(path); }
        }

        [UnityTest] public IEnumerator CancellationBeforeDispatchDoesNotStartANativeRequest()
        {
            using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
            var loading = AvatarAudioClipLoader.LoadAsync("missing", cancellation.Token);
            yield return null;
            Assert.That(loading.IsCanceled, Is.True);
        }
    }
}
