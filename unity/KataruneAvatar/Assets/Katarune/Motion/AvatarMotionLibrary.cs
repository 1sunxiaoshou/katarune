using System;
using System.Collections.Generic;
using UnityEngine;

namespace Katarune.Avatar
{
    [CreateAssetMenu(fileName = "AvatarMotionLibrary", menuName = "Katarune/Avatar Motion Library")]
    public sealed class AvatarMotionLibrary : ScriptableObject
    {
        [SerializeField] private AnimationClip _baseClip;
        [SerializeField] private bool _applyFootIK = true;
        [SerializeField] private AvatarActionDefinition[] _actions = Array.Empty<AvatarActionDefinition>();
        [SerializeField] private string _packId;
        [SerializeField] private int _formatVersion;
        [SerializeField] private string _unityVersion;
        [SerializeField] private string _platform;

        public string PackId => _packId;
        public int FormatVersion => _formatVersion;
        public string UnityVersion => _unityVersion;
        public string Platform => _platform;
        public IReadOnlyList<AvatarActionDefinition> Definitions => _actions;

        internal void StampPack(string id)
        {
            _packId = id;
            _formatVersion = 1;
            _unityVersion = Application.unityVersion;
            _platform = "StandaloneWindows64";
        }

        public bool IsValid => _baseClip != null;
        public bool ApplyFootIK => _applyFootIK;

        public AvatarActionCapabilities Actions
        {
            get
            {
                var result = AvatarActionCapabilities.None;
                foreach (var definition in _actions)
                {
                    if (definition == null || definition.Clip == null) continue;
                    var preset = AvatarActionIds.ToPreset(definition.Id);
                    if (preset.HasValue) result |= (AvatarActionCapabilities)(1 << (int)preset.Value);
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
            => TryGetAction(AvatarActionIds.FromPreset(action), out definition);

        public bool TryGetAction(string id, out AvatarActionDefinition definition)
        {
            foreach (var candidate in _actions)
            {
                if (candidate != null && candidate.Id == id && candidate.Clip != null)
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
            AvatarActionDefinition[] actions,
            bool applyFootIK = true)
        {
            _baseClip = baseClip;
            _actions = actions ?? Array.Empty<AvatarActionDefinition>();
            _applyFootIK = applyFootIK;
        }
    }

    [Serializable]
    public sealed class AvatarActionDefinition
    {
        [SerializeField, HideInInspector] private AvatarPresetAction _action;
        [SerializeField] private string _id;
        [SerializeField] private string _displayName;
        [SerializeField] private AnimationClip _clip;
        [SerializeField] private float _speed = 1f;
        [SerializeField] private float _maximumDuration;

        public AvatarPresetAction Action => _action;
        public string Id => string.IsNullOrEmpty(_id) ? AvatarActionIds.FromPreset(_action) : _id;
        public string DisplayName => string.IsNullOrWhiteSpace(_displayName)
            ? (string.IsNullOrEmpty(_id) ? AvatarActionIds.PresetName(_action) : _id) : _displayName;
        internal bool HasValidTiming => !float.IsNaN(_speed) && !float.IsInfinity(_speed) && _speed > 0f
            && !float.IsNaN(_maximumDuration) && !float.IsInfinity(_maximumDuration) && _maximumDuration >= 0f;
        public AnimationClip Clip => _clip;
        public float Speed => Mathf.Max(0.01f, _speed);
        public float Duration => _maximumDuration > 0f
            ? Mathf.Min(_maximumDuration, _clip != null ? _clip.length / Speed : 0f)
            : (_clip != null ? _clip.length / Speed : 0f);

        internal AvatarActionDefinition(
            string id, string displayName, AnimationClip clip, float maximumDuration = 0f, float speed = 1f)
        {
            _id = id;
            _displayName = displayName;
            _clip = clip;
            _maximumDuration = maximumDuration;
            _speed = speed;
        }

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
