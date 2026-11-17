using System.Collections;
using System.Threading;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
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
        public IEnumerator IslandBackgroundHidesReusesAndReleasesItsWorldGeometry()
        {
            var root = new GameObject("Island background lifecycle test");
            GameObject island = null;
            Material[] materials = null;
            Mesh[] meshes = null;
            try
            {
                var backdrop = root.AddComponent<AvatarImmersiveBackdrop>();
                backdrop.SetBackground("island-coast");
                island = Resources.FindObjectsOfTypeAll<GameObject>().Single(value => value.name == "Katarune island coast" && value.scene.IsValid());
                Assert.That(island.activeSelf, Is.False, "Selecting a background must preserve transparent desktop mode.");
                backdrop.SetStage(new Vector3(0, .25f, 0), 3.3f);
                backdrop.SetVisible(true);
                backdrop.Advance(1);
                Assert.That(island.activeSelf, Is.True);
                Assert.That(island.transform.position.y, Is.EqualTo(.25f));
                Assert.That(island.transform.localScale.x, Is.EqualTo(2));
                materials = island.GetComponentsInChildren<MeshRenderer>().Select(value => value.sharedMaterial).ToArray();
                meshes = island.GetComponentsInChildren<MeshFilter>().Select(value => value.sharedMesh).ToArray();
                var baked = Resources.Load<GameObject>("Immersive/IslandCoast");
                Assert.That(materials.Length, Is.EqualTo(baked.GetComponentsInChildren<MeshRenderer>(true).Length));
                Assert.That(meshes, Is.EqualTo(baked.GetComponentsInChildren<MeshFilter>(true).Select(value => value.sharedMesh).ToArray()));
                Assert.That(materials.Intersect(baked.GetComponentsInChildren<MeshRenderer>(true).Select(value => value.sharedMaterial)), Is.Empty,
                    "Animation must not mutate baked material assets.");
                Assert.That(island.GetComponentInChildren<MeshCollider>(), Is.Not.Null, "Baked beach supports movable props.");
                Assert.That(island.GetComponentsInChildren<AvatarIslandProp>(), Is.Not.Empty);
                backdrop.SetBackground("film");
                Assert.That(island.activeSelf, Is.False);
                backdrop.SetBackground("island-coast");
                Assert.That(island.GetComponentsInChildren<MeshFilter>().Select(value => value.sharedMesh), Is.EqualTo(meshes));
                Assert.Throws<System.ArgumentException>(() => backdrop.SetBackground("unknown"));
                Assert.That(backdrop.BackgroundId, Is.EqualTo("island-coast"));
                backdrop.SetVisible(false);
                backdrop.Advance(1);
                Assert.That(island.activeSelf, Is.False);
            }
            finally { Object.Destroy(root); }
            yield return null;
            Assert.That(island == null, Is.True);
            Assert.That(materials.All(value => value == null), Is.True);
            Assert.That(meshes.All(value => value != null), Is.True, "Shared baked meshes belong to the prefab, not the background instance.");
        }

        [UnityTest]
        public IEnumerator IslandBackgroundBuoyancyFloatsAndStopsWhenHidden()
        {
            var root = new GameObject("Island background buoyancy test");
            try
            {
                var backdrop = root.AddComponent<AvatarImmersiveBackdrop>();
                backdrop.SetBackground("island-coast");
                backdrop.SetVisible(true);
                backdrop.Advance(1);
                var island = Resources.FindObjectsOfTypeAll<GameObject>().Single(value => value.name == "Katarune island coast" && value.scene.IsValid());
                var body = island.GetComponentInChildren<AvatarIslandBuoyancy>().GetComponent<Rigidbody>();
                var minimum = float.PositiveInfinity;
                var maximum = float.NegativeInfinity;
                for (var i = 0; i < 180; i++)
                {
                    yield return new WaitForFixedUpdate();
                    if (i < 60) continue;
                    var height = island.transform.InverseTransformPoint(body.position).y;
                    minimum = Mathf.Min(minimum, height);
                    maximum = Mathf.Max(maximum, height);
                }
                Assert.That(minimum, Is.GreaterThan(AvatarIslandWater.SeaLevel - .2f), "Driftwood must remain afloat.");
                Assert.That(maximum, Is.LessThan(AvatarIslandWater.SeaLevel + .25f), "Buoyancy must remain stable.");
                Assert.That(maximum - minimum, Is.GreaterThan(.01f), "The rigidbody must respond to waves.");
                Assert.That(Vector3.Dot(body.transform.up, Vector3.up), Is.GreaterThan(.7f));
                backdrop.SetVisible(false);
                backdrop.Advance(1);
                var position = body.position;
                yield return new WaitForSecondsRealtime(.25f);
                Assert.That(Vector3.Distance(body.position, position), Is.LessThan(.001f), "Hidden scenery must stop physics.");
            }
            finally { Object.Destroy(root); }
            yield return null;
        }

        [UnityTest]
        public IEnumerator IslandBackgroundRestoresLightingAndCameraAfterSwitchAndDisposal()
        {
            var cameraRoot = new GameObject("Island lighting test camera");
            var originalLightRoot = new GameObject("Island original light");
            var originalLight = originalLightRoot.AddComponent<Light>();
            originalLight.type = LightType.Directional;
            var initialSun = RenderSettings.sun;
            var initialAmbient = RenderSettings.ambientMode;
            var initialSky = RenderSettings.ambientSkyColor;
            var camera = cameraRoot.AddComponent<Camera>();
            camera.enabled = false;
            var cameraData = camera.GetUniversalAdditionalCameraData();
            cameraData.renderPostProcessing = false;
            cameraData.requiresDepthOption = CameraOverrideOption.Off;
            AvatarImmersiveBackdrop backdrop = null;
            VolumeProfile profile = null;
            try
            {
                backdrop = cameraRoot.AddComponent<AvatarImmersiveBackdrop>();
                backdrop.SetBackground("island-coast");
                Assert.That(originalLight.enabled, Is.True, "Hidden island must not change scene lights.");
                Assert.That(cameraData.renderPostProcessing, Is.False);
                backdrop.SetVisible(true);
                backdrop.Advance(1);
                Assert.That(originalLight.enabled, Is.False);
                Assert.That(RenderSettings.sun.name, Is.EqualTo("Island afternoon sun"));
                Assert.That(RenderSettings.sun.shadows, Is.EqualTo(LightShadows.Soft));
                Assert.That(cameraData.renderPostProcessing, Is.True);
                Assert.That(cameraData.requiresDepthOption, Is.EqualTo(CameraOverrideOption.On));
                var island = Resources.FindObjectsOfTypeAll<GameObject>().Single(value => value.name == "Katarune island coast" && value.scene.IsValid());
                profile = island.GetComponent<Volume>().sharedProfile;
                Assert.That(profile.TryGet<Bloom>(out var bloom) && bloom.intensity.value > 0, Is.True);
                backdrop.SetBackground("film");
                Assert.That(originalLight.enabled, Is.True);
                Assert.That(RenderSettings.sun == initialSun, Is.True);
                Assert.That(RenderSettings.ambientMode, Is.EqualTo(initialAmbient));
                Assert.That(RenderSettings.ambientSkyColor, Is.EqualTo(initialSky));
                Assert.That(cameraData.renderPostProcessing, Is.False);
                Assert.That(cameraData.requiresDepthOption, Is.EqualTo(CameraOverrideOption.Off));
                backdrop.SetBackground("island-coast");
                Assert.That(cameraData.renderPostProcessing, Is.True);
            }
            finally { Object.DestroyImmediate(cameraRoot); Object.DestroyImmediate(originalLightRoot); }
            yield return null;
            Assert.That(RenderSettings.sun == initialSun, Is.True);
            Assert.That(RenderSettings.ambientMode, Is.EqualTo(initialAmbient));
            Assert.That(RenderSettings.ambientSkyColor, Is.EqualTo(initialSky));
            Assert.That(profile == null, Is.True, "The owned runtime volume profile must be released.");
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
