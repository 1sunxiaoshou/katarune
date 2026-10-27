using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using NUnit.Framework;
using UniGLTF;
using UniVRM10;
using UnityEngine;
using UnityEngine.TestTools;
using Object = UnityEngine.Object;

namespace Katarune.Avatar.Tests
{
    public sealed class VrmaDanceOwnershipTests
    {
        [UnityTest]
        public IEnumerator DanceOwnsFaceAndGazeReleasesGeneratedIdleAndRestoresOrdinaryBehavior()
        {
            var modelPath = AvatarDefaultAssets.ModelPath(Application.dataPath);
            var bodyPath = Path.GetFullPath(Path.Combine(Application.dataPath, "../../..", "resources", "characters", "default-package", "actions", "idle", "motion.vrma"));
            if (!File.Exists(modelPath) || !File.Exists(bodyPath)) Assert.Ignore("Default local VRM and idle VRMA required.");
            var bytes = File.ReadAllBytes(modelPath);
            // Register a synthetic custom binding in the SDK's parsed VRM data before runtime creation.
            // The local model and binary geometry stay untouched; this test does not depend on user custom morphs.
            using var data = new GlbLowLevelParser(modelPath, bytes).Parse();
            var vrm = Vrm10Data.Parse(data);
            Assert.That(vrm.VrmExtension.Expressions.Preset.Happy.MorphTargetBinds, Is.Not.Empty);
            vrm.VrmExtension.Expressions.Custom ??= new Dictionary<string, UniGLTF.Extensions.VRMC_vrm.Expression>();
            vrm.VrmExtension.Expressions.Custom.Add("test-authored-face", new UniGLTF.Extensions.VRMC_vrm.Expression {
                MorphTargetBinds = vrm.VrmExtension.Expressions.Preset.Happy.MorphTargetBinds,
            });
            using var importer = new Vrm10Importer(vrm, useControlRig: true, materialGenerator: new UrpVrm10MaterialDescriptorGenerator());
            var loading = importer.LoadAsync(new RuntimeOnlyAwaitCaller());
            while (!loading.IsCompleted) yield return null;
            var model = loading.GetAwaiter().GetResult().Root.GetComponent<Vrm10Instance>(); model.UpdateType = Vrm10Instance.UpdateTypes.None;
            VrmaMotionInstance motion = null; UniVrmAvatarDriver driver = null; string facePath = null;
            try
            {
                var customClip = model.Vrm.Expression.CustomClips.Single(clip => clip.name == "test-authored-face");
                var custom = model.Vrm.Expression.CreateKey(customClip);
                facePath = WriteFaceFixture(custom.Name);
                var faceId = Guid.NewGuid().ToString(); var bodyId = Guid.NewGuid().ToString();
                var package = new AvatarCharacterPackage {
                    id = "test-dance-tracks", actions = new[] {
                        new AvatarPackageAction { id = faceId, key = "face", name = "Face dance", playback = new AvatarPackagePlayback { kind = "performance", motion = facePath } },
                        new AvatarPackageAction { id = bodyId, key = "body", name = "Body dance", playback = new AvatarPackagePlayback { kind = "performance", motion = bodyPath } },
                    },
                };
                var preparing = VrmaMotionInstance.PrepareAsync(model, package, bytes, CancellationToken.None);
                while (!preparing.IsCompleted) yield return null;
                motion = preparing.GetAwaiter().GetResult(); driver = new UniVrmAvatarDriver(model); driver.AttachMotion(motion);
                var generated = model.GetComponent<AdaptiveIdlePlayback>();
                motion.Tick(.3f); Assert.That(generated.IsBakedActive, Is.True, "No authored idle uses the generated secondary-motion loop.");
                var frame = new AvatarPoseFrame {
                    HasAuthoredBodyPose = true, ProceduralBodyWeight = 0f, ProceduralArmWeight = 0f,
                    Blink = 1f, Happy = .9f, Aa = .8f, HeadGaze = new Vector2(24f, 10f), GazeYaw = 24f, GazePitch = 10f,
                    HeadEuler = new Vector3(12, 18, 3), HipsPositionOffset = new Vector3(.2f, .1f, 0),
                };
                motion.BeginDance(faceId); motion.SampleDance(faceId, .5f); motion.Tick(.3f);
                var head = model.Runtime.ControlRig.GetBoneTransform(HumanBodyBones.Head);
                var hips = model.Runtime.ControlRig.GetBoneTransform(HumanBodyBones.Hips);
                var authoredHead = head.localRotation; var authoredHips = hips.localPosition;
                driver.Apply(frame); model.Runtime.Process();
                Assert.That(generated.IsBakedActive, Is.False, "Dance must release the baked joints so native SpringBone writeback stays enabled.");
                Assert.That(model.Runtime.Expression.GetWeight(ExpressionKey.Blink), Is.Zero);
                Assert.That(model.Runtime.Expression.GetWeight(ExpressionKey.Aa), Is.Zero);
                Assert.That(model.Runtime.Expression.GetWeight(ExpressionKey.Happy), Is.EqualTo(.4f).Within(.001f));
                Assert.That(model.Runtime.Expression.GetWeight(custom), Is.EqualTo(.6f).Within(.001f));
                Assert.That(model.Runtime.LookAt.Yaw, Is.EqualTo(-20f).Within(.1f));
                Assert.That(Quaternion.Angle(head.localRotation, authoredHead), Is.LessThan(.001f), "Pointer gaze cannot modify the dance head.");
                Assert.That(Vector3.Distance(hips.localPosition, authoredHips), Is.LessThan(.00001f));

                motion.EndDance(true); motion.Tick(.3f); var neutralHead = head.localRotation;
                driver.Apply(frame); model.Runtime.Process();
                Assert.That(model.Runtime.Expression.GetWeight(ExpressionKey.Blink), Is.EqualTo(1f));
                Assert.That(model.Runtime.Expression.GetWeight(ExpressionKey.Aa), Is.EqualTo(.8f).Within(.001f));
                Assert.That(model.Runtime.Expression.GetWeight(ExpressionKey.Happy), Is.EqualTo(.9f).Within(.001f));
                Assert.That(model.Runtime.Expression.GetWeight(custom), Is.Zero, "Ended clip custom weights must not stick.");
                Assert.That(Quaternion.Angle(head.localRotation, neutralHead), Is.GreaterThan(3f));
                Assert.That(generated.IsBakedActive, Is.True);

                motion.BeginDance(bodyId); motion.SampleDance(bodyId, .5f); motion.Tick(.3f);
                driver.Apply(frame); model.Runtime.Process();
                Assert.That(model.Runtime.Expression.GetWeight(ExpressionKey.Blink), Is.Zero, "A dance without facial tracks stays neutral.");
                Assert.That(model.Runtime.Expression.GetWeight(ExpressionKey.Happy), Is.Zero);
                Assert.That(model.Runtime.Expression.GetWeight(ExpressionKey.Aa), Is.Zero);
                Assert.That(model.Runtime.LookAt.Yaw, Is.Zero.Within(.001f));
                Assert.That(model.Runtime.LookAt.Pitch, Is.Zero.Within(.001f));
                Assert.That(generated.IsBakedActive, Is.False);
                motion.EndDance(true); motion.Tick(.3f); driver.Apply(frame);
                Assert.That(model.Runtime.Expression.GetWeight(ExpressionKey.Aa), Is.EqualTo(.8f).Within(.001f));
            }
            finally { driver?.Dispose(); motion?.Dispose(); if (facePath != null) File.Delete(facePath); Object.Destroy(model.gameObject); }
            yield return null;
        }

