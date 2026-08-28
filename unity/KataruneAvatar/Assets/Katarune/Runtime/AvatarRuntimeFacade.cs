using System;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace Katarune.Avatar
{
    public sealed class AvatarRuntimeFacade : IAvatarRuntimeFacade
    {
        private readonly AvatarRuntimeSession _session;
        private readonly AvatarBehaviorController _behavior;
        private readonly AvatarVisualController _visuals;
        private readonly AvatarSceneRig _sceneRig;
        private readonly AvatarMotionController _motions;
        private AvatarPresentationSettings _presentation;
        private long _revision;
        private bool _disposed;

        internal AvatarRuntimeFacade(
            AvatarRuntimeSession session,
            AvatarBehaviorController behavior,
            AvatarVisualController visuals,
            AvatarSceneRig sceneRig,
            AvatarMotionController motions,
            AvatarPresentationSettings presentation)
        {
            _session = session ?? throw new ArgumentNullException(nameof(session));
            _behavior = behavior ?? throw new ArgumentNullException(nameof(behavior));
            _visuals = visuals ?? throw new ArgumentNullException(nameof(visuals));
            _sceneRig = sceneRig ?? throw new ArgumentNullException(nameof(sceneRig));
            _motions = motions ?? throw new ArgumentNullException(nameof(motions));
            _presentation = Normalize(presentation);
            _session.Changed += OnSessionChanged;
            _motions.Changed += OnMotionChanged;
            Snapshot = CreateSnapshot(_revision);
        }

        public AvatarRuntimeSnapshot Snapshot { get; private set; }
        public AvatarPoseFrame CurrentPose => _behavior.CurrentFrame;
        public event Action<AvatarRuntimeSnapshot> Changed;

        public async Task<AvatarLoadResult> LoadAsync(
            string path,
            CancellationToken cancellationToken = default)
        {
            ThrowIfDisposed();
            return await _session.LoadAsync(path, () => _presentation, cancellationToken);
        }

        public void Unload()
        {
            ThrowIfDisposed();
            _session.Unload();
        }

        public void ApplyBehavior(AvatarBehaviorSettings settings)
        {
            ThrowIfDisposed();
            var normalized = Normalize(settings);
            if (_behavior.Settings.Equals(normalized)) return;
            _behavior.ApplySettings(normalized);
            PublishIfChanged();
        }

        public void ApplyPresentation(AvatarPresentationSettings settings)
        {
            ThrowIfDisposed();
            var normalized = Normalize(settings);
            if (_presentation.Equals(normalized)) return;
            _presentation = normalized;
            _sceneRig.SetLightingMode(normalized.LightingMode);
            _visuals.SetSoftOutlineEnabled(normalized.SoftOutlineEnabled);
            PublishIfChanged();
        }

        public void SetManualVisemes(AvatarVisemeWeights weights)
        {
            ThrowIfDisposed();
            _behavior.SetManualVisemes(new AvatarVisemeWeights(
                Mathf.Clamp01(weights.Aa),
                Mathf.Clamp01(weights.Ih),
                Mathf.Clamp01(weights.Ou),
                Mathf.Clamp01(weights.Ee),
                Mathf.Clamp01(weights.Oh)));
        }

        public void RequestBlink()
        {
            ThrowIfDisposed();
            _behavior.RequestBlink();
        }

        public void ResetBehavior()
        {
            ThrowIfDisposed();
            _behavior.ResetBehavior();
            _behavior.SetManualVisemes(default);
            _motions.CancelAction();
            _motions.CancelAllBehaviors();
            PublishIfChanged();
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            _session.Changed -= OnSessionChanged;
            _motions.Changed -= OnMotionChanged;
            _session.Dispose();
        }

        public AvatarActionRequestResult RequestAction(AvatarPresetAction action)
        {
            ThrowIfDisposed();
            ValidateEnum(action, nameof(action));
            if (_session.State != AvatarRuntimeState.Ready)
            {
                return new AvatarActionRequestResult(
                    AvatarActionRequestOutcome.NotReady,
                    "An avatar must be ready before requesting an action.");
            }
            return _motions.RequestAction(action);
        }

        public void CancelAction()
        {
            ThrowIfDisposed();
            _motions.CancelAction();
        }

        public BehaviorRequestResult RequestBehavior(
            BehaviorIntent intent,
            PerformanceRequestPolicy policy = PerformanceRequestPolicy.Queue)
        {
            ThrowIfDisposed();
            if (_session.State != AvatarRuntimeState.Ready)
            {
                return new BehaviorRequestResult(
                    BehaviorRequestOutcome.Unavailable,
                    error: "An avatar must be ready before requesting a behavior.");
            }
            return _motions.RequestBehavior(intent, policy);
        }

        public PerformanceTransitionOutcome ApplyPerformanceCommand(
            string instanceId,
            PerformanceCommand command)
        {
            ThrowIfDisposed();
            return _motions.ApplyPerformanceCommand(instanceId, command);
        }

        private static AvatarBehaviorSettings Normalize(AvatarBehaviorSettings settings)
        {
            ValidateEnum(settings.Affect, nameof(settings.Affect));
            ValidateEnum(settings.GazeMode, nameof(settings.GazeMode));
            return new AvatarBehaviorSettings(
                settings.Affect,
                Mathf.Clamp01(settings.AffectIntensity),
                settings.BreathingEnabled,
                settings.BlinkingEnabled,
                settings.SwayEnabled,
                Mathf.Clamp(settings.BreathingIntensity, 0f, 2f),
                Mathf.Clamp(settings.SwayIntensity, 0f, 2f),
                settings.GazeMode,
                new Vector2(
                    Mathf.Clamp(settings.ManualGaze.x, -18f, 18f),
                    Mathf.Clamp(settings.ManualGaze.y, -10f, 10f)));
        }

        private static AvatarPresentationSettings Normalize(AvatarPresentationSettings settings)
        {
            ValidateEnum(settings.LightingMode, nameof(settings.LightingMode));
            return settings;
        }

        private static void ValidateEnum<T>(T value, string name) where T : struct
        {
            if (!Enum.IsDefined(typeof(T), value)) throw new ArgumentOutOfRangeException(name, value, null);
        }

        private void OnSessionChanged()
        {
            PublishIfChanged();
        }

        private void OnMotionChanged()
        {
            PublishIfChanged();
        }

        private void PublishIfChanged()
        {
            var next = CreateSnapshot(_revision);
            if (Snapshot != null && Snapshot.ContentEquals(next)) return;
            _revision += 1;
            Snapshot = CreateSnapshot(_revision);
            Changed?.Invoke(Snapshot);
        }

        private AvatarRuntimeSnapshot CreateSnapshot(long revision)
        {
            AvatarModelInfo? model = null;
            if (_session.HasAvatar)
            {
                model = new AvatarModelInfo(_session.ModelPath, _session.ModelName, _session.ModelHeight);
            }
            return new AvatarRuntimeSnapshot(
                revision,
                _session.State,
                model,
                _session.LastError,
                _behavior.Settings,
                _presentation,
                _session.Capabilities,
                _motions.Snapshot);
        }

        private void ThrowIfDisposed()
        {
            if (_disposed) throw new ObjectDisposedException(nameof(AvatarRuntimeFacade));
        }
    }
}
