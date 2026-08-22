using System;
using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;

namespace Katarune.Avatar
{
    [DefaultExecutionOrder(9000)]
    public sealed class AvatarMotionController : MonoBehaviour, IAvatarMotionPoseSource
    {
        private AvatarMotionLibrary _library;
        private IAvatarMotionInstance _active;
        private AvatarActivityState _activity = AvatarActivityState.Idle;

        public event Action Changed;

        public bool LibraryAvailable => _library != null && _library.IsValid;
        public bool HasAuthoredBodyPose => _active?.HasAuthoredBodyPose ?? false;
        public float ProceduralBodyWeight => _active?.ProceduralBodyWeight ?? 1f;
        public float ProceduralArmWeight => _active?.ProceduralArmWeight ?? 1f;
        public AvatarPresetAction? CurrentAction => _active?.CurrentAction;
        public ulong ActionSequence => _active?.ActionSequence ?? 0UL;
        public AvatarActionCapabilities Actions => _active?.Actions ?? AvatarActionCapabilities.None;

        public AvatarMotionSnapshot Snapshot => new AvatarMotionSnapshot(
            LibraryAvailable,
            HasAuthoredBodyPose,
            CurrentAction,
            ActionSequence);

        public void Configure(AvatarMotionLibrary library = null)
        {
            Configure(library, loadFromResources: true);
        }

        internal void Configure(AvatarMotionLibrary library, bool loadFromResources)
        {
            _library = library != null
                ? library
                : (loadFromResources ? Resources.Load<AvatarMotionLibrary>("AvatarMotionLibrary") : null);
            if (_library != null && !_library.IsValid)
            {
                Debug.LogWarning("Katarune avatar motion library is incomplete; procedural fallback remains active.");
                _library = null;
            }
        }

        internal IAvatarMotionInstance Prepare(ICharacterRigBinding rigBinding)
        {
            if (!LibraryAvailable) return null;
            if (rigBinding == null) throw new ArgumentNullException(nameof(rigBinding));
            if ((rigBinding.Capabilities & CharacterRigCapabilities.HumanoidBody) == 0)
            {
                throw new InvalidOperationException(
                    "The character rig does not provide Humanoid body playback.");
            }
            return new AvatarMotionInstance(rigBinding.HumanoidAnimator, _library, _activity);
        }

        internal IAvatarMotionInstance ReplaceActive(IAvatarMotionInstance next, bool notify = true)
        {
            var previous = _active;
            if (previous != null) previous.Changed -= OnActiveChanged;
            _active = next;
            if (_active != null)
            {
                _active.SetActivity(_activity);
                _active.Changed += OnActiveChanged;
            }
            if (notify) Changed?.Invoke();
            return previous;
        }

        public void SetActivity(AvatarActivityState activity)
        {
            _activity = activity;
            _active?.SetActivity(activity);
        }

        public AvatarActionRequestResult RequestAction(AvatarPresetAction action)
        {
            if (!Enum.IsDefined(typeof(AvatarPresetAction), action))
            {
                throw new ArgumentOutOfRangeException(nameof(action), action, null);
            }
            if (_active == null)
            {
                return new AvatarActionRequestResult(
                    AvatarActionRequestOutcome.Unavailable,
                    "The active avatar has no installed motion library.");
            }
            return _active.RequestAction(action);
        }

        public void CancelAction() => _active?.CancelAction();

        private void LateUpdate()
        {
            _active?.Tick(Time.deltaTime);
        }

        private void OnActiveChanged() => Changed?.Invoke();

        private void OnDestroy()
        {
            var previous = ReplaceActive(null);
            previous?.Dispose();
        }
    }

    internal sealed class AvatarMotionInstance : IAvatarMotionInstance
    {
        internal const float BaseFadeSeconds = 0.25f;
        internal const float ActionFadeInSeconds = 0.18f;
        internal const float ActionFadeOutSeconds = 0.20f;

        private readonly Animator _animator;
        private readonly AvatarMotionLibrary _library;
        private readonly Vector3 _rootLocalPosition;
        private readonly Quaternion _rootLocalRotation;
        private readonly AnimationClipPlayable[] _basePlayables = new AnimationClipPlayable[2];
        private readonly AnimationClipPlayable[] _actionPlayables = new AnimationClipPlayable[2];
        private PlayableGraph _graph;
        private AnimationMixerPlayable _baseMixer;
        private AnimationMixerPlayable _actionMixer;
        private AnimationMixerPlayable _finalMixer;
        private int _baseSlot;
        private int _baseIncomingSlot = -1;
        private float _baseBlendElapsed;
        private int _actionSlot = -1;
        private int _actionIncomingSlot = -1;
        private float _actionBlendElapsed;
        private float _actionElapsed;
        private float _actionDuration;
        private float _actionWeight;
        private bool _actionEnding;
        private bool _overlayActive;
        private AvatarActivityState _activity;
        private bool _disposed;

