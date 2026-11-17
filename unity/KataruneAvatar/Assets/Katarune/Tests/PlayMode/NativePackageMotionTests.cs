#if UNITY_EDITOR
using System;
using System.Collections;
using System.IO;
using System.Linq;
using System.Threading;
using NUnit.Framework;
using UniVRM10;
using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;
using UnityEngine.TestTools;

namespace Katarune.Avatar.Tests
{
    public sealed class NativePackageMotionTests
    {
        [Serializable] private sealed class Comparison { public float maxHeadErrorMm; public float headForwardRangeMm; }
        static string Fixtures()
        {
            var path = Environment.GetEnvironmentVariable("KATARUNE_NATIVE_MOTION_FIXTURES");
            if (string.IsNullOrEmpty(path) || !File.Exists(Path.Combine(path, "standby.bundle")))
                Assert.Ignore("Build native standby/walk fixtures and set KATARUNE_NATIVE_MOTION_FIXTURES.");
            return path;
        }
        static string VrmPath => AvatarDefaultAssets.EditorModelPath(Application.dataPath);
        static string VrmaPath => Path.Combine(Fixtures(), "nod.vrma");
        static AvatarPackageAction Action(string key, string path, string kind = "oneShot", string layer = "body") => new AvatarPackageAction {
            id = Guid.NewGuid().ToString(), key = key, name = key,
            playback = new AvatarPackagePlayback {kind = kind, motion = path, layer = layer},
        };

        [UnityTest]
        public IEnumerator SceneInteractionClipsStayFiniteAndLoopsCloseWithoutMovingTheModel()
        {
            var loops = new[] { "sit-idle", "sit-chat", "sit-think", "sit-read", "sit-write", "crouch-idle", "crouch-walk", "fall-loop" };
            var keys = loops.Concat(new[] { "turn-left", "turn-right", "sit-down", "sit-up", "crouch-up",
                "sit-chat-start", "sit-chat-end", "sit-think-start", "sit-think-end", "sit-read-start", "sit-read-end", "sit-write-start", "sit-write-end",
                "jump", "jump-walk", "jump-run", "jump-sprint", "land-low", "land-high", "land-run", "land-sprint",
                "walk-stop-right", "run-stop-right", "sprint-stop-right" });
            var root = Path.GetDirectoryName(Path.GetDirectoryName(VrmPath));
            var loading = Vrm10.LoadPathAsync(VrmPath);
            while (!loading.IsCompleted) yield return null;
            var target = loading.GetAwaiter().GetResult(); target.UpdateType = Vrm10Instance.UpdateTypes.None;
            using var sampler = new NativePackageMotionSampler(target.Runtime.ControlRig);
            try
            {
                var rig = target.Runtime.ControlRig;
                var bones = rig.Bones.Values.Select(b => b.ControlBone).ToArray();
                foreach (var key in keys)
                {
                    var load = NativeMotionClipLease.LoadAsync(Path.Combine(root, "actions", key, "motion.bundle"), CancellationToken.None);
                    while (!load.IsCompleted) yield return null;
                    using var source = sampler.Create(load.GetAwaiter().GetResult());
                    source.Sample(0, rig);
                    var positions = bones.Select(b => b.localPosition).ToArray();
                    var rotations = bones.Select(b => b.localRotation).ToArray();
                    for (var frame = 0; frame <= 60; frame++)
                    {
                        Assert.DoesNotThrow(() => source.Sample(source.Duration * frame / 60f, rig), key);
                        Assert.That(target.transform.position, Is.EqualTo(Vector3.zero), key);
                    }
                    if (!loops.Contains(key)) continue;
                    source.Sample(source.Duration - .0001f, rig);
                    var distance = bones.Select((b, i) => Vector3.Distance(b.localPosition, positions[i])).Max();
                    var angle = bones.Select((b, i) => Quaternion.Angle(b.localRotation, rotations[i])).Max();
                    Debug.Log($"INTERACTION_LOOP {key} positionSeam={distance} rotationSeam={angle}");
                    Assert.That(distance, Is.LessThan(.02f), key + " positional seam");
                    Assert.That(angle, Is.LessThan(3f), key + " rotational seam");
                    source.Sample(0, rig);
                    Assert.That(bones.Select((b, i) => Vector3.Distance(b.localPosition, positions[i])).Max(), Is.LessThan(.00001f), key + " seek must restore pose");
                }
            }
            finally { UnityEngine.Object.Destroy(target.gameObject); }
        }

