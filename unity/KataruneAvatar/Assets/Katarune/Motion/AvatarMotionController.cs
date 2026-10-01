using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;

namespace Katarune.Avatar
{
    [DefaultExecutionOrder(9000)]
    public sealed class AvatarMotionController : MonoBehaviour, IAvatarMotionPoseSource
    {
        private AvatarMotionLibrary _library;
        private BehaviorDefinitionCatalog _behaviorCatalog;
        private IAvatarMotionInstance _active;
        private AvatarMotionPacks _packs;
        private readonly List<AvatarActionInfo> _availableActions = new();
        public IReadOnlyList<AvatarActionInfo> AvailableActions => _active is IAvatarMotionCatalog package ? package.AvailableActions : _availableActions;
        public string PackDiagnostics => _packs == null ? string.Empty : string.Join("\n", _packs.Diagnostics);

        public event Action Changed;

        public bool LibraryAvailable => HasInstalledLibrary || (_active?.HasAuthoredBodyPose ?? false);
        private bool HasInstalledLibrary => (_library != null && _library.IsValid) || HasBehaviorBase();
        public bool HasAuthoredBodyPose => _active?.HasAuthoredBodyPose ?? false;
        public float ProceduralBodyWeight => _active?.ProceduralBodyWeight ?? 1f;
        public float ProceduralArmWeight => _active?.ProceduralArmWeight ?? 1f;
        public AvatarPresetAction? CurrentAction => _active?.CurrentAction;
        public ulong ActionSequence => _active?.ActionSequence ?? 0UL;
        public AvatarActionCapabilities Actions => _active?.Actions ?? AvatarActionCapabilities.None;
        public long PerformanceRevision => _active?.PerformanceRevision ?? 0L;
        public int ActivePerformanceCount => _active?.ActivePerformanceCount ?? 0;
        public int QueuedPerformanceCount => _active?.QueuedPerformanceCount ?? 0;
        public string PerformanceDiagnostics => _active?.PerformanceDiagnostics ?? string.Empty;

        public AvatarMotionSnapshot Snapshot => new AvatarMotionSnapshot(
            LibraryAvailable,
            HasAuthoredBodyPose,
            CurrentAction,
            ActionSequence,
            PerformanceRevision,
            ActivePerformanceCount,
            QueuedPerformanceCount,
            PerformanceDiagnostics, _active?.CurrentActionId);

        public async Task LoadExternalPacksAsync(string directory, CancellationToken cancellationToken)
        {
            if (_packs != null || _active != null) throw new InvalidOperationException("Load motion packs before preparing the avatar.");
            _packs = new AvatarMotionPacks();
            await _packs.LoadAsync(directory, cancellationToken);
            Configure(_packs.Library, Resources.Load<BehaviorDefinitionCatalog>("BehaviorDefinitionCatalog"), loadFromResources: false);
        }

        public void Configure(AvatarMotionLibrary library = null)
        {
            Configure(library, null, loadFromResources: true);
        }

        internal void Configure(
            AvatarMotionLibrary library,
            bool loadFromResources) => Configure(library, null, loadFromResources);

        internal void Configure(
            AvatarMotionLibrary library,
            BehaviorDefinitionCatalog behaviorCatalog,
            bool loadFromResources)
        {
            _library = library != null
                ? library
                : (loadFromResources ? Resources.Load<AvatarMotionLibrary>("AvatarMotionLibrary") : null);
            if (_library != null && !_library.IsValid)
            {
                Debug.LogWarning("Katarune avatar motion library is incomplete; procedural fallback remains active.");
                _library = null;
            }
            _behaviorCatalog = behaviorCatalog != null
                ? behaviorCatalog
                : (loadFromResources
                    ? Resources.Load<BehaviorDefinitionCatalog>("BehaviorDefinitionCatalog")
                    : null);
            if (_behaviorCatalog != null && !_behaviorCatalog.IsValid)
            {
                Debug.LogWarning("Katarune behavior definition catalog is empty; scheduler requests remain unavailable.");
                _behaviorCatalog = null;
            }
            _availableActions.Clear();
            if (_library != null)
                foreach (var action in _library.Definitions)
                    if (action != null && action.Clip != null && !IsScheduledAction(action.Id))
                        _availableActions.Add(new AvatarActionInfo(
                            action.Id,
                            action.DisplayName,
                            action.Duration));
        }

