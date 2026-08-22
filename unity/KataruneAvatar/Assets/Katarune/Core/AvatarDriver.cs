using System;

namespace Katarune.Avatar
{
    public interface IAvatarDriver : IDisposable
    {
        bool SupportsAffect(AvatarAffectPreset preset);
        void Apply(AvatarPoseFrame frame);
        void ResetPose();
    }
}
