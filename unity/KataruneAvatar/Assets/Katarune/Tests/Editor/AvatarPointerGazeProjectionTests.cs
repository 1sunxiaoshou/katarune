using NUnit.Framework;
using UnityEngine;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarPointerGazeProjectionTests
    {
        private static readonly Vector3 CameraPosition = new Vector3(0f, 1.6f, 4f);
        private static readonly Vector3 CameraForward = Vector3.back;
        private static readonly AvatarGazeGeometry Geometry = new AvatarGazeGeometry(
            new Vector3(0f, 1.6f, 0f),
            Quaternion.identity);

        [Test]
        public void CameraTargetUsesActualPositionAndAvatarOrientation()
        {
            Assert.That(AvatarGazeProjection.TryProjectTarget(CameraPosition, Geometry, out var center), Is.True);
            Assert.That(center.magnitude, Is.LessThan(.001f));
            Assert.That(AvatarGazeProjection.TryProjectTarget(new Vector3(-1f, 2.6f, 4f), Geometry, out var offset), Is.True);
            Assert.That(offset.x, Is.GreaterThan(10f));
            Assert.That(offset.y, Is.GreaterThan(10f));
            var rotated = new AvatarGazeGeometry(Geometry.Origin, Quaternion.Euler(0f, 90f, 0f));
            Assert.That(AvatarGazeProjection.TryProjectTarget(Geometry.Origin + Vector3.right * 4f, rotated, out var forward), Is.True);
            Assert.That(forward.magnitude, Is.LessThan(.001f));
            Assert.That(AvatarGazeProjection.TryProjectTarget(Geometry.Origin, Geometry, out _), Is.False);
            Assert.That(AvatarGazeProjection.TryProjectTarget(Geometry.Origin + Vector3.back, Geometry, out _), Is.False);
        }

        [Test]
        public void CenterRayLooksStraightAhead()
        {
            var projected = AvatarGazeProjection.TryProject(
                new Ray(CameraPosition, CameraForward),
                CameraPosition,
                CameraForward,
                0.01f,
                Geometry,
                out var angles);

            Assert.That(projected, Is.True);
            Assert.That(angles.magnitude, Is.LessThan(0.001f));
        }

        [Test]
        public void ScreenRightRayProducesPositiveViewportYaw()
        {
            var cameraRight = Vector3.left;
            var ray = new Ray(
                CameraPosition,
                (CameraForward + cameraRight * 0.3f).normalized);

            var projected = AvatarGazeProjection.TryProject(
                ray,
                CameraPosition,
                CameraForward,
                0.01f,
                Geometry,
                out var angles);

            Assert.That(projected, Is.True);
            Assert.That(angles.x, Is.GreaterThan(10f));
            Assert.That(angles.y, Is.EqualTo(0f).Within(0.001f));
        }

        [Test]
        public void ScreenUpRayProducesPositivePitch()
        {
            var ray = new Ray(
                CameraPosition,
                (CameraForward + Vector3.up * 0.2f).normalized);

            var projected = AvatarGazeProjection.TryProject(
                ray,
                CameraPosition,
                CameraForward,
                0.01f,
                Geometry,
                out var angles);

            Assert.That(projected, Is.True);
            Assert.That(angles.y, Is.GreaterThan(5f));
        }

        [Test]
        public void ReferenceRotationDefinesAvatarForward()
        {
            var rotatedGeometry = new AvatarGazeGeometry(
                Vector3.zero,
                Quaternion.Euler(0f, 90f, 0f));
            var cameraPosition = new Vector3(4f, 0f, 0f);
            var cameraForward = Vector3.left;

            var projected = AvatarGazeProjection.TryProject(
                new Ray(cameraPosition, cameraForward),
                cameraPosition,
                cameraForward,
                0.01f,
                rotatedGeometry,
                out var angles);

            Assert.That(projected, Is.True);
            Assert.That(angles.magnitude, Is.LessThan(0.001f));
        }
    }
}