        private bool IsScheduledAction(string id)
        {
            if (id != "explain" || _behaviorCatalog == null) return false;
            foreach (var definition in _behaviorCatalog.Definitions)
                if (definition != null && definition.BehaviorId == "katarune.performance.explain") return true;
            return false;
        }

        internal IAvatarMotionInstance Prepare(ICharacterRigBinding rigBinding)
        {
            if (!HasInstalledLibrary) return null;
            if (rigBinding == null) throw new ArgumentNullException(nameof(rigBinding));
            if ((rigBinding.Capabilities & CharacterRigCapabilities.HumanoidBody) == 0)
            {
                throw new InvalidOperationException(
                    "The character rig does not provide Humanoid body playback.");
            }
            return new AvatarMotionInstance(
                rigBinding.HumanoidAnimator,
                _library,
                _behaviorCatalog?.Definitions,
                rigBinding.Capabilities);
        }

        internal IAvatarMotionInstance ReplaceActive(IAvatarMotionInstance next, bool notify = true)
        {
            var previous = _active;
            if (previous != null) previous.Changed -= OnActiveChanged;
            _active = next;
            if (_active != null)
            {
                _active.Changed += OnActiveChanged;
            }
            if (notify) Changed?.Invoke();
            return previous;
        }

        public AvatarActionRequestResult RequestAction(AvatarPresetAction action)
            => RequestAction(AvatarActionIds.FromPreset(action));

        public AvatarActionRequestResult RequestAction(string action)
        {
            if (!AvatarActionIds.IsValid(action))
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

        public void CancelAllBehaviors() => _active?.CancelAllBehaviors();

        public BehaviorRequestResult RequestBehavior(
            BehaviorIntent intent,
            PerformanceRequestPolicy policy = PerformanceRequestPolicy.Queue)
        {
            if (_active == null)
            {
                return new BehaviorRequestResult(
                    BehaviorRequestOutcome.Unavailable,
                    error: "The active avatar has no installed motion runtime.");
            }
            return _active.RequestBehavior(intent, policy);
        }

        public PerformanceTransitionOutcome ApplyPerformanceCommand(
            string instanceId,
            PerformanceCommand command) =>
            _active?.ApplyPerformanceCommand(instanceId, command)
            ?? PerformanceTransitionOutcome.Rejected;

        private void LateUpdate()
        {
            _active?.Tick(Time.deltaTime);
        }

        private void OnActiveChanged()
        {
            if (_active != null && _active.PerformanceRevision > 0)
                Debug.Log($"KATARUNE_PERFORMANCE\n{_active.PerformanceDiagnostics}");
            Changed?.Invoke();
        }

        private bool HasBehaviorBase()
        {
            if (_behaviorCatalog == null) return false;
            var definitions = _behaviorCatalog.Definitions;
            for (var index = 0; index < definitions.Count; index += 1)
            {
                var definition = definitions[index];
                if (definition == null || definition.Clip == null) continue;
                for (var claimIndex = 0; claimIndex < definition.ChannelClaims.Count; claimIndex += 1)
                {
                    if (definition.ChannelClaims[claimIndex].Channel == PerformanceChannel.BodyBase)
                        return true;
                }
            }
            return false;
        }

        private void OnApplicationQuit() => ReleaseResources();
        private void OnDestroy() => ReleaseResources();

        private void ReleaseResources()
        {
            var previous = ReplaceActive(null, notify: false);
            previous?.Dispose();
            _packs?.Dispose();
        }
    }

    internal sealed class AvatarMotionInstance : IAvatarMotionInstance, IBehaviorPerformanceSink
    {
        internal const float ActionTransitionSeconds = 0.25f;
        internal const float PerformanceFadeInSeconds = 0.20f;
        internal const float PerformanceFadeOutSeconds = 0.25f;
        internal const float PerformanceSafeExitFadeOutSeconds = 0.20f;
        internal const float PerformanceImmediateCancelFadeOutSeconds = 0.12f;

        private readonly Animator _animator;
        private readonly AvatarMotionLibrary _library;
        private readonly AnimationClip _fallbackBaseClip;
        private readonly BehaviorPerformanceRuntime _performances;
        private readonly Vector3 _rootLocalPosition;
        private readonly Quaternion _rootLocalRotation;
        private readonly List<MotionClip> _motionClips = new List<MotionClip>();
        private MotionClip _actionClip;
        private int _transitionTarget;
        private float _transitionElapsed = ActionTransitionSeconds;
        private PlayableGraph _graph;
        private AnimationMixerPlayable _motionMixer;
        private AnimationMixerPlayable _performanceMixer;
        private AnimationLayerMixerPlayable _finalMixer;
        private readonly Dictionary<string, ScheduledPlayable> _scheduledPlayables =
            new Dictionary<string, ScheduledPlayable>(StringComparer.Ordinal);
        private float _actionDuration;
        private float _performanceWeight;
        private bool _returningToIdle;
        private bool _disposed;