        [UnityTest]
        public IEnumerator TurnVariantsDifferAndStoppingVariantsSwapLeadingFeet()
        {
            var root = Path.GetDirectoryName(Path.GetDirectoryName(VrmPath));
            var loading = Vrm10.LoadPathAsync(VrmPath);
            while (!loading.IsCompleted) yield return null;
            var target = loading.GetAwaiter().GetResult(); target.UpdateType = Vrm10Instance.UpdateTypes.None;
            using var sampler = new NativePackageMotionSampler(target.Runtime.ControlRig);
            try
            {
                var rig = target.Runtime.ControlRig;
                foreach (var pair in new[] { ("turn-left", "turn-right"), ("walk-stop-left", "walk-stop-right"), ("run-stop-left", "run-stop-right"), ("sprint-stop-left", "sprint-stop-right") })
                {
                    var load = NativeMotionClipLease.LoadAsync(Path.Combine(root, "actions", pair.Item1, "motion.bundle"), CancellationToken.None);
                    while (!load.IsCompleted) yield return null;
                    var leftLease = load.GetAwaiter().GetResult();
                    using var left = sampler.Create(leftLease);
                    load = NativeMotionClipLease.LoadAsync(Path.Combine(root, "actions", pair.Item2, "motion.bundle"), CancellationToken.None);
                    while (!load.IsCompleted) yield return null;
                    var rightLease = load.GetAwaiter().GetResult();
                    using var right = sampler.Create(rightLease);
                    if (pair.Item1 == "turn-left")
                    {
                        left.Sample(left.Duration * .5f, rig);
                        var leftPose = rig.Bones.Values.Select(b => b.ControlBone.localRotation).ToArray();
                        right.Sample(right.Duration * .5f, rig);
                        var poseDifference = rig.Bones.Values.Select((b, i) => Quaternion.Angle(b.ControlBone.localRotation, leftPose[i])).Max();
                        Debug.Log($"INTERACTION_TURN_POSE difference={poseDifference}");
                        Assert.That(poseDifference, Is.GreaterThan(5f), "Turn variants must produce distinct poses, not duplicate the same animation.");
                    }
                    else
                    {
                        // Authored mirror variants have asymmetric resting poses and
                        // timing adjustments; test their actual leading feet rather
                        // than requiring every frame to be a geometric reflection.
                        float FootLead() => rig.GetBoneTransform(HumanBodyBones.LeftFoot).position.z
                            - rig.GetBoneTransform(HumanBodyBones.RightFoot).position.z;
                        left.Sample(0, rig); var leftLead = FootLead();
                        right.Sample(0, rig); var rightLead = FootLead();
                        Debug.Log($"INTERACTION_SUPPORT {pair.Item1} leftLead={leftLead} rightLead={rightLead}");
                        Assert.That(Mathf.Abs(leftLead), Is.GreaterThan(.02f), pair.Item1);
                        Assert.That(Mathf.Abs(rightLead), Is.GreaterThan(.02f), pair.Item2);
                        Assert.That(leftLead * rightLead, Is.LessThan(0f), pair.Item1 + " must change the leading foot");
                    }
                }
            }
            finally { UnityEngine.Object.Destroy(target.gameObject); }
        }

