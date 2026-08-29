using UnityEngine;

namespace Katarune.Avatar
{
    /// <summary>
    /// Subtle world-space ambient wind for VRM Spring Bones. Layered frequencies keep
    /// the force continuous without requiring body motion to excite secondary motion.
    /// </summary>
    public static class AvatarAmbientWind
    {
        public const float MaximumForce = 0.18f;

        public static Vector3 Sample(float elapsedSeconds)
        {
            var time = Mathf.Max(0f, elapsedSeconds);
            var slowDrift = Mathf.Sin(time * 0.47f + 0.4f);
            var secondaryDrift = Mathf.Sin(time * 0.83f + 2.1f);
            var fineGust = Mathf.Sin(time * 1.71f + 1.3f);
            var strength = 0.085f
                + slowDrift * 0.038f
                + secondaryDrift * 0.018f
                + fineGust * 0.009f;
            var directionDrift = Mathf.Sin(time * 0.21f + 0.8f);
            var force = new Vector3(
                strength,
                0.006f * Mathf.Sin(time * 0.63f + 0.2f),
                0.026f * directionDrift);
            return Vector3.ClampMagnitude(force, MaximumForce);
        }
    }
}
