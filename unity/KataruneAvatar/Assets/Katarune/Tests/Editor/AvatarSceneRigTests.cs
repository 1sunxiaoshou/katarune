using NUnit.Framework;
using UnityEngine;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarSceneRigTests
    {
        [Test]
        public void PhysicalLensShiftMovesFramingWithoutMovingTheCameraOffAxis()
        {
            var cameraObject = new GameObject("Framing Test Camera");
            try
            {
                var camera = cameraObject.AddComponent<Camera>();
                camera.aspect = 1.7f;
                camera.fieldOfView = 30f;
                AvatarSceneRig.ConfigurePhysicalProjection(camera, camera.aspect, 0.75f);
                var viewport = camera.WorldToViewportPoint(camera.transform.position + camera.transform.forward * 5f);

                Assert.That(viewport.x, Is.EqualTo(0.75f).Within(0.001f));
                Assert.That(camera.transform.position, Is.EqualTo(Vector3.zero));
                Assert.That(camera.transform.rotation, Is.EqualTo(Quaternion.identity));
            }
            finally
            {
                Object.DestroyImmediate(cameraObject);
            }
        }

        [Test]
        public void InitialFramingUsesThreeFifthsScaleAtTheBottomRightMargin()
        {
            var cameraObject = new GameObject("Initial Framing Camera") { tag = "MainCamera" };
            var camera = cameraObject.AddComponent<Camera>();
            camera.fieldOfView = 30f;
            var rig = cameraObject.AddComponent<AvatarSceneRig>();
            var avatar = GameObject.CreatePrimitive(PrimitiveType.Cube);
            avatar.transform.localScale = new Vector3(0.8f, 2f, 0.6f);

            try
            {
                rig.Configure(true);
                var bounds = rig.Frame(avatar);
                var state = rig.CaptureFraming();
                var viewportBounds = AvatarSceneRig.GetViewportBounds(camera, bounds);

                Assert.That(viewportBounds.yMin, Is.EqualTo(0.08f).Within(0.001f));
                Assert.That(viewportBounds.xMax, Is.EqualTo(0.92f).Within(0.001f));
                Assert.That(state.ShowcaseAvatar.localScale, Is.EqualTo(new Vector3(0.8f, 2f, 0.6f)));
            }
            finally
            {
                Object.DestroyImmediate(avatar);
                Object.DestroyImmediate(cameraObject);
            }
        }

        [Test]
        public void ShowcaseDragRotatesAvatarAtWorldOriginWithoutOrbitingItsRendererBounds()
        {
            var cameraObject = new GameObject("Showcase Camera") { tag = "MainCamera" };
            cameraObject.AddComponent<Camera>();
            var rig = cameraObject.AddComponent<AvatarSceneRig>();
            var avatar = new GameObject("Showcase Avatar");
            avatar.transform.position = new Vector3(2.4f, 0f, -1.7f);
            var body = GameObject.CreatePrimitive(PrimitiveType.Cube);
            body.transform.SetParent(avatar.transform, false);
            body.transform.localPosition = new Vector3(0.4f, 1f, 1.2f);
            body.transform.localScale = new Vector3(0.8f, 2f, 0.6f);

            try
            {
                rig.Configure(true);
                rig.Frame(avatar);
                rig.SetCharacterShowcaseControlEnabled(true);
                var initial = rig.CaptureFraming();

                rig.BeginShowcaseDragForTests();
                rig.ApplyRotationDelta(90f, 1f / 60f);
                rig.AdvanceShowcaseMotion(1f / 60f);
                var moving = rig.CaptureFraming();

                Assert.That(initial.ShowcasePosition, Is.EqualTo(Vector3.zero));
                Assert.That(initial.ShowcaseBasePosition, Is.EqualTo(Vector3.zero));
                Assert.That(initial.FramingTarget.x, Is.EqualTo(0f).Within(0.0001f));
                Assert.That(initial.FramingTarget.z, Is.EqualTo(0f).Within(0.0001f));
                Assert.That(moving.ShowcaseYaw, Is.GreaterThan(0f).And.LessThan(90f));
                Assert.That(Quaternion.Angle(initial.ShowcaseRotation, moving.ShowcaseRotation), Is.GreaterThan(0f));
                Assert.That(moving.ShowcasePosition, Is.EqualTo(Vector3.zero));
                Assert.That(moving.CameraPosition, Is.EqualTo(initial.CameraPosition));
                Assert.That(moving.CameraRotation, Is.EqualTo(initial.CameraRotation));
            }
            finally
            {
                Object.DestroyImmediate(avatar);
                Object.DestroyImmediate(cameraObject);
            }
        }

        [Test]
        public void ShowcaseRotationUsesDampingAndReleaseInertia()
        {
            var cameraObject = new GameObject("Showcase Motion Camera") { tag = "MainCamera" };
            cameraObject.AddComponent<Camera>();
            var rig = cameraObject.AddComponent<AvatarSceneRig>();
            var avatar = GameObject.CreatePrimitive(PrimitiveType.Cube);
            avatar.transform.position = new Vector3(0f, 1f, 0f);
            avatar.transform.localScale = new Vector3(0.8f, 2f, 0.6f);

            try
            {
                rig.Configure(true);
                rig.Frame(avatar);
                rig.SetCharacterShowcaseControlEnabled(true);
                rig.BeginShowcaseDragForTests();
                for (var index = 0; index < 4; index += 1)
                {
                    rig.ApplyRotationDelta(8f, 1f / 60f);
                    rig.AdvanceShowcaseMotion(1f / 60f);
                }
                var beforeRelease = rig.CaptureFraming();

                rig.ReleaseShowcaseDragForTests();
                var released = rig.CaptureFraming();
                rig.AdvanceShowcaseMotion(1f / 30f);
                var coasting = rig.CaptureFraming();

                Assert.That(Mathf.Abs(released.InertialYawVelocity), Is.GreaterThan(0f));
                Assert.That(coasting.ShowcaseYaw, Is.GreaterThan(beforeRelease.ShowcaseYaw));
                Assert.That(Mathf.Abs(coasting.InertialYawVelocity), Is.LessThan(Mathf.Abs(released.InertialYawVelocity)));
            }
            finally
            {
                Object.DestroyImmediate(avatar);
                Object.DestroyImmediate(cameraObject);
            }
        }

        [Test]
        public void ShowcaseReleaseInertiaHasABoundedSoftTail()
        {
            var cameraObject = new GameObject("Soft Inertia Camera") { tag = "MainCamera" };
            cameraObject.AddComponent<Camera>();
            var rig = cameraObject.AddComponent<AvatarSceneRig>();
            var avatar = GameObject.CreatePrimitive(PrimitiveType.Cube);
            avatar.transform.localScale = new Vector3(0.8f, 2f, 0.6f);

            try
            {
                rig.Configure(true);
                rig.Frame(avatar);
                rig.BeginShowcaseDragForTests();
                for (var index = 0; index < 6; index += 1)
                {
                    rig.ApplyRotationDelta(30f, 1f / 60f);
                    rig.AdvanceShowcaseMotion(1f / 60f);
                }

                rig.ReleaseShowcaseDragForTests();
                var released = rig.CaptureFraming();
                for (var frame = 0; frame < 30; frame += 1)
                {
                    rig.AdvanceShowcaseMotion(1f / 60f);
                }
                var lingering = rig.CaptureFraming();
                for (var frame = 30; frame < 60; frame += 1)
                {
                    rig.AdvanceShowcaseMotion(1f / 60f);
                }
                var softTail = rig.CaptureFraming();
                for (var frame = 60; frame < 120; frame += 1)
                {
                    rig.AdvanceShowcaseMotion(1f / 60f);
                }
                var settled = rig.CaptureFraming();

                Assert.That(Mathf.Abs(released.InertialYawVelocity), Is.LessThanOrEqualTo(140f));
                Assert.That(Mathf.Abs(lingering.InertialYawVelocity), Is.GreaterThan(0f));
                Assert.That(Mathf.Abs(softTail.InertialYawVelocity), Is.GreaterThan(0f));
                Assert.That(
                    Mathf.Abs(settled.TargetShowcaseYaw - released.TargetShowcaseYaw),
                    Is.LessThan(30f));
                Assert.That(settled.InertialYawVelocity, Is.EqualTo(0f));
            }
            finally
            {
                Object.DestroyImmediate(avatar);
                Object.DestroyImmediate(cameraObject);
            }
        }

        [Test]
        public void ShowcaseVerticalOrbitIsLimitedAndKeepsTheAvatarUpright()
        {
            var cameraObject = new GameObject("Vertical Showcase Camera") { tag = "MainCamera" };
            cameraObject.AddComponent<Camera>();
            var rig = cameraObject.AddComponent<AvatarSceneRig>();
            var avatar = GameObject.CreatePrimitive(PrimitiveType.Cube);
            avatar.transform.localScale = new Vector3(0.8f, 2f, 0.6f);

            try
            {
                rig.Configure(true);
                rig.Frame(avatar);
                var initial = rig.CaptureFraming();

                rig.BeginShowcaseDragForTests();
                rig.ApplyPitchDelta(100f);
                for (var frame = 0; frame < 30; frame += 1)
                {
                    rig.AdvanceShowcaseMotion(1f / 60f);
                }
                var upperLimit = rig.CaptureFraming();

                rig.ApplyPitchDelta(-200f);
                for (var frame = 0; frame < 30; frame += 1)
                {
                    rig.AdvanceShowcaseMotion(1f / 60f);
                }
                var lowerLimit = rig.CaptureFraming();

                Assert.That(upperLimit.TargetShowcasePitch, Is.EqualTo(45f));
                Assert.That(lowerLimit.TargetShowcasePitch, Is.EqualTo(-45f));
                Assert.That(upperLimit.CameraPosition, Is.Not.EqualTo(initial.CameraPosition));
                Assert.That(lowerLimit.CameraPosition, Is.Not.EqualTo(upperLimit.CameraPosition));
                Assert.That(
                    Vector3.Distance(upperLimit.CameraPosition, upperLimit.FramingTarget),
                    Is.EqualTo(Vector3.Distance(initial.CameraPosition, initial.FramingTarget)).Within(0.0001f));
                Assert.That(upperLimit.ShowcasePosition, Is.EqualTo(Vector3.zero));
                Assert.That(upperLimit.ShowcaseRotation, Is.EqualTo(initial.ShowcaseRotation));
                Assert.That(lowerLimit.ShowcaseRotation, Is.EqualTo(initial.ShowcaseRotation));
            }
            finally
            {
                Object.DestroyImmediate(avatar);
                Object.DestroyImmediate(cameraObject);
            }
        }

        [TestCase(20f, -3.2f)]
        [TestCase(-20f, 3.2f)]
        public void VerticalPointerDragUsesDirectManipulationDirection(
            float pointerDeltaY,
            float expectedPitchDelta)
        {
            Assert.That(
                AvatarSceneRig.GetPitchDeltaFromPointerDelta(pointerDeltaY),
                Is.EqualTo(expectedPitchDelta).Within(0.0001f));
        }

        [TestCase(220f, 1f)]
        [TestCase(-220f, -1f)]
        [TestCase(450f, 1f)]
        [TestCase(-450f, -1f)]
        public void FastShowcaseDragNeverChoosesTheOppositeWrappedDirection(
            float yawDelta,
            float expectedDirection)
        {
            var cameraObject = new GameObject("Fast Showcase Camera") { tag = "MainCamera" };
            cameraObject.AddComponent<Camera>();
            var rig = cameraObject.AddComponent<AvatarSceneRig>();
            var avatar = GameObject.CreatePrimitive(PrimitiveType.Cube);
            avatar.transform.localScale = new Vector3(0.8f, 2f, 0.6f);

            try
            {
                rig.Configure(true);
                rig.Frame(avatar);
                rig.BeginShowcaseDragForTests();
                rig.ApplyRotationDelta(yawDelta, 1f / 60f);
                rig.AdvanceShowcaseMotion(1f / 60f);
                var state = rig.CaptureFraming();

                Assert.That(state.TargetShowcaseYaw, Is.EqualTo(yawDelta).Within(0.0001f));
                Assert.That(Mathf.Sign(state.ShowcaseYaw), Is.EqualTo(expectedDirection));
                Assert.That(Mathf.Sign(state.ShowcaseYawVelocity), Is.EqualTo(expectedDirection));
            }
            finally
            {
                Object.DestroyImmediate(avatar);
                Object.DestroyImmediate(cameraObject);
            }
        }

        [TestCase(30f, 2f, 15.261f)]
        [TestCase(30f, 0.5f, 56.374f)]
        public void ProjectionMagnificationUsesTangentSpace(float baseFieldOfView, float magnification, float expected)
        {
            Assert.That(
                AvatarSceneRig.GetFieldOfViewForMagnification(baseFieldOfView, magnification),
                Is.EqualTo(expected).Within(0.01f));
        }
    }
}
