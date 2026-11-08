using System.Collections;
using System.Threading;
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
        public IEnumerator BackgroundSwitchesReuseResourcesAndReleaseThemOnDestruction()
        {
            var root = new GameObject("Background lifecycle test");
            Material material = null;
            Mesh mesh = null;
            try
            {
                var backdrop = root.AddComponent<AvatarImmersiveBackdrop>();
                backdrop.SetVisible(true);
                var renderer = root.GetComponentInChildren<MeshRenderer>(true);
                material = renderer.sharedMaterial;
                mesh = renderer.GetComponent<MeshFilter>().sharedMesh;
                backdrop.Advance(.45f);
                Assert.That(renderer.gameObject.activeSelf, Is.True);
                Assert.That(material.GetFloat("_Opacity"), Is.EqualTo(.5f).Within(.001f));
                backdrop.SetVisible(false);
                backdrop.Advance(.225f);
                Assert.That(material.GetFloat("_Opacity"), Is.InRange(0f, .5f));
                backdrop.SetVisible(true);
                backdrop.Advance(.9f);
                Assert.That(material.GetFloat("_Opacity"), Is.EqualTo(1f));
                Assert.That(root.GetComponentInChildren<MeshRenderer>().sharedMaterial, Is.SameAs(material));
                backdrop.SetVisible(false);
                // The background clock must complete its fade without camera updates.
                yield return new WaitForSecondsRealtime(1f);
                Assert.That(renderer.gameObject.activeSelf, Is.False);
                Assert.That(root.transform.childCount, Is.EqualTo(1));
            }
            finally { Object.Destroy(root); }
            yield return null;
            Assert.That(material == null, Is.True, "Destroying the background must release its material.");
            Assert.That(mesh == null, Is.True, "Destroying the background must release its mesh.");
        }

        [UnityTest]
        public IEnumerator LocalDefaultVrmLoadsThroughRuntimeWhenPresent()
        {
            var modelPath = AvatarBootstrap.ResolveInitialModelPath(null, Application.dataPath);
            if (string.IsNullOrWhiteSpace(modelPath) || !File.Exists(modelPath))
            {
                Assert.Ignore("Restore avatar/model.vrm in the default character package to run the default model smoke test.");
            }

            var facade = CreateLocalRuntime("Local Default Model Smoke", out var gameObject);
            var load = facade.LoadAsync(modelPath);
            while (!load.IsCompleted) yield return null;

            Assert.That(load.Result.Outcome, Is.EqualTo(AvatarLoadOutcome.Loaded), load.Result.Error);
            Assert.That(facade.Snapshot.RuntimeState, Is.EqualTo(AvatarRuntimeState.Ready));
            Assert.That(facade.Snapshot.Model?.Path, Is.EqualTo(Path.GetFullPath(modelPath)));
            Assert.That(facade.Snapshot.Model?.Name, Is.EqualTo("model"));
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
    }
}