        public AvatarMotionInstance(
            Animator animator,
            AvatarMotionLibrary library,
            IReadOnlyList<BehaviorDefinitionAsset> behaviorDefinitions,
            CharacterRigCapabilities rigCapabilities)
        {
            _animator = animator != null ? animator : throw new ArgumentNullException(nameof(animator));
            _library = library != null && library.IsValid ? library : null;
            if (_library == null && behaviorDefinitions != null)
            {
                for (var index = 0; index < behaviorDefinitions.Count; index += 1)
                {
                    var candidate = behaviorDefinitions[index];
                    if (candidate == null) continue;
                    for (var claimIndex = 0; claimIndex < candidate.ChannelClaims.Count; claimIndex += 1)
                    {
                        if (candidate.ChannelClaims[claimIndex].Channel == PerformanceChannel.BodyBase)
                        {
                            _fallbackBaseClip = candidate.Clip;
                            break;
                        }
                    }
                    if (_fallbackBaseClip != null) break;
                }
            }
            if (_library == null && _fallbackBaseClip == null)
            {
                throw new ArgumentException(
                    "A motion library or a behavior base clip is required.",
                    nameof(library));
            }
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
            _motionMixer = AnimationMixerPlayable.Create(_graph, 1);
            _performanceMixer = AnimationMixerPlayable.Create(_graph, 2);
            _finalMixer = AnimationLayerMixerPlayable.Create(_graph, 2);
            var output = AnimationPlayableOutput.Create(_graph, "Avatar Humanoid Motion", _animator);
            output.SetSourcePlayable(_finalMixer);
            _graph.Connect(_motionMixer, 0, _finalMixer, 0);
            _graph.Connect(_performanceMixer, 0, _finalMixer, 1);
            _finalMixer.SetInputWeight(0, 1f);
            _finalMixer.SetInputWeight(1, 0f);
            CreateMotionClip(GetBaseClip(), 1f, 0);
            _motionMixer.SetInputWeight(0, 1f);
            _performances = new BehaviorPerformanceRuntime(
                behaviorDefinitions,
                rigCapabilities,
                this);
            _performances.Changed += OnPerformanceChanged;
            _graph.Play();
        }

        public event Action Changed;

        public AvatarActionCapabilities Actions => _performances.ContainsDefinition("katarune.performance.explain")
            ? (_library?.Actions ?? AvatarActionCapabilities.None) & ~AvatarActionCapabilities.Explain
            : _library?.Actions ?? AvatarActionCapabilities.None;
        public bool HasAuthoredBodyPose => !_disposed && _graph.IsValid();
        public float ProceduralBodyWeight => 0.45f
            * Mathf.Min(_motionMixer.GetInputWeight(0), 1f - _performanceWeight);
        public float ProceduralArmWeight => 0f;
        public string CurrentActionId { get; private set; }
        public AvatarPresetAction? CurrentAction => AvatarActionIds.ToPreset(CurrentActionId);
        public ulong ActionSequence { get; private set; }
        public long PerformanceRevision => _performances.Scheduler.Revision;
        public int ActivePerformanceCount => _performances.Scheduler.ActiveInstances.Count;
        public int QueuedPerformanceCount => _performances.Scheduler.QueuedInstances.Count;
        public string PerformanceDiagnostics => _performances.FormatDiagnostics();

        public AvatarActionRequestResult RequestAction(AvatarPresetAction action)
            => RequestAction(AvatarActionIds.FromPreset(action));

