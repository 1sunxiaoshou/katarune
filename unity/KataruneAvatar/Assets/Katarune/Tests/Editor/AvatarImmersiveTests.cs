using System.Reflection;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarImmersiveTests
    {
        [TestCase(1920, 1080)]
        [TestCase(1080, 1920)]
        public void OutputProjectionPreservesSquarePixelGeometry(int width, int height)
        {
            var cameraObject = new GameObject("Output projection test camera");
            try
            {
                var camera = cameraObject.AddComponent<Camera>();
                AvatarSceneRig.ConfigurePhysicalProjection(camera, width / (float)height);
                camera.fieldOfView = 30f;
                var left = camera.WorldToViewportPoint(new Vector3(-.5f, 0f, 5f));
                var right = camera.WorldToViewportPoint(new Vector3(.5f, 0f, 5f));
                var bottom = camera.WorldToViewportPoint(new Vector3(0f, -.5f, 5f));
                var top = camera.WorldToViewportPoint(new Vector3(0f, .5f, 5f));
                var pixelWidth = (right.x - left.x) * width;
                var pixelHeight = (top.y - bottom.y) * height;
                Assert.That(pixelWidth / pixelHeight, Is.EqualTo(1f).Within(.001f),
                    "A world-space square must remain square in either output orientation.");
            }
            finally
            {
                Object.DestroyImmediate(cameraObject);
            }
        }

        [Test]
        public void ScreenSizeRefreshPreservesLiveProjectionAndResumesDesktopProjectionAfterStop()
        {
            var cameraObject = new GameObject("Live resize test camera");
            var camera = cameraObject.AddComponent<Camera>();
            var rig = cameraObject.AddComponent<AvatarSceneRig>();
            var avatar = GameObject.CreatePrimitive(PrimitiveType.Cube);
            try
            {
                rig.Configure(true);
                rig.Frame(avatar);
                var screenAspect = Screen.width / Mathf.Max(1f, Screen.height);
                var outputAspect = screenAspect < 1f ? 16f / 9f : 9f / 16f;
                AvatarSceneRig.ConfigurePhysicalProjection(camera, outputAspect);
                var outputSensor = camera.sensorSize;
                var previousScreenSize = typeof(AvatarSceneRig).GetField("_lastScreenSize", BindingFlags.Instance | BindingFlags.NonPublic);
                var lateUpdate = typeof(AvatarSceneRig).GetMethod("LateUpdate", BindingFlags.Instance | BindingFlags.NonPublic);
                Assert.That(previousScreenSize, Is.Not.Null);
                Assert.That(lateUpdate, Is.Not.Null);
                rig.LiveOutputActive = true;
                // Simulate a pending native-window size change without changing the Editor's own resolution.
                previousScreenSize.SetValue(rig, new Vector2Int(-1, -1));
                lateUpdate.Invoke(rig, null);
                Assert.That(camera.aspect, Is.EqualTo(outputAspect).Within(.001f));
                Assert.That(camera.sensorSize, Is.EqualTo(outputSensor));
                rig.LiveOutputActive = false;
                previousScreenSize.SetValue(rig, new Vector2Int(-1, -1));
                lateUpdate.Invoke(rig, null);
                Assert.That(camera.aspect, Is.EqualTo(screenAspect).Within(.001f),
                    "The desktop camera must follow its window again once live output stops.");
            }
            finally
            {
                Object.DestroyImmediate(cameraObject);
                Object.DestroyImmediate(avatar);
            }
        }

        [Test]
        public void PresetsBlendFromCurrentCameraAndRestoreDesktopComposition()
        {
            var cameraObject = new GameObject("Immersive test camera");
            var camera = cameraObject.AddComponent<Camera>();
            camera.fieldOfView = 30f;
            var rig = cameraObject.AddComponent<AvatarSceneRig>();
            var avatar = GameObject.CreatePrimitive(PrimitiveType.Cube);
            avatar.transform.localScale = new Vector3(.7f, 2f, .4f);
            try
            {
                rig.Configure(true);
                var bounds = rig.Frame(avatar);
                rig.SetDesktopPose(25f, 4f);
                rig.AdvanceShowcaseMotion(1f);
                var original = rig.CaptureFraming();
                rig.SetPresentationMode(true, "overhead");
                Assert.That(camera.transform.position, Is.EqualTo(original.CameraPosition));
                rig.AdvancePresentation(.45f);
                Assert.That(Vector3.Distance(camera.transform.position, original.CameraPosition), Is.GreaterThan(.01f));
                rig.AdvancePresentation(.45f);
                var overhead = camera.transform.position;
                Assert.That(camera.lensShift, Is.EqualTo(Vector2.zero));
                Assert.That(overhead.y, Is.GreaterThan(bounds.center.y));
                var center = camera.WorldToViewportPoint(bounds.center);
                Assert.That(center.x, Is.EqualTo(.5f).Within(.01f));
                Assert.That(center.y, Is.GreaterThan(.25f).And.LessThan(.5f));
                rig.SetPresentationMode(true, "closeup");
                rig.AdvancePresentation(.2f);
                var interrupted = camera.transform.position;
                rig.SetPresentationMode(true, "center");
                Assert.That(camera.transform.position, Is.EqualTo(interrupted));
                rig.AdvancePresentation(.9f);
                rig.SetPresentationMode(false, "center");
                rig.AdvancePresentation(.9f);
                Assert.That(Vector3.Distance(camera.transform.position, original.CameraPosition), Is.LessThan(.001f));
                Assert.That(Quaternion.Angle(camera.transform.rotation, original.CameraRotation), Is.LessThan(.01f));
                Assert.That(camera.lensShift, Is.EqualTo(original.CameraLensShift));
                Assert.That(camera.fieldOfView, Is.EqualTo(original.CameraFieldOfView).Within(.001f));
                Assert.That(rig.DesktopYaw, Is.EqualTo(25f));
                Assert.That(rig.DesktopCenter, Is.EqualTo(new Vector2(.78f,.5f)));
                Assert.That(rig.DesktopHeight, Is.EqualTo(.65f));
            }
            finally
            {
                Object.DestroyImmediate(cameraObject);
                Object.DestroyImmediate(avatar);
            }
        }

        [Test]
        public void FailedModelReplacementKeepsTheOriginalDesktopLens()
        {
            var cameraObject = new GameObject("Rollback test camera");
            var camera = cameraObject.AddComponent<Camera>();
            camera.fieldOfView = 30f;
            var rig = cameraObject.AddComponent<AvatarSceneRig>();
            var avatar = GameObject.CreatePrimitive(PrimitiveType.Cube);
            var replacement = GameObject.CreatePrimitive(PrimitiveType.Cube);
            try
            {
                avatar.transform.localScale = new Vector3(.5f,2f,.5f);
                replacement.transform.localScale = new Vector3(3f,1f,2f);
                rig.Configure(true);
                rig.Frame(avatar);
                var desktop = rig.CaptureFraming();
                rig.SetPresentationMode(true, "closeup");
                rig.AdvancePresentation(.9f);
                var previous = rig.CaptureFraming();
                rig.Frame(replacement);
                rig.RestoreFraming(previous);
                rig.SetPresentationMode(false, "closeup");
                rig.AdvancePresentation(.9f);
                Assert.That(camera.fieldOfView, Is.EqualTo(desktop.CameraFieldOfView).Within(.001f));
                Assert.That(camera.lensShift, Is.EqualTo(desktop.CameraLensShift));
                Assert.That(Vector3.Distance(camera.transform.position, desktop.CameraPosition), Is.LessThan(.001f));
            }
            finally
            {
                Object.DestroyImmediate(cameraObject);
                Object.DestroyImmediate(avatar);
                Object.DestroyImmediate(replacement);
            }
        }

        [TestCase("fullbody", 3f, 28f, 0f)]
        [TestCase("center", 3f, 26f, 0f)]
        [TestCase("closeup", 4f, 20f, 0f)]
        [TestCase("overhead", 16f, 28f, 0f)]
        [TestCase("side", 3f, 26f, 20f)]
        public void CameraPresetsKeepTheirLensAndViewingAngleAcrossOutputOrientations(string view, float pitch, float fieldOfView, float yaw)
        {
            var cameraObject = new GameObject("Preset geometry camera");
            var camera = cameraObject.AddComponent<Camera>();
            var rig = cameraObject.AddComponent<AvatarSceneRig>();
            var avatar = GameObject.CreatePrimitive(PrimitiveType.Cube);
            avatar.transform.localScale = new Vector3(.8f, 2f, .3f);
            try
            {
                rig.Configure(true);
                rig.Frame(avatar);
                foreach (var aspect in new[] { 16f / 9f, 9f / 16f })
                {
                    AvatarSceneRig.ConfigurePhysicalProjection(camera, aspect);
                    rig.SetPresentationMode(true, view);
                    rig.AdvancePresentation(1f);
                    var expected = Quaternion.Euler(pitch, 180f + yaw, 0f);
                    Assert.That(Quaternion.Angle(camera.transform.rotation, expected), Is.LessThan(.01f));
                    Assert.That(camera.fieldOfView, Is.EqualTo(fieldOfView).Within(.001f));
                    Assert.That(camera.lensShift, Is.EqualTo(Vector2.zero));
                    Assert.That(camera.orthographic, Is.False);
                }
            }
            finally { Object.DestroyImmediate(cameraObject); Object.DestroyImmediate(avatar); }
        }

        [Test]
        public void PortraitCloseupFramesTheFaceInsteadOfFittingTheFullArmSpan()
        {
            var cameraObject = new GameObject("Portrait crop camera");
            var camera = cameraObject.AddComponent<Camera>();
            var rig = cameraObject.AddComponent<AvatarSceneRig>();
            var avatar = GameObject.CreatePrimitive(PrimitiveType.Cube);
            avatar.transform.localScale = new Vector3(2f, 2f, .1f);
            try
            {
                rig.Configure(true);
                var bounds = rig.Frame(avatar);
                AvatarSceneRig.ConfigurePhysicalProjection(camera, 9f / 16f);
                rig.SetPresentationMode(true, "fullbody"); rig.AdvancePresentation(1f);
                var fullbodyDistance = Vector3.Distance(camera.transform.position, bounds.center);
                rig.SetPresentationMode(true, "closeup"); rig.AdvancePresentation(1f);
                Assert.That(Vector3.Distance(camera.transform.position, bounds.center), Is.LessThan(fullbodyDistance * .5f));
                var eye = bounds.min + new Vector3(bounds.extents.x, bounds.size.y * .73f, bounds.extents.z);
                var eyeInFrame = camera.WorldToViewportPoint(eye);
                Assert.That(eyeInFrame.x, Is.EqualTo(.5f).Within(.01f));
                Assert.That(eyeInFrame.y, Is.InRange(.5f, .85f));
            }
            finally { Object.DestroyImmediate(cameraObject); Object.DestroyImmediate(avatar); }
        }

        [Test]
        public void BackgroundResourcesAreIncludedAndShaderCompiles()
        {
            var shader = Resources.Load<Shader>("Immersive/Backdrop");
            Assert.That(shader, Is.Not.Null);
            Assert.That(ShaderUtil.ShaderHasError(shader), Is.False);
            Assert.That(Resources.Load<Texture2D>("Immersive/Typography"), Is.Not.Null);
            Assert.That(Resources.Load<Texture2D>("Immersive/Film"), Is.Not.Null);
            Assert.That(Resources.Load<Texture2D>("Immersive/Frames"), Is.Not.Null);
            Assert.That(Resources.Load<Texture2D>("Immersive/CloudObservatory"), Is.Not.Null);
        }

        [Test]
        public void ImmersiveInputKeepsControlsExcludedFromFullScreenHitArea()
        {
            var screen = new AvatarWindow.Rectangle { x = -1920, y = 0, width = 1920, height = 1080 };
            var capsule = new AvatarWindow.Rectangle { x = -400, y = 900, width = 240, height = 64 };
            Assert.That(AvatarWindow.IsInControlArea(-1000, 400, screen, new[] { capsule }), Is.True);
            Assert.That(AvatarWindow.IsInControlArea(-350, 930, screen, new[] { capsule }), Is.False);
            Assert.That(AvatarWindow.IsInControlArea(10, 400, screen, new[] { capsule }), Is.False);
        }
    }
}
