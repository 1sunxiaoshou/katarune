using System.Collections;
using System;
using System.Threading;
using System.Threading.Tasks;
using System.IO;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using Object = UnityEngine.Object;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarRuntimePlayModeTests
    {
        [UnityTest]
        public IEnumerator LocalDefaultVrmLoadsThroughRuntimeWhenPresent()
        {
            var modelPath = AvatarBootstrap.ResolveInitialModelPath(null, Application.dataPath);
            if (string.IsNullOrWhiteSpace(modelPath) || !File.Exists(modelPath))
            {
                Assert.Ignore("Place a local default-avatar.vrm to run the default model smoke test.");
            }

            var facade = CreateLocalRuntime("Local Default Model Smoke", out var gameObject);
            var load = facade.LoadAsync(modelPath);
            while (!load.IsCompleted) yield return null;

            Assert.That(load.Result.Outcome, Is.EqualTo(AvatarLoadOutcome.Loaded), load.Result.Error);
            Assert.That(facade.Snapshot.RuntimeState, Is.EqualTo(AvatarRuntimeState.Ready));
            Assert.That(facade.Snapshot.Model?.Path, Is.EqualTo(Path.GetFullPath(modelPath)));
            Assert.That(facade.Snapshot.Model?.Name, Is.EqualTo("default-avatar"));
            Assert.That(facade.Snapshot.Model?.Height, Is.GreaterThan(0f));
            if (Resources.Load<AvatarMotionLibrary>("AvatarMotionLibrary") != null)
            {
                yield return null;
                yield return null;
                Assert.That(facade.Snapshot.Motion.LibraryAvailable, Is.True);
                Assert.That(facade.Snapshot.Motion.AuthoredBaseActive, Is.True);
                Assert.That(facade.CurrentPose.HasAuthoredBodyPose, Is.True);
                Assert.That(facade.CurrentPose.ProceduralArmWeight, Is.Zero);
            }

            facade.Dispose();
            Object.Destroy(gameObject);
            yield return null;
        }

        [UnityTest]
        public IEnumerator LocalPresetMotionSmokeUsesFacadeWhitelist()
        {
            var modelPath = Environment.GetEnvironmentVariable("KATARUNE_TEST_VRM_PATH");
            if (string.IsNullOrWhiteSpace(modelPath) || !File.Exists(modelPath))
            {
                Assert.Ignore("Set KATARUNE_TEST_VRM_PATH to run the local VRM motion smoke test.");
            }

            var facade = CreateLocalRuntime("Local Motion Smoke", out var gameObject);

            var load = facade.LoadAsync(modelPath);
            while (!load.IsCompleted) yield return null;
            Assert.That(load.Result.Outcome, Is.EqualTo(AvatarLoadOutcome.Loaded), load.Result.Error);

            foreach (AvatarPresetAction action in Enum.GetValues(typeof(AvatarPresetAction)))
            {
                if (!facade.Snapshot.Capabilities.SupportsAction(action)) continue;
                Assert.That(facade.RequestAction(action).Outcome, Is.EqualTo(AvatarActionRequestOutcome.Started));
                yield return null;
                yield return null;
                Assert.That(facade.Snapshot.Motion.CurrentAction, Is.EqualTo(action));
                Assert.That(facade.CurrentPose.HasAuthoredBodyPose, Is.True);
                Assert.That(facade.CurrentPose.ProceduralBodyWeight, Is.LessThan(0.45f));
                Assert.That(facade.CurrentPose.ProceduralArmWeight, Is.Zero);
            }

            facade.CancelAction();
            yield return new WaitForSeconds(0.3f);
            Assert.That(facade.Snapshot.Motion.CurrentAction, Is.Null);

            facade.Dispose();
            Object.Destroy(gameObject);
            yield return null;
        }

        private static AvatarRuntimeFacade CreateLocalRuntime(string name, out GameObject gameObject)
        {
            gameObject = new GameObject(name) { tag = "MainCamera" };
            gameObject.AddComponent<Camera>();
            var sceneRig = gameObject.AddComponent<AvatarSceneRig>();
            sceneRig.Configure(false);
            var behavior = gameObject.AddComponent<AvatarBehaviorController>();
            var motions = gameObject.AddComponent<AvatarMotionController>();
            motions.Configure();
            behavior.SetMotionSource(motions);
            var visuals = gameObject.AddComponent<AvatarVisualController>();
            visuals.Configure();
            var session = new AvatarRuntimeSession(
                new UniVrmAvatarLoader(visuals, motions),
                sceneRig,
                behavior,
                visuals,
                motions,
                CancellationToken.None);
            return new AvatarRuntimeFacade(
                session,
                behavior,
                visuals,
                sceneRig,
                motions,
                new AvatarPresentationSettings(false));
        }

        private sealed class RecordingAvatarDriver : IAvatarDriver
        {
            public int ApplyCount { get; private set; }
            public AvatarPoseFrame LastFrame { get; private set; }

            public bool SupportsAffect(AvatarAffectPreset preset) => true;

            public void Apply(AvatarPoseFrame frame)
            {
                ApplyCount += 1;
                LastFrame = frame;
            }

            public void ResetPose()
            {
            }

            public void Dispose()
            {
            }
        }

    }
}
