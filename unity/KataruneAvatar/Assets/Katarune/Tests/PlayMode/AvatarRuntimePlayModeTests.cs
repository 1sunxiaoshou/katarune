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
        public IEnumerator CameraGazeTracksTheCurrentCameraAndReturnsToNeutral()
        {
            var cameraRoot = Camera.main == null ? new GameObject("Gaze test camera") { tag = "MainCamera" } : null;
            if (cameraRoot != null) cameraRoot.AddComponent<Camera>();
            var camera = Camera.main;
            var previousPosition = camera.transform.position;
            var root = new GameObject("Gaze test behavior");
            try
            {
                var behavior = root.AddComponent<AvatarBehaviorController>();
                behavior.Bind(new GazeDriver());
                behavior.ApplySettings(AvatarBehaviorSettings.Default.WithGazeTracking(AvatarGazeTrackingMode.Camera));
                camera.transform.position = new Vector3(-4f, 1f, 4f);
                yield return new WaitForSecondsRealtime(1.2f);
                var frame = behavior.CurrentFrame;
                Assert.That(frame.GazeYaw + frame.HeadGaze.x, Is.GreaterThan(17.5f));
                Assert.That(frame.GazePitch + frame.HeadGaze.y, Is.GreaterThan(5f));
                camera.transform.position = new Vector3(4f, -1f, 4f);
                yield return new WaitForSecondsRealtime(1.2f);
                Assert.That(frame.GazeYaw + frame.HeadGaze.x, Is.LessThan(-17.5f));
                Assert.That(frame.GazePitch + frame.HeadGaze.y, Is.LessThan(-5f));
                behavior.ApplySettings(behavior.Settings.WithGazeTracking(AvatarGazeTrackingMode.None));
                yield return new WaitForSecondsRealtime(1.2f);
                Assert.That((new Vector2(frame.GazeYaw, frame.GazePitch) + frame.HeadGaze).magnitude, Is.LessThan(.01f));
            }
            finally
            {
                camera.transform.position = previousPosition;
                Object.Destroy(root);
                if (cameraRoot != null) Object.Destroy(cameraRoot);
            }
            yield return null;
        }

        private sealed class GazeDriver : IAvatarDriver, IAvatarGazeGeometryProvider
        {
            public bool SupportsAffect(AvatarAffectPreset preset) => true;
            public bool TryGetGazeGeometry(out AvatarGazeGeometry geometry)
            { geometry = new AvatarGazeGeometry(Vector3.zero, Quaternion.identity); return true; }
            public void Apply(AvatarPoseFrame frame) { }
            public void ResetPose() { }
            public void Dispose() { }
        }

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
                backdrop.SetBackground("cloud-observatory");
                Assert.That(backdrop.BackgroundId, Is.EqualTo("cloud-observatory"));
                Assert.That(material.GetFloat("_PictureMode"), Is.EqualTo(1f));
                Assert.That(material.GetTexture("_Picture"), Is.SameAs(Resources.Load<Texture2D>("Immersive/CloudObservatory")));
                Assert.Throws<System.ArgumentException>(() => backdrop.SetBackground("../custom.png"));
                Assert.That(backdrop.BackgroundId, Is.EqualTo("cloud-observatory"), "Invalid selections must preserve the current background.");
                backdrop.SetBackground("film");
                Assert.That(material.GetFloat("_PictureMode"), Is.Zero);
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