        public AvatarActionRequestResult RequestAction(string action)
        {
            ThrowIfDisposed();
            if (action == AvatarActionIds.FromPreset(AvatarPresetAction.Explain)
                && _performances.ContainsDefinition("katarune.performance.explain"))
            {
                return new AvatarActionRequestResult(
                    AvatarActionRequestOutcome.Unavailable,
                    "Explain is provided by behavior 'katarune.performance.explain'.");
            }
            if (HasScheduledBodyWork())
            {
                return new AvatarActionRequestResult(
                    AvatarActionRequestOutcome.Unavailable,
                    "A scheduled body performance owns or is waiting for a body channel.");
            }
            if (_library == null || !_library.TryGetAction(action, out var definition))
            {
                return new AvatarActionRequestResult(
                    AvatarActionRequestOutcome.Unavailable,
                    $"The preset action '{action}' is not installed.");
            }

            if (CurrentActionId == action && !_returningToIdle)
                return new AvatarActionRequestResult(AvatarActionRequestOutcome.Started);

            _actionDuration = definition.Duration * definition.Speed;
            _actionClip = GetActionClip(definition);
            BeginTransition(_actionClip.Input);
            _returningToIdle = false;
            CurrentActionId = action;
            ActionSequence += 1;
            Changed?.Invoke();
            return new AvatarActionRequestResult(AvatarActionRequestOutcome.Started);
        }

        public void CancelAction()
        {
            ThrowIfDisposed();
            if (CurrentActionId != null && !_returningToIdle)
            {
                ActionSequence += 1;
                ReturnToIdle();
                Changed?.Invoke();
            }
        }

        public BehaviorRequestResult RequestBehavior(
            BehaviorIntent intent,
            PerformanceRequestPolicy policy)
        {
            ThrowIfDisposed();
            if (CurrentActionId != null && _performances.ClaimsBodyChannel(intent.BehaviorId))
            {
                return new BehaviorRequestResult(
                    BehaviorRequestOutcome.Rejected,
                    error: "The current preset action must finish before scheduled body playback starts.");
            }
            return _performances.Request(intent, policy);
        }

        public PerformanceTransitionOutcome ApplyPerformanceCommand(
            string instanceId,
            PerformanceCommand command)
        {
            ThrowIfDisposed();
            return _performances.Apply(instanceId, command);
        }

        public void CancelAllBehaviors()
        {
            ThrowIfDisposed();
            var instances = _performances.Scheduler.Instances;
            for (var index = instances.Count - 1; index >= 0; index -= 1)
            {
                if (!instances[index].IsTerminal)
                {
                    _performances.Apply(
                        instances[index].InstanceId,
                        PerformanceCommand.CancelImmediate());
                }
            }
        }

        public void Tick(float deltaTime)
        {
            ThrowIfDisposed();
            deltaTime = Mathf.Max(0f, deltaTime);
            _performances.Tick(deltaTime);
            TickScheduledBlend(deltaTime);
            TickMotionBlend(deltaTime);

            if (_actionClip != null && !_returningToIdle && _actionClip.Playable.GetTime() >= _actionDuration)
                ReturnToIdle();
            if (_returningToIdle && _transitionElapsed >= ActionTransitionSeconds)
            {
                _returningToIdle = false;
                _actionClip = null;
                CurrentActionId = null;
                Changed?.Invoke();
            }
            _animator.transform.localPosition = _rootLocalPosition;
            _animator.transform.localRotation = _rootLocalRotation;
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            _performances.Changed -= OnPerformanceChanged;
            _performances.Dispose();
            if (_graph.IsValid()) _graph.Destroy();
            if (_animator != null)
            {
                _animator.applyRootMotion = false;
                _animator.transform.localPosition = _rootLocalPosition;
                _animator.transform.localRotation = _rootLocalRotation;
            }
        }

        private void ReturnToIdle()
        {
            if (_returningToIdle) return;
            BeginTransition(0);
            _returningToIdle = true;
        }

        private void BeginTransition(int target)
        {
            // Capture every contributing input, not just the last requested action.
            // w_i(u) = (1-u) * w_i(now) + u * (i == target ? 1 : 0).
            // This preserves the current pose and a total weight of one on interruption.
            foreach (var clip in _motionClips)
                clip.StartWeight = _motionMixer.GetInputWeight(clip.Input);
            _transitionTarget = target;
            _transitionElapsed = 0f;
        }

        private void TickMotionBlend(float deltaTime)
        {
            if (_transitionElapsed >= ActionTransitionSeconds) return;
            _transitionElapsed = Mathf.Min(ActionTransitionSeconds, _transitionElapsed + deltaTime);
            var progress = _transitionElapsed / ActionTransitionSeconds;
            foreach (var clip in _motionClips)
            {
                var weight = Mathf.Lerp(clip.StartWeight, clip.Input == _transitionTarget ? 1f : 0f, progress);
                _motionMixer.SetInputWeight(clip.Input, weight);
                if (clip.Input != 0 && clip.Input != _transitionTarget && weight == 0f)
                    clip.Playable.Pause();
            }
        }