        [UnityTest]
        public IEnumerator DefaultLocomotionLoopsMoveFeetWithoutRootDriftOrWrapDiscontinuity()
        {
            var packageRoot = Path.GetDirectoryName(Path.GetDirectoryName(VrmPath));
            var loading = Vrm10.LoadPathAsync(VrmPath);
            while (!loading.IsCompleted) yield return null;
            var target = loading.GetAwaiter().GetResult();
            target.UpdateType = Vrm10Instance.UpdateTypes.None;
            using var sampler = new NativePackageMotionSampler(target.Runtime.ControlRig);
            try
            {
                foreach (var key in new[] { "walk", "run", "sprint" })
                {
                    var load = NativeMotionClipLease.LoadAsync(Path.Combine(packageRoot, "actions", key, "motion.bundle"), CancellationToken.None);
                    while (!load.IsCompleted) yield return null;
                    using var source = sampler.Create(load.GetAwaiter().GetResult());
                    var rig = target.Runtime.ControlRig;
                    var foot = rig.GetBoneTransform(HumanBodyBones.LeftFoot);
                    var leg = rig.GetBoneTransform(HumanBodyBones.LeftUpperLeg);
                    source.Sample(0, rig);
                    var startFoot = foot.position;
                    var startLeg = leg.rotation;
                    source.Sample(source.Duration - .0001f, rig);
                    var seamDistance = Vector3.Distance(startFoot, foot.position);
                    var seamAngle = Quaternion.Angle(startLeg, leg.rotation);
                    Debug.Log($"LOCOMOTION_LOOP {key} duration={source.Duration} footSeam={seamDistance} legSeam={seamAngle}");
                    Assert.That(seamDistance, Is.LessThan(.02f), key + " foot continuity at wrap");
                    Assert.That(seamAngle, Is.LessThan(3f), key + " leg continuity at wrap");
                    source.Sample(source.Duration * .5f, rig);
                    Assert.That(Vector3.Distance(startFoot, foot.position), Is.GreaterThan(.05f), key + " must move the legs");
                    for (var cycle = 0; cycle < 3; cycle++)
                    {
                        for (var frame = 0; frame < 60; frame++) source.Sample(source.Duration * frame / 60f, rig);
                        source.Sample(0, rig);
                        Assert.That(Vector3.Distance(startFoot, foot.position), Is.LessThan(.00001f), key + " must not accumulate displacement");
                        Assert.That(target.transform.position, Is.EqualTo(Vector3.zero));
                    }
                }
            }
            finally { UnityEngine.Object.Destroy(target.gameObject); }
        }