        public AvatarMotionInstance(
            Animator animator,
            AvatarMotionLibrary library,
            AvatarActivityState initialActivity)
        {
            _animator = animator != null ? animator : throw new ArgumentNullException(nameof(animator));
            _library = library != null && library.IsValid
                ? library
                : throw new ArgumentException("A complete motion library is required.", nameof(library));
            if (!_animator.isHuman || _animator.avatar == null || !_animator.avatar.isValid)
            {
                throw new InvalidOperationException("The VRM control rig has no valid humanoid Animator.");
            }

            _rootLocalPosition = _animator.transform.localPosition;
            _rootLocalRotation = _animator.transform.localRotation;
            _animator.applyRootMotion = false;
            _animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
            _graph = PlayableGraph.Create($"Katarune Avatar Motion - {_animator.name}");
            _graph.SetTimeUpdateMode(DirectorUpdateMode.GameTime);
            _baseMixer = AnimationMixerPlayable.Create(_graph, 2, true);
            _actionMixer = AnimationMixerPlayable.Create(_graph, 2, true);
            _finalMixer = AnimationMixerPlayable.Create(_graph, 2, true);
            _graph.Connect(_baseMixer, 0, _finalMixer, 0);
            _graph.Connect(_actionMixer, 0, _finalMixer, 1);
            _finalMixer.SetInputWeight(0, 1f);
            _finalMixer.SetInputWeight(1, 0f);
            var output = AnimationPlayableOutput.Create(_graph, "Avatar Humanoid Motion", _animator);
            output.SetSourcePlayable(_finalMixer);
            _activity = initialActivity;
            CreateBasePlayable(0, initialActivity, 1f);
            _graph.Play();
        }

        public event Action Changed;

        public AvatarActionCapabilities Actions => _library.Actions;
        public bool HasAuthoredBodyPose => !_disposed && _graph.IsValid();
        public float ProceduralBodyWeight => GetProceduralWeight(_activity) * (1f - _actionWeight);
        public float ProceduralArmWeight => 0f;
        public AvatarPresetAction? CurrentAction { get; private set; }
        public ulong ActionSequence { get; private set; }

        public void SetActivity(AvatarActivityState activity)
        {
            ThrowIfDisposed();
            if (_activity == activity) return;
            _activity = activity;
            var incoming = 1 - _baseSlot;
            DestroyBasePlayable(incoming);
            CreateBasePlayable(incoming, activity, 0f);
            _baseIncomingSlot = incoming;
            _baseBlendElapsed = 0f;
        }

        public AvatarActionRequestResult RequestAction(AvatarPresetAction action)
        {
            ThrowIfDisposed();
            if (!_library.TryGetAction(action, out var definition))
            {
                return new AvatarActionRequestResult(
                    AvatarActionRequestOutcome.Unavailable,
                    $"The preset action '{action}' is not installed.");
            }

            if (CurrentAction == action && _actionSlot >= 0 && _actionIncomingSlot < 0)
            {
                _actionPlayables[_actionSlot].SetTime(0d);
                _actionElapsed = 0f;
                _actionDuration = definition.Duration;
                _actionEnding = false;
                ActionSequence += 1;
                Changed?.Invoke();
                return new AvatarActionRequestResult(AvatarActionRequestOutcome.Started);
            }
            StartOverlay(definition.Clip, definition.Speed, definition.Duration, action);
            ActionSequence += 1;
            return new AvatarActionRequestResult(AvatarActionRequestOutcome.Started);
        }

        private void CancelOverlay()
        {
            ThrowIfDisposed();
            if (_overlayActive) _actionEnding = true;
        }

        public void CancelAction()
        {
            ThrowIfDisposed();
            CancelOverlay();
        }

        public void Tick(float deltaTime)
        {
            ThrowIfDisposed();
            deltaTime = Mathf.Max(0f, deltaTime);
            TickBaseBlend(deltaTime);
            TickActionBlend(deltaTime);

            if (_overlayActive && !_actionEnding)
            {
                _actionElapsed += deltaTime;
                if (_actionDuration <= 0f || _actionElapsed >= _actionDuration) _actionEnding = true;
            }

            var fadeSeconds = _actionEnding ? ActionFadeOutSeconds : ActionFadeInSeconds;
            var target = _overlayActive && !_actionEnding ? 1f : 0f;
            _actionWeight = Mathf.MoveTowards(
                _actionWeight,
                target,
                fadeSeconds <= 0f ? 1f : deltaTime / fadeSeconds);
            _finalMixer.SetInputWeight(0, 1f - _actionWeight);
            _finalMixer.SetInputWeight(1, _actionWeight);

            if (_actionEnding && _actionWeight <= 0f) FinishAction();
            _animator.transform.localPosition = _rootLocalPosition;
            _animator.transform.localRotation = _rootLocalRotation;
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            if (_graph.IsValid()) _graph.Destroy();
            if (_animator != null)
            {
                _animator.applyRootMotion = false;
                _animator.transform.localPosition = _rootLocalPosition;
                _animator.transform.localRotation = _rootLocalRotation;
            }
        }

