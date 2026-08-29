using NUnit.Framework;
using UnityEngine;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarSceneRigTests
    {
        [TestCase(1f, 0.7f)]
        [TestCase(1.7f, 0.75f)]
        [TestCase(2.4f, 0.8f)]
        [TestCase(3f, 0.8f)]
        public void DesiredViewportCenterStaysOnRightAndAdaptsToAspect(float aspect, float expected)
        {
            Assert.That(AvatarSceneRig.GetDesiredViewportCenterX(aspect), Is.EqualTo(expected).Within(0.005f));
        }

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

        [Test]
        public void ShowcaseZoomChangesOnlyProjectionMagnificationAroundTheFixedTarget()
        {
            var cameraObject = new GameObject("Showcase Zoom Camera") { tag = "MainCamera" };
            var camera = cameraObject.AddComponent<Camera>();
            var rig = cameraObject.AddComponent<AvatarSceneRig>();
            var avatar = GameObject.CreatePrimitive(PrimitiveType.Cube);
            avatar.transform.position = new Vector3(3f, 0f, -2f);
            avatar.transform.localScale = new Vector3(0.8f, 2f, 0.6f);

            try
            {
                rig.Configure(true);
                rig.Frame(avatar);
                var before = rig.CaptureFraming();
                var targetViewportBefore = camera.WorldToViewportPoint(before.FramingTarget);

                rig.ApplyZoomSteps(2f);
                var queued = rig.CaptureFraming();
                rig.AdvanceShowcaseMotion(1f / 60f);
                var zooming = rig.CaptureFraming();
                var targetViewportAfter = camera.WorldToViewportPoint(zooming.FramingTarget);

                Assert.That(queued.TargetZoomMagnification, Is.GreaterThan(before.ZoomMagnification));
                Assert.That(queued.ZoomMagnification, Is.EqualTo(before.ZoomMagnification));
                Assert.That(zooming.ZoomMagnification, Is.GreaterThan(before.ZoomMagnification));
                Assert.That(zooming.ZoomMagnification, Is.LessThan(queued.TargetZoomMagnification));
                Assert.That(zooming.CameraPosition, Is.EqualTo(before.CameraPosition));
                Assert.That(zooming.CameraRotation, Is.EqualTo(before.CameraRotation));
                Assert.That(zooming.CameraLensShift, Is.EqualTo(before.CameraLensShift));
                Assert.That(zooming.CameraFieldOfView, Is.LessThan(before.CameraFieldOfView));
                Assert.That(targetViewportAfter.x, Is.EqualTo(targetViewportBefore.x).Within(0.0001f));
                Assert.That(targetViewportAfter.y, Is.EqualTo(targetViewportBefore.y).Within(0.0001f));
                Assert.That(zooming.ShowcasePosition, Is.EqualTo(Vector3.zero));
            }
            finally
            {
                Object.DestroyImmediate(avatar);
                Object.DestroyImmediate(cameraObject);
            }
        }

        [Test]
        public void ShowcaseCompositionPanChangesOnlyScreenSpaceProjection()
        {
            var cameraObject = new GameObject("Showcase Composition Camera") { tag = "MainCamera" };
            var camera = cameraObject.AddComponent<Camera>();
            var rig = cameraObject.AddComponent<AvatarSceneRig>();
            var avatar = GameObject.CreatePrimitive(PrimitiveType.Cube);
            avatar.transform.localScale = new Vector3(0.8f, 2f, 0.6f);

            try
            {
                rig.Configure(true);
                rig.Frame(avatar);
                var before = rig.CaptureFraming();
                var targetViewportBefore = camera.WorldToViewportPoint(before.FramingTarget);

                rig.ApplyCompositionPanDelta(
                    new Vector2(100f, -100f),
                    new Vector2(1000f, 500f));
                var queued = rig.CaptureFraming();
                rig.AdvanceShowcaseMotion(1f / 60f);
                var panning = rig.CaptureFraming();

                Assert.That(queued.TargetCompositionOffsetViewport.x, Is.EqualTo(0.1f).Within(0.0001f));
                Assert.That(queued.TargetCompositionOffsetViewport.y, Is.EqualTo(-0.2f).Within(0.0001f));
                Assert.That(queued.CompositionOffsetViewport, Is.EqualTo(Vector2.zero));
                Assert.That(panning.CompositionOffsetViewport.x, Is.GreaterThan(0f).And.LessThan(0.1f));
                Assert.That(panning.CompositionOffsetViewport.y, Is.LessThan(0f).And.GreaterThan(-0.2f));
                Assert.That(
                    camera.lensShift.x,
                    Is.EqualTo(panning.FixedLensShift.x - panning.CompositionOffsetViewport.x)
                        .Within(0.0001f));
                Assert.That(
                    camera.lensShift.y,
                    Is.EqualTo(panning.FixedLensShift.y - panning.CompositionOffsetViewport.y)
                        .Within(0.0001f));
                Assert.That(panning.CameraPosition, Is.EqualTo(before.CameraPosition));
                Assert.That(panning.CameraRotation, Is.EqualTo(before.CameraRotation));
                Assert.That(panning.CameraFieldOfView, Is.EqualTo(before.CameraFieldOfView));
                Assert.That(panning.ShowcasePosition, Is.EqualTo(before.ShowcasePosition));
                Assert.That(panning.ShowcaseRotation, Is.EqualTo(before.ShowcaseRotation));

                rig.ApplyCompositionPanDelta(
                    new Vector2(10000f, 10000f),
                    new Vector2(1000f, 500f));
                var limited = rig.CaptureFraming();
                var baseViewportCenter = new Vector2(
                    0.5f - limited.FixedLensShift.x,
                    0.5f - limited.FixedLensShift.y);
                var limitedViewportCenter =
                    baseViewportCenter + limited.TargetCompositionOffsetViewport;
                Assert.That(limitedViewportCenter.x, Is.EqualTo(0.92f).Within(0.0001f));
                Assert.That(limitedViewportCenter.y, Is.EqualTo(0.92f).Within(0.0001f));

                rig.ResetCharacterShowcaseView();
                var reset = rig.CaptureFraming();
                var targetViewportReset = camera.WorldToViewportPoint(reset.FramingTarget);
                Assert.That(reset.CompositionOffsetViewport, Is.EqualTo(Vector2.zero));
                Assert.That(reset.TargetCompositionOffsetViewport, Is.EqualTo(Vector2.zero));
                Assert.That(targetViewportReset.x, Is.EqualTo(targetViewportBefore.x).Within(0.0001f));
                Assert.That(targetViewportReset.y, Is.EqualTo(targetViewportBefore.y).Within(0.0001f));
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
