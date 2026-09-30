using UnityEngine;

namespace Katarune.Avatar
{
    /// <summary>
    /// Very weak world-space ambient wind for VRM Spring Bones. Body-driven idle motion
    /// is the primary source of secondary motion; this only prevents perfect stillness.
    /// </summary>
    public static class AvatarAmbientWind
    {
        public const float MaximumForce = 0.006f;

        public static Vector3 Sample(float elapsedSeconds)
        {
            var time = Mathf.Max(0f, elapsedSeconds);
            var slowDrift = Mathf.Sin(time * 0.47f + 0.4f);
            var secondaryDrift = Mathf.Sin(time * 0.83f + 2.1f);
            var fineGust = Mathf.Sin(time * 1.71f + 1.3f);
            var strength = 0.0005f
                + slowDrift * 0.0015f
                + secondaryDrift * 0.00075f
                + fineGust * 0.00025f;
            var directionDrift = Mathf.Sin(time * 0.21f + 0.8f);
            var force = new Vector3(
                strength,
                0.0003f * Mathf.Sin(time * 0.63f + 0.2f),
                0.0015f * directionDrift);
            return Vector3.ClampMagnitude(force, MaximumForce);
        }
    }
}
