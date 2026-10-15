using System.Collections;
using System.IO;
using System.Linq;
using System.Threading;
using Katarune.Avatar;
using NUnit.Framework;
using UniGLTF;
using UniVRM10;
using UnityEngine;
using UnityEngine.TestTools;

namespace Katarune.Avatar.Tests
{
    public sealed class AdaptiveIdlePlayModeTests
    {
        [UnityTest]
        public IEnumerator GazeOverlaysAuthoredHeadWithoutReplacingAnimationOrAccumulating()
        {
            var path = AvatarDefaultAssets.ModelPath(Application.dataPath);
            if (!File.Exists(path)) Assert.Ignore("Default local VRM required.");
            var loading = Vrm10.LoadBytesAsync(File.ReadAllBytes(path), canLoadVrm0X: false, showMeshes: false,
                awaitCaller: new RuntimeOnlyAwaitCaller(), materialGenerator: new UrpVrm10MaterialDescriptorGenerator());
            while (!loading.IsCompleted) yield return null;
            var model = loading.GetAwaiter().GetResult();
            model.UpdateType = Vrm10Instance.UpdateTypes.None;
            try
            {
                using var driver = new UniVrmAvatarDriver(model);
                var head = model.Runtime.ControlRig.GetBoneTransform(HumanBodyBones.Head);
                var neck = model.Runtime.ControlRig.GetBoneTransform(HumanBodyBones.Neck);
                var headBase = head.localRotation; var neckBase = neck.localRotation;
                var behavior = new AvatarBehaviorModel();
                behavior.ApplySettings(AvatarBehaviorSettings.Default.WithPointerGazeTracking(true));
                AvatarPoseFrame frame = null;
                for (var i = 0; i < 120; i++) frame = behavior.Tick(1f / 60f, new Vector2(18f, 8f));
                frame.HasAuthoredBodyPose = true; frame.ProceduralBodyWeight = frame.ProceduralArmWeight = 0f;
                Assert.That(frame.HeadGaze.magnitude, Is.GreaterThan(5f));
                foreach (var authored in new[] { Quaternion.identity, Quaternion.Euler(16f, -9f, 4f) })
                {
                    for (var i = 0; i < 3; i++)
                    {
                        head.localRotation = headBase * authored; neck.localRotation = neckBase;
                        driver.Apply(frame); model.Runtime.Process();
                        var yaw = AvatarCoordinateSpace.ViewportYawToAvatarYaw(frame.HeadGaze.x);
                        var expected = headBase * authored * Quaternion.Euler(-frame.HeadGaze.y * .7f, yaw * .65f, 0f);
                        Assert.That(Quaternion.Angle(head.localRotation, expected), Is.LessThan(.01f));
                        Assert.That(Quaternion.Angle(headBase * authored, head.localRotation), Is.GreaterThan(3f), "Tracking must survive zero body fallback weight.");
                        Assert.That(Quaternion.Angle(neckBase, neck.localRotation), Is.GreaterThan(1f));
                        Assert.That(float.IsFinite(model.Runtime.LookAt.Yaw), Is.True);
                    }
                }
                behavior.ApplySettings(AvatarBehaviorSettings.Default.WithPointerGazeTracking(false));
                for (var i = 0; i < 240; i++) frame = behavior.Tick(1f / 60f, Vector2.zero);
                frame.HasAuthoredBodyPose = true; frame.ProceduralBodyWeight = frame.ProceduralArmWeight = 0f;
                head.localRotation = headBase; neck.localRotation = neckBase; driver.Apply(frame);
                Assert.That(Quaternion.Angle(head.localRotation, headBase), Is.LessThan(.01f));
            }
            finally { Object.Destroy(model.gameObject); }
            yield return null;
        }
        [UnityTest]
        public IEnumerator DefaultGeometryBakesAsynchronouslyAndPlaybackMovesAndLoops()
        {
            var path = AvatarDefaultAssets.ModelPath(Application.dataPath);
            if (!File.Exists(path)) Assert.Ignore("Default local VRM required.");
            var bytes = File.ReadAllBytes(path);
            var loading = Vrm10.LoadBytesAsync(bytes, canLoadVrm0X: false, showMeshes: false,
                awaitCaller: new RuntimeOnlyAwaitCaller(), materialGenerator: new UrpVrm10MaterialDescriptorGenerator());
            while (!loading.IsCompleted) yield return null;
            var model = loading.GetAwaiter().GetResult();
            try
            {
                var baking = AdaptiveIdleBaker.PrepareAsync(model, bytes, CancellationToken.None, useCache: false);
                Assert.That(baking.IsCompleted, Is.False, "Uncached preparation must yield to Unity's loop.");
                while (!baking.IsCompleted) yield return null;
                var clip = baking.GetAwaiter().GetResult();
                Assert.That(clip.channels.Length, Is.GreaterThan(0));
                Assert.That(clip.chains.Any(c => c.actual > .003f), Is.True, "Measured skin must actually move.");
                Assert.That(clip.chains.All(c => c.penetration < .001f), Is.True);
                var playback = model.gameObject.AddComponent<AdaptiveIdlePlayback>();
                playback.Configure(clip);
                var bone = model.transform.Find(clip.channels[0].path);
                playback.Tick(.2f, true);
                yield return null;
                var first = bone.localRotation;
                playback.Tick(.5f, true);
                yield return null;
                Assert.That(Quaternion.Angle(first, bone.localRotation), Is.GreaterThan(.01f));
                playback.Tick(1.5f, true);
                yield return null;
                Assert.That(Quaternion.Angle(first, bone.localRotation), Is.LessThan(.04f));
                playback.Tick(0, false);
                Assert.That(playback.IsBakedActive, Is.False, "Authored actions must release secondary joints.");
            }
            finally { Object.Destroy(model.gameObject); }
            yield return null;
        }
    }
}