        [UnityTest]
        public IEnumerator RawNativeStandbyMatchesPackagePlaybackIncludingAfterMixedReferencePreparation()
        {
            var directory = Fixtures();
            var raw = UnityEditor.AssetDatabase.LoadAssetAtPath<AnimationClip>("Assets/KataruneLocal/MotionPacks/genshin-girl-standby-source.anim");
            Assert.That(raw, Is.Not.Null, "Keep the imported source clip for the raw-to-package comparison.");
            var nativeLoading = Vrm10.LoadPathAsync(VrmPath, controlRigGenerationOption: ControlRigGenerationOption.None);
            while (!nativeLoading.IsCompleted) yield return null;
            var native = nativeLoading.GetAwaiter().GetResult(); native.UpdateType = Vrm10Instance.UpdateTypes.None;
            var targetLoading = Vrm10.LoadPathAsync(VrmPath);
            while (!targetLoading.IsCompleted) yield return null;
            var target = targetLoading.GetAwaiter().GetResult(); target.UpdateType = Vrm10Instance.UpdateTypes.None;
            PackageMotionInstance motion = null; UniVrmAvatarDriver driver = null;
            var graph = PlayableGraph.Create("Raw comparison"); graph.SetTimeUpdateMode(DirectorUpdateMode.Manual);
            try
            {
                var animator = native.GetComponent<Animator>(); animator.applyRootMotion = false; animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
                var playable = AnimationClipPlayable.Create(graph, raw); playable.SetSpeed(0); playable.SetApplyFootIK(true);
                AnimationPlayableOutput.Create(graph, "native", animator).SetSourcePlayable(playable); graph.Play();
                var idle = Action("idle", Path.Combine(directory, "standby.bundle"), "loop");
                var nod = Action("nod", VrmaPath, layer: "head");
                // Preparing the additive VRMA first mutates the target pose. Native
                // sampling must still build from the saved T-pose, not this pose.
                var package = new AvatarCharacterPackage {id = "native-comparison", actions = new[] {nod, idle}, idle = new AvatarPackageIdle {@base = idle.id, variations = Array.Empty<string>()}};
                var preparing = PackageMotionInstance.PrepareAsync(target, package, File.ReadAllBytes(VrmPath), CancellationToken.None);
                while (!preparing.IsCompleted) yield return null;
                motion = preparing.GetAwaiter().GetResult(); driver = new UniVrmAvatarDriver(target); driver.AttachMotion(motion);
                var behavior = new AvatarBehaviorModel(new SystemAvatarRandom(1));
                var maxHeadError = 0f; var minZ = float.PositiveInfinity; var maxZ = float.NegativeInfinity;
                for (var frameIndex=0; frameIndex<=120; frameIndex++)
                {
                    playable.SetTime(frameIndex/60f); graph.Evaluate(0);
                    motion.Tick(frameIndex==0 ? 0 : 1/60f);
                    var frame = behavior.Tick(1/60f, Vector2.zero); frame.HasAuthoredBodyPose=true; frame.ProceduralBodyWeight=frame.ProceduralArmWeight=0;
                    driver.Apply(frame); target.Runtime.Process();
                    var head = target.Humanoid.GetBoneTransform(HumanBodyBones.Head).position;
                    if (frameIndex>13) maxHeadError = Mathf.Max(maxHeadError, Vector3.Distance(animator.GetBoneTransform(HumanBodyBones.Head).position, head));
                    minZ=Mathf.Min(minZ,head.z);maxZ=Mathf.Max(maxZ,head.z);
                }
                File.WriteAllText(Path.Combine(directory,"native-comparison.json"), JsonUtility.ToJson(new Comparison {maxHeadErrorMm=maxHeadError*1000,headForwardRangeMm=(maxZ-minZ)*1000}));
                Assert.That(maxHeadError, Is.LessThan(.001f), "Native package head must stay within 1 mm of direct Unity playback.");
                Assert.That(maxZ-minZ, Is.InRange(.001f, .005f), "Head must move naturally, without the old amplified sway.");
            }
            finally {driver?.Dispose();motion?.Dispose();graph.Destroy();UnityEngine.Object.Destroy(native.gameObject);UnityEngine.Object.Destroy(target.gameObject);}
        }

        [UnityTest]
        public IEnumerator SharedBundlesSurviveCancellationAndFailedCandidateAndSupportBackwardSeeks()
        {
            var directory=Fixtures();var copy=Path.Combine(Path.GetTempPath(),Guid.NewGuid().ToString());
            File.Copy(Path.Combine(directory,"standby.bundle"),copy);
            NativeMotionClipLease first=null, second=null; NativePackageMotionSampler sampler=null;IPackageMotionSource source=null;Vrm10Instance target=null;
            try
            {
                var loading=NativeMotionClipLease.LoadAsync(Path.Combine(directory,"standby.bundle"),CancellationToken.None);
                while(!loading.IsCompleted)yield return null;first=loading.GetAwaiter().GetResult();
                loading=NativeMotionClipLease.LoadAsync(copy,CancellationToken.None);
                while(!loading.IsCompleted)yield return null;second=loading.GetAwaiter().GetResult();
                Assert.That(second.Clip,Is.SameAs(first.Clip),"Identical bundles at different/opaque paths share a lease.");
                using(var cancellation=new CancellationTokenSource())
                {
                    cancellation.Cancel();loading=NativeMotionClipLease.LoadAsync(copy,cancellation.Token);
                    while(!loading.IsCompleted)yield return null;
                    Assert.That(loading.IsCanceled,Is.True);
                }
                var modelLoading=Vrm10.LoadPathAsync(VrmPath);while(!modelLoading.IsCompleted)yield return null;
                target=modelLoading.GetAwaiter().GetResult();target.UpdateType=Vrm10Instance.UpdateTypes.None;
                sampler=new NativePackageMotionSampler(target.Runtime.ControlRig);source=sampler.Create(first);first=null;
                second.Dispose();second=null;
                source.Sample(.5f,target.Runtime.ControlRig);var head=target.Runtime.ControlRig.GetBoneTransform(HumanBodyBones.Head);var expected=head.position;
                source.Sample(1.5f,target.Runtime.ControlRig);source.Sample(.5f,target.Runtime.ControlRig);
                Assert.That(Vector3.Distance(expected,head.position),Is.LessThan(.00001f));
                var valid=Action("valid",copy,"loop");var invalid=Action("invalid",copy);invalid.key=valid.key;
                var failed=PackageMotionInstance.PrepareAsync(target,new AvatarCharacterPackage{id="failed-candidate",actions=new[]{valid,invalid}},File.ReadAllBytes(VrmPath),CancellationToken.None);
                while(!failed.IsCompleted)yield return null;Assert.That(failed.IsFaulted,Is.True);
                source.Sample(.5f,target.Runtime.ControlRig);
                Assert.That(Vector3.Distance(expected,head.position),Is.LessThan(.00001f),"Candidate cleanup must not unload the active clip.");
            }
            finally {source?.Dispose();sampler?.Dispose();first?.Dispose();second?.Dispose();if(target!=null)UnityEngine.Object.Destroy(target.gameObject);File.Delete(copy);}
        }