        private MotionClip GetActionClip(AvatarActionDefinition definition)
        {
            var reusableInput = _motionClips.Count;
            for (var input = 1; input < _motionClips.Count; input++)
            {
                var clip = _motionClips[input];
                if (_motionMixer.GetInputWeight(input) == 0f)
                {
                    reusableInput = Mathf.Min(reusableInput, input);
                    continue;
                }
                if (clip.Playable.GetAnimationClip() == definition.Clip
                    && clip.Playable.GetTime() < _actionDuration)
                    return clip; // Do not rewind a pose which is still contributing.
            }
            // An ended but still visible instance must fade out alongside a fresh one.
            // Only zero-weight slots can be replaced, keeping storage bounded by overlap.
            return CreateMotionClip(definition.Clip, definition.Speed, reusableInput);
        }

        private MotionClip CreateMotionClip(AnimationClip clip, float speed, int input)
        {
            if (input < _motionClips.Count)
            {
                _graph.Disconnect(_motionMixer, input);
                _graph.DestroyPlayable(_motionClips[input].Playable);
            }
            else _motionMixer.SetInputCount(input + 1);
            var playable = AnimationClipPlayable.Create(_graph, clip);
            playable.SetApplyFootIK(_library == null || _library.ApplyFootIK);
            playable.SetApplyPlayableIK(false);
            playable.SetSpeed(speed);
            _graph.Connect(playable, 0, _motionMixer, input);
            _motionMixer.SetInputWeight(input, 0f);
            var state = new MotionClip(input, playable);
            if (input == _motionClips.Count) _motionClips.Add(state);
            else _motionClips[input] = state;
            return state;
        }

        private sealed class MotionClip
        {
            public MotionClip(int input, AnimationClipPlayable playable)
            {
                Input = input;
                Playable = playable;
            }
            public int Input { get; }
            public AnimationClipPlayable Playable { get; }
            public float StartWeight { get; set; }
        }

        private AnimationClip GetBaseClip()
        {
            AnimationClip clip = null;
            if ((_library == null || !_library.TryGetBase(out clip))
                && (clip = _fallbackBaseClip) == null)
            {
                throw new InvalidOperationException("No base loop clip is configured.");
            }
            return clip;
        }

        private void ThrowIfDisposed()
        {
            if (_disposed) throw new ObjectDisposedException(nameof(AvatarMotionInstance));
        }

        void IBehaviorPerformanceSink.Begin(
            string instanceId,
            BehaviorDefinitionAsset definition,
            float clipTime)
        {
            if (!ClaimsFullBody(definition) || definition.AvatarMask != null)
            {
                throw new InvalidOperationException(
                    $"Scheduled body behavior '{definition.BehaviorId}' must currently be an unmasked full-body performance.");
            }
            var input = FindScheduledInput();
            if (input >= _performanceMixer.GetInputCount())
                _performanceMixer.SetInputCount(input + 1);
            var playable = AnimationClipPlayable.Create(_graph, definition.Clip);
            playable.SetApplyFootIK(true);
            playable.SetApplyPlayableIK(false);
            playable.SetSpeed(0d);
            playable.SetTime(clipTime);
            _graph.Connect(playable, 0, _performanceMixer, input);
            _performanceMixer.SetInputWeight(input, 0f);
            var scheduled = new ScheduledPlayable(input, playable);
            scheduled.BeginFade(1f, PerformanceFadeInSeconds);
            _scheduledPlayables.Add(instanceId, scheduled);
        }

        void IBehaviorPerformanceSink.SetTime(string instanceId, float clipTime)
        {
            if (_scheduledPlayables.TryGetValue(instanceId, out var scheduled)
                && scheduled.Playable.IsValid())
                scheduled.Playable.SetTime(clipTime);
        }

        void IBehaviorPerformanceSink.SetPaused(string instanceId, bool paused)
        {
            // Clip time is authored by BehaviorPlaybackCursor, so pausing is represented by not advancing it.
        }

        void IBehaviorPerformanceSink.End(string instanceId, PerformanceEndReason reason)
        {
            if (!_scheduledPlayables.TryGetValue(instanceId, out var scheduled)) return;
            scheduled.Ended = true;
            scheduled.BeginFade(0f, FadeOutSeconds(reason));
        }

