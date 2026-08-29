using System;
using UnityEngine;

namespace Katarune.Avatar
{
    public readonly struct AvatarGazeGeometry
    {
        public AvatarGazeGeometry(Vector3 origin, Quaternion referenceRotation)
        {
            Origin = origin;
            ReferenceRotation = referenceRotation;
        }

        public Vector3 Origin { get; }
        public Quaternion ReferenceRotation { get; }
    }

    public interface IAvatarGazeGeometryProvider
    {
        bool TryGetGazeGeometry(out AvatarGazeGeometry geometry);
    }

    public interface IAvatarDriver : IDisposable
    {
        bool SupportsAffect(AvatarAffectPreset preset);
        void Apply(AvatarPoseFrame frame);
        void ResetPose();
    }
}
