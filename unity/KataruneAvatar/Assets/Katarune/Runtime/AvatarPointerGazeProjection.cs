using UnityEngine;

namespace Katarune.Avatar
{
    internal static class AvatarPointerGazeProjection
    {
        // The projection plane represents the visible desktop window inside the scene.
        // Keeping it between the camera and the avatar produces an expressive but bounded
        // parallax response instead of treating screen offsets as pre-authored angles.
        internal const float VirtualWindowDepthRatio = 0.45f;

        public static bool TryProject(
            Camera camera,
            Vector2 screenPosition,
            AvatarGazeGeometry geometry,
            out Vector2 viewportAngles)
        {
            if (camera == null)
            {
                viewportAngles = Vector2.zero;
                return false;
            }

            var ray = camera.ScreenPointToRay(new Vector3(screenPosition.x, screenPosition.y, 0f));
            return TryProject(
                ray,
                camera.transform.position,
                camera.transform.forward,
                camera.nearClipPlane,
                geometry,
                out viewportAngles);
        }

        internal static bool TryProject(
            Ray pointerRay,
            Vector3 cameraPosition,
            Vector3 cameraForward,
            float nearClipPlane,
            AvatarGazeGeometry geometry,
            out Vector2 viewportAngles)
        {
            viewportAngles = Vector2.zero;
            if (cameraForward.sqrMagnitude < 0.000001f) return false;

            cameraForward.Normalize();
            var avatarDepth = Vector3.Dot(geometry.Origin - cameraPosition, cameraForward);
            var minimumDepth = Mathf.Max(0.01f, nearClipPlane + 0.01f);
            if (avatarDepth <= minimumDepth) return false;

            var windowDepth = Mathf.Lerp(minimumDepth, avatarDepth, VirtualWindowDepthRatio);
            var windowPlane = new Plane(
                cameraForward,
                cameraPosition + cameraForward * windowDepth);
            if (!windowPlane.Raycast(pointerRay, out var distance) || distance < 0f) return false;

            var target = pointerRay.GetPoint(distance);
            var localDirection = Quaternion.Inverse(geometry.ReferenceRotation)
                * (target - geometry.Origin);
            if (localDirection.z <= 0.0001f) return false;

            var avatarYaw = Mathf.Atan2(localDirection.x, localDirection.z) * Mathf.Rad2Deg;
            var horizontalDistance = Mathf.Sqrt(
                localDirection.x * localDirection.x + localDirection.z * localDirection.z);
            var pitch = Mathf.Atan2(localDirection.y, horizontalDistance) * Mathf.Rad2Deg;
            viewportAngles = new Vector2(
                AvatarCoordinateSpace.AvatarYawToViewportYaw(avatarYaw),
                pitch);
            return true;
        }
    }
}