        [UnityTest]
        public IEnumerator NativeWalkingSupportsMixedPhasesHeadLayerDanceAndReturnToIdle()
        {
            var directory=Fixtures();Assert.That(File.Exists(Path.Combine(directory,"walk.bundle")),Is.True);
            var load=Vrm10.LoadPathAsync(VrmPath);while(!load.IsCompleted)yield return null;
            var target=load.GetAwaiter().GetResult();target.UpdateType=Vrm10Instance.UpdateTypes.None;PackageMotionInstance motion=null;
            try
            {
                var idle=Action("idle",Path.Combine(directory,"standby.bundle"),"loop");
                var walk=Action("walk",Path.Combine(directory,"walk.bundle"),"loop");walk.playback.enter=idle.playback.motion;walk.playback.exit=VrmaPath;
                var nod=Action("nod",VrmaPath,layer:"head");var nativeHead=Action("native-head",idle.playback.motion,layer:"head");nativeHead.playback.reference=VrmaPath;
                var dance=Action("dance",walk.playback.motion,"performance");
                var package=new AvatarCharacterPackage{id="mixed-native",actions=new[]{idle,walk,nod,nativeHead,dance},idle=new AvatarPackageIdle{@base=idle.id,variations=Array.Empty<string>()}};
                var prepare=PackageMotionInstance.PrepareAsync(target,package,File.ReadAllBytes(VrmPath),CancellationToken.None);while(!prepare.IsCompleted)yield return null;motion=prepare.GetAwaiter().GetResult();
                Assert.That(motion.RequestAction(walk.id).Outcome,Is.EqualTo(AvatarActionRequestOutcome.Started));
                motion.Tick(2.1f);var leg=target.Runtime.ControlRig.GetBoneTransform(HumanBodyBones.LeftUpperLeg);var first=leg.localRotation;
                motion.Tick(.2f);Assert.That(Quaternion.Angle(first,leg.localRotation),Is.GreaterThan(1));
                var instance=motion.GetActionInstanceId(walk.id);motion.RequestAction(nod.id);motion.Tick(.3f);
                Assert.That(motion.GetActionInstanceId(walk.id),Is.EqualTo(instance));motion.CancelAction(nod.id);
                motion.RequestAction(nativeHead.id);motion.Tick(.3f);Assert.That(motion.GetActionInstanceId(walk.id),Is.EqualTo(instance));motion.CancelAction(nativeHead.id);
                Assert.That(motion.FinishAction(walk.id),Is.True);motion.Tick(10f);Assert.That(motion.ActivePerformanceCount,Is.Zero);
                motion.BeginDance(dance.id);motion.SampleDance(dance.id,.5f);motion.Tick(.3f);Assert.That(motion.DanceActive,Is.True);
                motion.EndDance(true);motion.Tick(.3f);Assert.That(motion.DanceActive,Is.False);
                Assert.That(target.transform.position,Is.EqualTo(Vector3.zero));
            }
            finally {motion?.Dispose();UnityEngine.Object.Destroy(target.gameObject);}
        }
    }
}
#endif
