using System;
using System.Collections;
using System.IO;
using System.Text;
using System.Threading;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using UniVRM10;

namespace Katarune.Avatar.Tests
{
    public sealed class VrmaTrackTests
    {
        [UnityTest]
        public IEnumerator NativeCurvesSamplePresetCustomAndIndependentLookAtRootWithoutHumanoid()
        {
            var path = WriteFixture(); VrmaSource source = null;
            try
            {
                var loading = VrmaSource.LoadAsync(path, CancellationToken.None);
                while (!loading.IsCompleted) yield return null;
                source = loading.GetAwaiter().GetResult();
                var tracks = new AvatarVrmAnimationTracks();
                Assert.That(source.Duration, Is.EqualTo(1f).Within(.001f));
                source.Sample(0f, null, tracks);
                Assert.That(tracks.Expressions[ExpressionKey.Happy], Is.Zero, "weights below zero are clamped");
                source.Sample(.5f, null, tracks);
                Assert.That(tracks.Expressions[ExpressionKey.Happy], Is.EqualTo(.5f).Within(.001f),
                    $"Native sample custom={tracks.Expressions[ExpressionKey.CreateCustom("absent-on-target")]} gaze={tracks.LookAt}");
                Assert.That(tracks.Expressions[ExpressionKey.CreateCustom("absent-on-target")], Is.EqualTo(.5f).Within(.001f));
                Assert.That(tracks.LookAt.Value.x, Is.EqualTo(-15f).Within(.1f), "native X reversal is applied once");
                source.Sample(1f, null, tracks);
                Assert.That(tracks.Expressions[ExpressionKey.Happy], Is.EqualTo(1f));
                Assert.That(tracks.LookAt.Value.x, Is.EqualTo(-30f).Within(.1f));
                tracks.Clear(); source.Sample(0f, null, tracks);
                Assert.That(tracks.LookAt.Value, Is.EqualTo(Vector2.zero), "backward seeks do not hold a prior gaze");
            }
            finally { source?.Dispose(); File.Delete(path); }
        }

        [UnityTest]
        public IEnumerator RejectsArbitraryScaleInsteadOfTreatingEveryGltfChannelAsAnAvatarTrack()
        {
            var path = WriteFixture(invalid: true);
            try
            {
                var loading = VrmaSource.LoadAsync(path, CancellationToken.None);
                while (!loading.IsCompleted) yield return null;
                Assert.Throws<InvalidDataException>(() => loading.GetAwaiter().GetResult());
            }
            finally { File.Delete(path); }
        }

        [Test]
        public void LookAtUsesZxyYawAndUpPositivePitchAndRejectsInvalidRotations()
        {
            var gaze = VrmaSource.GazeAngles(Quaternion.Euler(20f, -30f, 10f));
            Assert.That(gaze.x, Is.EqualTo(-30f).Within(.001f));
            Assert.That(gaze.y, Is.EqualTo(-20f).Within(.001f));
            Assert.Throws<InvalidDataException>(() => VrmaSource.GazeAngles(new Quaternion(0, 0, 0, 0)));
            Assert.Throws<InvalidDataException>(() => VrmaSource.GazeAngles(new Quaternion(float.NaN, 0, 0, 1)));
        }

        private static string WriteFixture(bool invalid = false)
        {
            var json = @"{""asset"":{""version"":""2.0""},""scene"":0,""scenes"":[{""nodes"":[0,1,2]}],
""nodes"":[{""name"":""Happy""},{""name"":""Custom""},{""name"":""Gaze""}],
""extensionsUsed"":[""VRMC_vrm_animation""],""extensions"":{""VRMC_vrm_animation"":{""specVersion"":""1.0"",
""expressions"":{""preset"":{""happy"":{""node"":0}},""custom"":{""absent-on-target"":{""node"":1}}},""lookAt"":{""node"":2}}},
""buffers"":[{""byteLength"":88}],""bufferViews"":[{""buffer"":0,""byteOffset"":0,""byteLength"":8},{""buffer"":0,""byteOffset"":8,""byteLength"":24},{""buffer"":0,""byteOffset"":32,""byteLength"":24},{""buffer"":0,""byteOffset"":56,""byteLength"":32}],
""accessors"":[{""bufferView"":0,""componentType"":5126,""count"":2,""type"":""SCALAR"",""min"":[0],""max"":[1]},
{""bufferView"":1,""componentType"":5126,""count"":2,""type"":""VEC3""},{""bufferView"":2,""componentType"":5126,""count"":2,""type"":""VEC3""},{""bufferView"":3,""componentType"":5126,""count"":2,""type"":""VEC4""}],
""animations"":[{""name"":""AllTracks"",""samplers"":[{""input"":0,""output"":1,""interpolation"":""LINEAR""},{""input"":0,""output"":2,""interpolation"":""LINEAR""},{""input"":0,""output"":3,""interpolation"":""LINEAR""}],
""channels"":[{""sampler"":0,""target"":{""node"":0,""path"":""translation""}},{""sampler"":1,""target"":{""node"":1,""path"":""translation""}},{""sampler"":2,""target"":{""node"":2,""path"":""rotation""}}]}]}";
            if (invalid) json = json.Replace("\"path\":\"translation\"", "\"path\":\"scale\"");
            var jsonBytes = Encoding.UTF8.GetBytes(json); var padded = (jsonBytes.Length + 3) & ~3;
            var path = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ".vrma");
            using var writer = new BinaryWriter(File.Create(path));
            writer.Write(0x46546C67); writer.Write(2); writer.Write(12 + 8 + padded + 8 + 88);
            writer.Write(padded); writer.Write(0x4E4F534A); writer.Write(jsonBytes);
            for (var i = jsonBytes.Length; i < padded; i++) writer.Write((byte)' ');
            writer.Write(88); writer.Write(0x004E4942);
            foreach (var value in new[] { 0f, 1f, -.5f, 0f, 0f, 1.5f, 0f, 0f, .2f, 0f, 0f, .8f, 0f, 0f, 0f, 0f, 0f, 1f,
                0f, Mathf.Sin(15f * Mathf.Deg2Rad), 0f, Mathf.Cos(15f * Mathf.Deg2Rad) }) writer.Write(value);
            return path;
        }
    }
}