        private static string WriteFaceFixture(string custom)
        {
            var key = "\"" + custom.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
            var json = @"{""asset"":{""version"":""2.0""},""scene"":0,""scenes"":[{""nodes"":[0,1,2]}],""nodes"":[{""name"":""Happy""},{""name"":""Custom""},{""name"":""Gaze""}],
""extensionsUsed"":[""VRMC_vrm_animation""],""extensions"":{""VRMC_vrm_animation"":{""specVersion"":""1.0"",""expressions"":{""preset"":{""happy"":{""node"":0}},""custom"":{CUSTOM:{""node"":1}}},""lookAt"":{""node"":2}}},
""buffers"":[{""byteLength"":88}],""bufferViews"":[{""buffer"":0,""byteOffset"":0,""byteLength"":8},{""buffer"":0,""byteOffset"":8,""byteLength"":24},{""buffer"":0,""byteOffset"":32,""byteLength"":24},{""buffer"":0,""byteOffset"":56,""byteLength"":32}],
""accessors"":[{""bufferView"":0,""componentType"":5126,""count"":2,""type"":""SCALAR"",""min"":[0],""max"":[1]},{""bufferView"":1,""componentType"":5126,""count"":2,""type"":""VEC3""},{""bufferView"":2,""componentType"":5126,""count"":2,""type"":""VEC3""},{""bufferView"":3,""componentType"":5126,""count"":2,""type"":""VEC4""}],
""animations"":[{""name"":""FaceDance"",""samplers"":[{""input"":0,""output"":1},{""input"":0,""output"":2},{""input"":0,""output"":3}],""channels"":[{""sampler"":0,""target"":{""node"":0,""path"":""translation""}},{""sampler"":1,""target"":{""node"":1,""path"":""translation""}},{""sampler"":2,""target"":{""node"":2,""path"":""rotation""}}]}]}".Replace("CUSTOM", key);
            var bytes = Encoding.UTF8.GetBytes(json); var padded = (bytes.Length + 3) & ~3;
            var path = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ".vrma");
            using var writer = new BinaryWriter(File.Create(path));
            writer.Write(0x46546C67); writer.Write(2); writer.Write(12 + 8 + padded + 8 + 88);
            writer.Write(padded); writer.Write(0x4E4F534A); writer.Write(bytes);
            for (var i = bytes.Length; i < padded; i++) writer.Write((byte)' ');
            writer.Write(88); writer.Write(0x004E4942);
            foreach (var value in new[] { 0f, 1f, .4f, 0f, 0f, .4f, 0f, 0f, .6f, 0f, 0f, .6f, 0f, 0f,
                0f, Mathf.Sin(10f * Mathf.Deg2Rad), 0f, Mathf.Cos(10f * Mathf.Deg2Rad),
                0f, Mathf.Sin(10f * Mathf.Deg2Rad), 0f, Mathf.Cos(10f * Mathf.Deg2Rad) }) writer.Write(value);
            return path;
        }
    }
}
