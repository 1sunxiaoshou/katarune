using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using NUnit.Framework;
using UniGLTF;
using UniVRM10;
using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;
using UnityEngine.TestTools;
using Object = UnityEngine.Object;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarLocalMotionLibraryTests
    {
        private static IEnumerator RemoveAutomaticBootstrap()
        {
            var bootstrap = Object.FindFirstObjectByType<AvatarBootstrap>();
            if (bootstrap == null) yield break;
            var deadline = Time.realtimeSinceStartup + 30f;
            while (bootstrap.Runtime == null || bootstrap.Runtime.Snapshot.RuntimeState == AvatarRuntimeState.Loading)
            {
                Assert.That(Time.realtimeSinceStartup, Is.LessThan(deadline), "Automatic runtime did not finish startup.");
                yield return null;
            }
            Object.Destroy(bootstrap.gameObject);
            yield return null;
        }

        [UnityTest]
        public IEnumerator LocalDancePlaysSwitchesCancelsAndFinishes()
        {
            yield return RemoveAutomaticBootstrap();
            using var packs = new AvatarMotionPacks();
            var loading = packs.LoadAsync(AvatarMotionPacks.DefaultDirectory);
            while (!loading.IsCompleted) yield return null;
            loading.GetAwaiter().GetResult();
            var library = packs.Library;
            var path = AvatarDefaultAssets.ModelPath(Application.dataPath);
            if (!File.Exists(path)) path = System.Environment.GetEnvironmentVariable("KATARUNE_TEST_VRM_PATH");
            if (library == null || !File.Exists(path)
                || !library.TryGetAction(AvatarPresetAction.DanceDelusionAngel, out _))
                Assert.Ignore("Local dance and test model are not installed.");
            library.TryGetAction(AvatarPresetAction.DanceDelusionAngel, out var dance);
            Assert.That(dance.Clip.isHumanMotion, Is.True);
            Assert.That(dance.Clip.legacy, Is.False);
            Assert.That(dance.Duration, Is.EqualTo(13f).Within(0.04f));
            var dynamicLibrary = Object.Instantiate(library);
            library.TryGetBase(out var baseClip);
            var definitions = new List<AvatarActionDefinition>(library.Definitions)
            {
                new AvatarActionDefinition("custom.external-dance", "外部自定义舞蹈", dance.Clip),
            };
            dynamicLibrary.Configure(baseClip, definitions.ToArray(), library.ApplyFootIK);
            var task = Vrm10.LoadPathAsync(path, canLoadVrm0X: false, showMeshes: false,
                awaitCaller: new RuntimeOnlyAwaitCaller());
            while (!task.IsCompleted) yield return null;
            var model = task.GetAwaiter().GetResult();
            var rig = model.Runtime.ControlRig;
            var motion = new AvatarMotionInstance(rig.ControlRigAnimator, dynamicLibrary, null,
                CharacterRigCapabilities.HumanoidBody);
            try
            {
                yield return null;
                var graph = (PlayableGraph)typeof(AvatarMotionInstance)
                    .GetField("_graph", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(motion);
                graph.Stop();
                Step(motion, graph, 0.4f);
                var initialRoot = model.transform.position;
                var start = CapturePose(rig);
                Assert.That(motion.RequestAction("custom.external-dance").Outcome,
                    Is.EqualTo(AvatarActionRequestOutcome.Started));
                var sequence = motion.ActionSequence;
                motion.RequestAction("custom.external-dance");
                Assert.That(motion.ActionSequence, Is.EqualTo(sequence), "Repeated clicks must not restart.");
                var fingers = new[]
                {
                    HumanBodyBones.LeftThumbIntermediate, HumanBodyBones.LeftIndexIntermediate,
                    HumanBodyBones.LeftMiddleIntermediate, HumanBodyBones.LeftRingIntermediate,
                    HumanBodyBones.LeftLittleIntermediate, HumanBodyBones.RightThumbIntermediate,
                    HumanBodyBones.RightIndexIntermediate, HumanBodyBones.RightMiddleIntermediate,
                    HumanBodyBones.RightRingIntermediate, HumanBodyBones.RightLittleIntermediate,
                };
                var fingerStart = new Quaternion[fingers.Length];
                var rawFingerStart = new Quaternion[fingers.Length];
                var fingerMovement = new float[fingers.Length];
                var rawFingerMovement = new float[fingers.Length];
                var movement = 0f;
                for (var frame = 0; frame < 120; frame++)
                {
                    Step(motion, graph, 1f / 30f);
                    model.Runtime.Process();
                    for (var i = 0; i < fingers.Length; i++)
                    {
                        var control = rig.GetBoneTransform(fingers[i]);
                        var raw = model.Humanoid.GetBoneTransform(fingers[i]);
                        Assert.That(control, Is.Not.Null, fingers[i].ToString());
                        Assert.That(raw, Is.Not.Null, fingers[i].ToString());
                        if (frame == 15) { fingerStart[i] = control.localRotation; rawFingerStart[i] = raw.localRotation; }
                        if (frame <= 15) continue;
                        fingerMovement[i] = Mathf.Max(fingerMovement[i], Quaternion.Angle(fingerStart[i], control.localRotation));
                        rawFingerMovement[i] = Mathf.Max(rawFingerMovement[i], Quaternion.Angle(rawFingerStart[i], raw.localRotation));
                    }
                    var pose = CapturePose(rig);
                    for (var bone = 0; bone < pose.Length; bone++)
                    {
                        Assert.That(float.IsFinite(pose[bone].x + pose[bone].y + pose[bone].z + pose[bone].w), Is.True);
                        movement = Mathf.Max(movement, Quaternion.Angle(start[bone], pose[bone]));
                    }
                }
                Assert.That(movement, Is.GreaterThan(10f), "Dance must animate the rig.");
                for (var i = 0; i < fingers.Length; i++)
                {
                    Assert.That(fingerMovement[i], Is.GreaterThan(5f), "Control rig finger: " + fingers[i]);
                    Assert.That(rawFingerMovement[i], Is.GreaterThan(5f), "Visible model finger: " + fingers[i]);
                    Debug.Log($"KATARUNE_FINGER_VERIFIED bone={fingers[i]} control={fingerMovement[i]:F2} raw={rawFingerMovement[i]:F2}");
                }
                var beforeSwitch = CapturePose(rig);
                motion.RequestAction(AvatarPresetAction.RightHandOffer);
                Step(motion, graph, 0f);
                AssertPoseUnchanged(rig, beforeSwitch);
                Step(motion, graph, 0.3f);
                Assert.That(motion.CurrentAction, Is.EqualTo(AvatarPresetAction.RightHandOffer));
                motion.RequestAction("custom.external-dance");
                Step(motion, graph, 0.4f);
                motion.CancelAction();
                Step(motion, graph, 0.3f);
                Assert.That(motion.CurrentActionId, Is.Null);
                motion.RequestAction("custom.external-dance");
                for (var frame = 0; frame < 410; frame++) Step(motion, graph, 1f / 30f);
                Assert.That(motion.CurrentActionId, Is.Null, "Completed dance must return to breathing.");
                AssertStandingLegs(rig);
                Assert.That(Vector3.Distance(initialRoot, model.transform.position), Is.LessThan(0.0001f));
            }
            finally
            {
                motion.Dispose();
                Object.Destroy(dynamicLibrary);
                Object.Destroy(model.gameObject);
            }
            yield return null;
        }

        [UnityTest]
        public IEnumerator LocalLibraryAnimatesSwitchesStopsAndReturnsToBreathing()
        {
            yield return RemoveAutomaticBootstrap();
            using var packs = new AvatarMotionPacks();
            var loading = packs.LoadAsync(AvatarMotionPacks.DefaultDirectory);
            while (!loading.IsCompleted) yield return null;
            loading.GetAwaiter().GetResult();
            var library = packs.Library;
            var path = AvatarDefaultAssets.ModelPath(Application.dataPath);
            if (!File.Exists(path)) path = System.Environment.GetEnvironmentVariable("KATARUNE_TEST_VRM_PATH");
            if (library == null || !File.Exists(path)
                || !library.TryGetAction(AvatarPresetAction.RightHandOffer, out _))
                Assert.Ignore("Local VRMA motion library is not installed.");
            var task = Vrm10.LoadPathAsync(path, canLoadVrm0X: false, showMeshes: false,
                awaitCaller: new RuntimeOnlyAwaitCaller());
            while (!task.IsCompleted) yield return null;
            var model = task.GetAwaiter().GetResult();
            var rig = model.Runtime.ControlRig;
            var motion = new AvatarMotionInstance(rig.ControlRigAnimator, library, null,
                CharacterRigCapabilities.HumanoidBody);
            try
            {
                // Match the loader's hidden-candidate -> committed-model lifecycle.
                model.gameObject.SetActive(false);
                yield return null;
                model.gameObject.SetActive(true);
                yield return null;
                yield return null;
                Assert.That(library.ApplyFootIK, Is.False, "FK-only VRMA clips have no foot IK goals.");
                AssertStandingLegs(rig);
                var arm = rig.GetBoneTransform(HumanBodyBones.LeftUpperArm);
                Assert.That(Mathf.DeltaAngle(0, arm.localEulerAngles.z), Is.InRange(55f, 62f),
                    "Baking must preserve the calibrated resting arm angle.");
                var idleArmRotations = new List<Quaternion>();
                var wrist = rig.GetBoneTransform(HumanBodyBones.LeftHand);
                var wristStart = wrist.localRotation;
                var idleMovement = 0f;
                var idleElapsed = 0f;
                library.TryGetBase(out var baseClip);
                while (idleElapsed < baseClip.length + 0.1f)
                {
                    yield return null;
                    motion.Tick(Time.deltaTime);
                    idleElapsed += Time.deltaTime;
                    AssertStandingLegs(rig);
                    idleArmRotations.Add(arm.localRotation);
                    idleMovement = Mathf.Max(idleMovement, Quaternion.Angle(wristStart, wrist.localRotation));
                }
                Assert.That(idleMovement, Is.GreaterThan(1f), "Breathing must not be a static pose.");
                var initialRootPosition = model.transform.position;
                var actions = new[] { AvatarPresetAction.RightHandOffer, AvatarPresetAction.RightHandOpen,
                    AvatarPresetAction.RightHandToChest, AvatarPresetAction.LeftHandOpenTwice };
                foreach (var action in actions)
                {
                    Assert.That(library.TryGetAction(action, out var definition), Is.True);
                    Assert.That(definition.Clip.legacy, Is.False);
                    Assert.That(definition.Clip.isHumanMotion, Is.True);
                    var hand = rig.GetBoneTransform(action == AvatarPresetAction.LeftHandOpenTwice
                        ? HumanBodyBones.LeftLowerArm : HumanBodyBones.RightLowerArm);
                    var start = hand.localRotation;
                    var maximumChange = 0f;
                    Assert.That(motion.RequestAction(action).Outcome, Is.EqualTo(AvatarActionRequestOutcome.Started));
                    var elapsed = 0f;
                    while (elapsed < definition.Duration + 0.5f)
                    {
                        yield return null;
                        motion.Tick(Time.deltaTime);
                        elapsed += Time.deltaTime;
                        AssertStandingLegs(rig);
                        maximumChange = Mathf.Max(maximumChange, Quaternion.Angle(start, hand.localRotation));
                    }
                    Assert.That(maximumChange, Is.GreaterThan(5f), action + " must visibly animate.");
                    Assert.That(motion.CurrentAction, Is.Null, "One-shot should return to the base loop.");
                    var nearestIdleAngle = 180f;
                    foreach (var rotation in idleArmRotations)
                        nearestIdleAngle = Mathf.Min(nearestIdleAngle, Quaternion.Angle(arm.localRotation, rotation));
                    Assert.That(nearestIdleAngle, Is.LessThan(0.5f), action + " should restore the breathing pose range.");
                }
                Assert.That(AvatarMotionInstance.ActionTransitionSeconds, Is.EqualTo(0.25f));
                motion.RequestAction(actions[0]);
                for (var frame = 0; frame < 12; frame++) { yield return null; motion.Tick(Time.deltaTime); }
                motion.RequestAction(actions[2]);
                Assert.That(motion.CurrentAction, Is.EqualTo(actions[2]));
                motion.CancelAction();
                var cancelElapsed = 0f;
                while (cancelElapsed < 0.5f)
                {
                    yield return null;
                    motion.Tick(Time.deltaTime);
                    cancelElapsed += Time.deltaTime;
                }
                Assert.That(motion.CurrentAction, Is.Null);
                Assert.That(Vector3.Distance(initialRootPosition, model.transform.position), Is.LessThan(0.0001f));

                // Use manual evaluation for deterministic zero-time continuity checks.
                // Animator.playableGraph exposes its controller graph, not this external output graph.
                var graph = (PlayableGraph)typeof(AvatarMotionInstance)
                    .GetField("_graph", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(motion);
                var mixer = (AnimationMixerPlayable)graph.GetOutput(0).GetSourcePlayable().GetInput(0);
                graph.Stop();
                motion.RequestAction(actions[0]);
                Step(motion, graph, 0.4f);
                var a = FindClip(mixer, GetClip(library, actions[0]));
                Assert.That(Weight(mixer, a), Is.EqualTo(1f).Within(0.0001f));
                motion.RequestAction(actions[1]);
                Step(motion, graph, 0.08f);
                var b = FindClip(mixer, GetClip(library, actions[1]));
                Assert.That(Weight(mixer, a), Is.InRange(0.1f, 0.9f));
                Assert.That(Weight(mixer, b), Is.InRange(0.1f, 0.9f));
                var aWeight = Weight(mixer, a);
                var bWeight = Weight(mixer, b);
                var pose = CapturePose(rig);
                motion.RequestAction(actions[2]);
                Step(motion, graph, 0f);
                Assert.That(Weight(mixer, a), Is.EqualTo(aWeight).Within(0.0001f));
                Assert.That(Weight(mixer, b), Is.EqualTo(bWeight).Within(0.0001f));
                AssertPoseUnchanged(rig, pose);
                Step(motion, graph, 0.06f);
                var c = FindClip(mixer, GetClip(library, actions[2]));
                Assert.That(Weight(mixer, a), Is.GreaterThan(0f));
                Assert.That(Weight(mixer, b), Is.GreaterThan(0f));
                Assert.That(Weight(mixer, c), Is.GreaterThan(0f));
                Assert.That(Weight(mixer, a) + Weight(mixer, b) + Weight(mixer, c), Is.EqualTo(1f).Within(0.0001f));

                var cTime = c.GetTime();
                var cWeight = Weight(mixer, c);
                var sequence = motion.ActionSequence;
                pose = CapturePose(rig);
                motion.RequestAction(actions[2]);
                graph.Evaluate(0f);
                Assert.That(c.GetTime(), Is.EqualTo(cTime).Within(0.0001f), "Same-action clicks must not rewind.");
                Assert.That(Weight(mixer, c), Is.EqualTo(cWeight).Within(0.0001f));
                Assert.That(motion.ActionSequence, Is.EqualTo(sequence));
                AssertPoseUnchanged(rig, pose);

                motion.CancelAction();
                Step(motion, graph, 0.06f);
                pose = CapturePose(rig);
                motion.RequestAction(actions[3]);
                graph.Evaluate(0f);
                AssertPoseUnchanged(rig, pose);
                Step(motion, graph, 0.3f);
                Assert.That(Weight(mixer, FindClip(mixer, GetClip(library, actions[3]))),
                    Is.EqualTo(1f).Within(0.0001f));
                AssertStandingLegs(rig);
                // Restart a completed action while its old instance is still fading out.
                var completed = FindClip(mixer, GetClip(library, actions[3]));
                Step(motion, graph, completed.GetAnimationClip().length);
                Step(motion, graph, 0.06f);
                pose = CapturePose(rig);
                motion.RequestAction(actions[3]);
                graph.Evaluate(0f);
                AssertPoseUnchanged(rig, pose);
                Step(motion, graph, 0.3f);
                Assert.That(motion.CurrentAction, Is.EqualTo(actions[3]),
                    "Replaying an ended action must start a fresh fade, not immediately finish again.");
                motion.CancelAction();
                Step(motion, graph, 0.3f);
                Assert.That(motion.CurrentAction, Is.Null);
                motion.Dispose();
                motion.Dispose();
                yield return null;
                Assert.That(graph.IsValid(), Is.False, "Disposing a model must destroy its graph.");
            }
            finally
            {
                motion.Dispose();
                Object.Destroy(model.gameObject);
            }
            yield return null;
        }

        private static void Step(AvatarMotionInstance motion, PlayableGraph graph, float deltaTime)
        {
            graph.Evaluate(deltaTime);
            motion.Tick(deltaTime);
            graph.Evaluate(0f);
        }

        private static AnimationClipPlayable FindClip(AnimationMixerPlayable mixer, AnimationClip clip)
        {
            for (var input = 0; input < mixer.GetInputCount(); input++)
            {
                var playable = (AnimationClipPlayable)mixer.GetInput(input);
                if (playable.GetAnimationClip() == clip) return playable;
            }
            Assert.Fail("Clip is not connected: " + clip.name);
            return default;
        }

        private static float Weight(AnimationMixerPlayable mixer, AnimationClipPlayable clip)
        {
            for (var input = 0; input < mixer.GetInputCount(); input++)
                if (mixer.GetInput(input).Equals((Playable)clip)) return mixer.GetInputWeight(input);
            Assert.Fail("Playable is not connected.");
            return 0f;
        }

        private static AnimationClip GetClip(AvatarMotionLibrary library, AvatarPresetAction action)
        {
            Assert.That(library.TryGetAction(action, out var definition), Is.True);
            return definition.Clip;
        }

        private static Quaternion[] CapturePose(Vrm10RuntimeControlRig rig)
        {
            var pose = new Quaternion[(int)HumanBodyBones.LastBone];
            for (var i = 0; i < pose.Length; i++)
            {
                var bone = rig.GetBoneTransform((HumanBodyBones)i);
                pose[i] = bone != null ? bone.localRotation : Quaternion.identity;
            }
            return pose;
        }

        private static void AssertPoseUnchanged(Vrm10RuntimeControlRig rig, Quaternion[] pose)
        {
            for (var i = 0; i < pose.Length; i++)
            {
                var bone = rig.GetBoneTransform((HumanBodyBones)i);
                if (bone != null)
                    Assert.That(Quaternion.Angle(pose[i], bone.localRotation), Is.LessThan(0.1f),
                        ((HumanBodyBones)i) + " jumped at a zero-time transition.");
            }
        }

        private static void AssertStandingLegs(Vrm10RuntimeControlRig rig)
        {
            foreach (var bone in new[] { HumanBodyBones.LeftLowerLeg, HumanBodyBones.RightLowerLeg })
                Assert.That(Quaternion.Angle(Quaternion.identity, rig.GetBoneTransform(bone).localRotation),
                    Is.LessThan(35f), bone + " must not fold up when playing an FK-only clip.");
            var hip = rig.GetBoneTransform(HumanBodyBones.Hips);
            var foot = rig.GetBoneTransform(HumanBodyBones.LeftFoot);
            Assert.That(hip.position.y - foot.position.y, Is.GreaterThan(0.5f), "Feet should stay below the hips.");
        }
    }
}