        private void TickScheduledBlend(float deltaTime)
        {
            if (_scheduledPlayables.Count == 0)
            {
                _performanceWeight = 0f;
                _finalMixer.SetInputWeight(1, 0f);
                return;
            }

            List<string> completed = null;
            var totalWeight = 0f;
            foreach (var pair in _scheduledPlayables)
            {
                var scheduled = pair.Value;
                scheduled.Tick(deltaTime);
                totalWeight += scheduled.Weight;
                if (scheduled.Ended && scheduled.Weight <= 0f)
                    (completed ??= new List<string>()).Add(pair.Key);
            }

            var normalizedTotal = Mathf.Max(0.0001f, totalWeight);
            foreach (var scheduled in _scheduledPlayables.Values)
            {
                _performanceMixer.SetInputWeight(
                    scheduled.Input,
                    scheduled.Weight / normalizedTotal);
            }
            _performanceWeight = Mathf.Clamp01(totalWeight);
            _finalMixer.SetInputWeight(1, _performanceWeight);

            if (completed == null) return;
            for (var index = 0; index < completed.Count; index += 1)
            {
                var instanceId = completed[index];
                var scheduled = _scheduledPlayables[instanceId];
                _scheduledPlayables.Remove(instanceId);
                if (!scheduled.Playable.IsValid()) continue;
                _graph.Disconnect(_performanceMixer, scheduled.Input);
                _graph.DestroyPlayable(scheduled.Playable);
                _performanceMixer.SetInputWeight(scheduled.Input, 0f);
            }
        }

        private int FindScheduledInput()
        {
            for (var input = 0; input < _performanceMixer.GetInputCount(); input += 1)
            {
                if (!_performanceMixer.GetInput(input).IsValid()) return input;
            }
            return _performanceMixer.GetInputCount();
        }

        private static bool ClaimsFullBody(BehaviorDefinitionAsset definition)
        {
            for (var index = 0; index < definition.ChannelClaims.Count; index += 1)
            {
                if (definition.ChannelClaims[index].Channel
                    == PerformanceChannel.BodyFullPerformance) return true;
            }
            return false;
        }

        private static float FadeOutSeconds(PerformanceEndReason reason)
        {
            switch (reason)
            {
                case PerformanceEndReason.CancelledImmediate:
                case PerformanceEndReason.Failed:
                    return PerformanceImmediateCancelFadeOutSeconds;
                case PerformanceEndReason.ExitedAtSafePoint:
                    return PerformanceSafeExitFadeOutSeconds;
                default:
                    return PerformanceFadeOutSeconds;
            }
        }

        private bool HasScheduledBodyWork()
        {
            var instances = _performances.Scheduler.Instances;
            for (var index = 0; index < instances.Count; index += 1)
            {
                var instance = instances[index];
                if (instance.IsTerminal) continue;
                if (instance.Plan.Claims(PerformanceChannel.BodyBase)
                    || instance.Plan.Claims(PerformanceChannel.BodyFullPerformance)
                    || instance.Plan.Claims(PerformanceChannel.GestureUpperBody)) return true;
            }
            return false;
        }

        private void OnPerformanceChanged() => Changed?.Invoke();

        private sealed class ScheduledPlayable
        {
            public ScheduledPlayable(int input, AnimationClipPlayable playable)
            {
                Input = input;
                Playable = playable;
            }

            public int Input { get; }
            public AnimationClipPlayable Playable { get; }
            public float Weight { get; private set; }
            public bool Ended { get; set; }

            private float _startWeight;
            private float _targetWeight;
            private float _duration;
            private float _elapsed;

            public void BeginFade(float targetWeight, float duration)
            {
                _startWeight = Weight;
                _targetWeight = Mathf.Clamp01(targetWeight);
                _duration = Mathf.Max(0f, duration);
                _elapsed = 0f;
                if (_duration <= 0f) Weight = _targetWeight;
            }

            public void Tick(float deltaTime)
            {
                if (Mathf.Approximately(Weight, _targetWeight)) return;
                _elapsed += Mathf.Max(0f, deltaTime);
                var progress = _duration <= 0f ? 1f : Mathf.Clamp01(_elapsed / _duration);
                Weight = Mathf.Lerp(_startWeight, _targetWeight,
                    Mathf.SmoothStep(0f, 1f, progress));
            }
        }
    }
}
