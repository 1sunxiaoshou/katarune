using System;
using UnityEngine;

namespace Katarune.Avatar
{
    [CreateAssetMenu(fileName = "AvatarMotionLibrary", menuName = "Katarune/Avatar Motion Library")]
    public sealed class AvatarMotionLibrary : ScriptableObject
    {
        [SerializeField] private AnimationClip _baseClip;
        [SerializeField] private AvatarActionDefinition[] _actions = Array.Empty<AvatarActionDefinition>();

        public bool IsValid => _baseClip != null;

        public AvatarActionCapabilities Actions
        {
            get
            {
                var result = AvatarActionCapabilities.None;
                foreach (var definition in _actions)
                {
                    if (definition == null || definition.Clip == null) continue;
                    result |= (AvatarActionCapabilities)(1 << (int)definition.Action);
                }
                return result;
            }
        }

        public bool TryGetBase(out AnimationClip clip)
        {
            clip = _baseClip;
            return clip != null;
        }

        public bool TryGetAction(AvatarPresetAction action, out AvatarActionDefinition definition)
        {
            foreach (var candidate in _actions)
            {
                if (candidate != null && candidate.Action == action && candidate.Clip != null)
                {
                    definition = candidate;
                    return true;
                }
            }
            definition = null;
            return false;
        }

        internal void Configure(
            AnimationClip baseClip,
            AvatarActionDefinition[] actions)
        {
            _baseClip = baseClip;
            _actions = actions ?? Array.Empty<AvatarActionDefinition>();
        }
    }

    [Serializable]
    public sealed class AvatarActionDefinition
    {
        [SerializeField] private AvatarPresetAction _action;
        [SerializeField] private AnimationClip _clip;
        [SerializeField] private float _speed = 1f;
        [SerializeField] private float _maximumDuration;

        public AvatarPresetAction Action => _action;
        public AnimationClip Clip => _clip;
        public float Speed => Mathf.Max(0.01f, _speed);
        public float Duration => _maximumDuration > 0f
            ? Mathf.Min(_maximumDuration, _clip != null ? _clip.length / Speed : 0f)
            : (_clip != null ? _clip.length / Speed : 0f);

        internal AvatarActionDefinition(
            AvatarPresetAction action,
            AnimationClip clip,
            float maximumDuration = 0f,
            float speed = 1f)
        {
            _action = action;
            _clip = clip;
            _maximumDuration = maximumDuration;
            _speed = speed;
        }
    }
}
