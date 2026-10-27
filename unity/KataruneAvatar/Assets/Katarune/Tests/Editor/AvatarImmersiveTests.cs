using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarImmersiveTests
    {
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
                Assert.That(center.y, Is.EqualTo(.5f).Within(.04f));
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

        [Test]
        public void BackgroundResourcesAreIncludedAndShaderCompiles()
        {
            var shader = Resources.Load<Shader>("Immersive/Backdrop");
            Assert.That(shader, Is.Not.Null);
            Assert.That(ShaderUtil.ShaderHasError(shader), Is.False);
            Assert.That(Resources.Load<Texture2D>("Immersive/Typography"), Is.Not.Null);
            Assert.That(Resources.Load<Texture2D>("Immersive/Film"), Is.Not.Null);
            Assert.That(Resources.Load<Texture2D>("Immersive/Frames"), Is.Not.Null);
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
