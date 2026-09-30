using System;
using UnityEngine;

namespace Katarune.Avatar
{
    [Flags]
    public enum CharacterRigCapabilities
    {
        None = 0,
        HumanoidBody = 1 << 0,
        FaceExpressions = 1 << 1,
        Gaze = 1 << 2,
        Visemes = 1 << 3,
        All = HumanoidBody | FaceExpressions | Gaze | Visemes,
    }

    public interface ICharacterRigBinding
    {
        CharacterRigCapabilities Capabilities { get; }
        Animator HumanoidAnimator { get; }
    }

    public sealed class HumanoidCharacterRigBinding : ICharacterRigBinding
    {
        public HumanoidCharacterRigBinding(
            Animator animator,
            CharacterRigCapabilities capabilities)
        {
            HumanoidAnimator = animator != null
                ? animator
                : throw new ArgumentNullException(nameof(animator));
            if (!HumanoidAnimator.isHuman
                || HumanoidAnimator.avatar == null
                || !HumanoidAnimator.avatar.isValid)
            {
                throw new InvalidOperationException(
                    "The character rig binding requires a valid Humanoid Animator.");
            }
            if ((capabilities & CharacterRigCapabilities.HumanoidBody) == 0)
            {
                throw new ArgumentException(
                    "A Humanoid rig binding must declare the HumanoidBody capability.",
                    nameof(capabilities));
            }

            Capabilities = capabilities;
        }

        public CharacterRigCapabilities Capabilities { get; }
        public Animator HumanoidAnimator { get; }
    }
}