        private void TickBaseBlend(float deltaTime)
        {
            if (_baseIncomingSlot < 0) return;
            _baseBlendElapsed += deltaTime;
            var progress = BaseFadeSeconds <= 0f ? 1f : Mathf.Clamp01(_baseBlendElapsed / BaseFadeSeconds);
            _baseMixer.SetInputWeight(_baseSlot, 1f - progress);
            _baseMixer.SetInputWeight(_baseIncomingSlot, progress);
            if (progress < 1f) return;
            DestroyBasePlayable(_baseSlot);
            _baseSlot = _baseIncomingSlot;
            _baseIncomingSlot = -1;
        }

        private void TickActionBlend(float deltaTime)
        {
            if (_actionIncomingSlot < 0) return;
            _actionBlendElapsed += deltaTime;
            var progress = ActionFadeInSeconds <= 0f
                ? 1f
                : Mathf.Clamp01(_actionBlendElapsed / ActionFadeInSeconds);
            _actionMixer.SetInputWeight(_actionSlot, 1f - progress);
            _actionMixer.SetInputWeight(_actionIncomingSlot, progress);
            if (progress < 1f) return;
            DestroyActionPlayable(_actionSlot);
            _actionSlot = _actionIncomingSlot;
            _actionIncomingSlot = -1;
        }

        private void FinishAction()
        {
            DestroyActionPlayable(_actionSlot);
            if (_actionIncomingSlot >= 0) DestroyActionPlayable(_actionIncomingSlot);
            _actionSlot = -1;
            _actionIncomingSlot = -1;
            _actionEnding = false;
            _actionElapsed = 0f;
            _actionDuration = 0f;
            CurrentAction = null;
            _overlayActive = false;
            Changed?.Invoke();
        }

        private void StartOverlay(
            AnimationClip clip,
            float speed,
            float duration,
            AvatarPresetAction action)
        {
            var incoming = _actionSlot < 0 ? 0 : 1 - _actionSlot;
            DestroyActionPlayable(incoming);
            var playable = AnimationClipPlayable.Create(_graph, clip);
            playable.SetApplyFootIK(true);
            playable.SetApplyPlayableIK(false);
            playable.SetSpeed(Mathf.Max(0.01f, speed));
            playable.SetTime(0d);
            _graph.Connect(playable, 0, _actionMixer, incoming);
            _actionMixer.SetInputWeight(incoming, _actionSlot < 0 ? 1f : 0f);
            _actionPlayables[incoming] = playable;
            _actionIncomingSlot = _actionSlot < 0 ? -1 : incoming;
            if (_actionSlot < 0) _actionSlot = incoming;
            _actionBlendElapsed = 0f;
            _actionElapsed = 0f;
            _actionDuration = Mathf.Max(0.01f, duration);
            _actionEnding = false;
            _overlayActive = true;
            CurrentAction = action;
            Changed?.Invoke();
        }

        private void CreateBasePlayable(int slot, AvatarActivityState activity, float weight)
        {
            if (!_library.TryGetBase(activity, out var clip))
            {
                throw new InvalidOperationException($"No loop clip is configured for '{activity}'.");
            }
            var playable = AnimationClipPlayable.Create(_graph, clip);
            playable.SetApplyFootIK(true);
            playable.SetApplyPlayableIK(false);
            playable.SetTime(0d);
            _graph.Connect(playable, 0, _baseMixer, slot);
            _baseMixer.SetInputWeight(slot, weight);
            _basePlayables[slot] = playable;
        }

        private void DestroyBasePlayable(int slot)
        {
            var playable = _basePlayables[slot];
            if (!playable.IsValid()) return;
            _graph.Disconnect(_baseMixer, slot);
            _graph.DestroyPlayable(playable);
            _basePlayables[slot] = default;
        }

        private void DestroyActionPlayable(int slot)
        {
            if (slot < 0) return;
            var playable = _actionPlayables[slot];
            if (!playable.IsValid()) return;
            _graph.Disconnect(_actionMixer, slot);
            _graph.DestroyPlayable(playable);
            _actionPlayables[slot] = default;
            _actionMixer.SetInputWeight(slot, 0f);
        }

        private static float GetProceduralWeight(AvatarActivityState activity)
        {
            switch (activity)
            {
                case AvatarActivityState.Listening: return 0.55f;
                case AvatarActivityState.Thinking: return 0.15f;
                case AvatarActivityState.Speaking: return 0.20f;
                default: return 0.45f;
            }
        }

        private void ThrowIfDisposed()
        {
            if (_disposed) throw new ObjectDisposedException(nameof(AvatarMotionInstance));
        }
    }
}
