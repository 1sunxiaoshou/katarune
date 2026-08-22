using System;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace Katarune.Avatar
{
    public sealed class AvatarLoadRequestGate
    {
        private int _version;

        public int Begin() => ++_version;
        public bool IsCurrent(int version) => version == _version;
        public void Invalidate() => _version += 1;
    }

    internal sealed class AvatarRuntimeSession : IDisposable
    {
        private readonly IAvatarModelLoader _loader;
        private readonly AvatarSceneRig _sceneRig;
        private readonly AvatarBehaviorController _behavior;
        private readonly AvatarVisualController _visuals;
        private readonly AvatarMotionController _motions;
        private readonly CancellationToken _lifetimeToken;
        private readonly AvatarLoadRequestGate _requestGate = new AvatarLoadRequestGate();
        private CancellationTokenSource _loadCancellation;
        private IAvatarPreparedModel _active;

        public AvatarRuntimeSession(
            IAvatarModelLoader loader,
            AvatarSceneRig sceneRig,
            AvatarBehaviorController behavior,
            AvatarVisualController visuals,
            AvatarMotionController motions,
            CancellationToken lifetimeToken)
        {
            _loader = loader ?? throw new ArgumentNullException(nameof(loader));
            _sceneRig = sceneRig ?? throw new ArgumentNullException(nameof(sceneRig));
            _behavior = behavior ?? throw new ArgumentNullException(nameof(behavior));
            _visuals = visuals ?? throw new ArgumentNullException(nameof(visuals));
            _motions = motions ?? throw new ArgumentNullException(nameof(motions));
            _lifetimeToken = lifetimeToken;
        }

        public AvatarRuntimeState State { get; private set; } = AvatarRuntimeState.Empty;
        public string ModelPath => _active?.Path;
        public string ModelName => _active?.Name;
        public string LastError { get; private set; }
        public float ModelHeight => _active?.Bounds.size.y ?? 0f;
        public AvatarCapabilitySet Capabilities => _active?.Capabilities ?? AvatarCapabilitySet.Empty;
        public bool HasAvatar => _active != null;
        public event Action Changed;

        public async Task<AvatarLoadResult> LoadAsync(
            string path,
            Func<AvatarPresentationSettings> presentationProvider,
            CancellationToken cancellationToken = default)
        {
            if (presentationProvider == null) throw new ArgumentNullException(nameof(presentationProvider));
            var request = _requestGate.Begin();
            CancelPendingLoad();
            var loadCancellation = CancellationTokenSource.CreateLinkedTokenSource(
                _lifetimeToken,
                cancellationToken);
            _loadCancellation = loadCancellation;
            var token = loadCancellation.Token;
            State = AvatarRuntimeState.Loading;
            LastError = null;
            NotifyChanged();

            AvatarLoadCandidate candidate = null;
            try
            {
                candidate = await _loader.LoadAsync(path, presentationProvider(), token);
                if (!_requestGate.IsCurrent(request))
                {
                    return new AvatarLoadResult(AvatarLoadOutcome.Superseded);
                }
                if (token.IsCancellationRequested)
                {
                    RestoreStableState();
                    return new AvatarLoadResult(AvatarLoadOutcome.Cancelled);
                }

                candidate.Model.Visual.ApplySoftOutline(
                    presentationProvider().SoftOutlineEnabled);
                Commit(candidate);
                var active = _active;
                candidate = null;
                LastError = null;
                State = AvatarRuntimeState.Ready;
                Debug.Log($"KATARUNE_AVATAR_READY path={active.Path} height={active.Bounds.size.y:F3}");
                NotifyChanged();
                return new AvatarLoadResult(AvatarLoadOutcome.Loaded);
            }
            catch (OperationCanceledException)
            {
                if (!_requestGate.IsCurrent(request))
                {
                    return new AvatarLoadResult(AvatarLoadOutcome.Superseded);
                }
                RestoreStableState();
                return new AvatarLoadResult(AvatarLoadOutcome.Cancelled);
            }
            catch (Exception error)
            {
                if (!_requestGate.IsCurrent(request))
                {
                    return new AvatarLoadResult(AvatarLoadOutcome.Superseded);
                }

                LastError = error.Message;
                State = _active != null ? AvatarRuntimeState.Ready : AvatarRuntimeState.Error;
                Debug.LogException(error);
                NotifyChanged();
                return new AvatarLoadResult(AvatarLoadOutcome.Failed, error.Message);
            }
            finally
            {
                candidate?.Dispose();
                if (ReferenceEquals(_loadCancellation, loadCancellation)) _loadCancellation = null;
                loadCancellation.Dispose();
            }
        }

        public void Unload()
        {
            _requestGate.Invalidate();
            CancelPendingLoad();
            var previousDriver = _behavior.ReplaceDriver(null);
            var previousVisual = _visuals.ReplaceActive(null);
            var previousMotion = _motions.ReplaceActive(null, notify: false);
            var previous = _active;
            _active = null;
            _sceneRig.ClearFraming();
            DisposeDetached(previous, previousDriver, previousVisual, previousMotion);
            LastError = null;
            State = AvatarRuntimeState.Empty;
            NotifyChanged();
        }

        public void Dispose()
        {
            Unload();
            _loadCancellation?.Dispose();
            _loadCancellation = null;
        }

        private void Commit(AvatarLoadCandidate candidate)
        {
            var next = candidate.Model;
            var previous = _active;
            var previousFraming = _sceneRig.CaptureFraming();
            var previousDriver = _behavior.ReplaceDriver(next.Driver);
            var previousVisual = _visuals.ReplaceActive(next.Visual);
            var previousMotion = _motions.ReplaceActive(next.Motion, notify: false);
            var committed = false;
            var previousHidden = false;
            try
            {
                next.Show();
                _sceneRig.ActivateFraming(next.Bounds);
                if (previous != null)
                {
                    previous.Hide();
                    previousHidden = true;
                }
                _active = candidate.Take();
                committed = true;
            }
            finally
            {
                if (!committed)
                {
                    next.Hide();
                    _behavior.ReplaceDriver(previousDriver);
                    _visuals.ReplaceActive(previousVisual);
                    _motions.ReplaceActive(previousMotion, notify: false);
                    _sceneRig.RestoreFraming(previousFraming);
                    if (previousHidden) previous.Show();
                }
            }

            DisposeDetached(previous, previousDriver, previousVisual, previousMotion);
        }

        private void RestoreStableState()
        {
            State = _active != null ? AvatarRuntimeState.Ready : AvatarRuntimeState.Empty;
            NotifyChanged();
        }

        private static void DisposeDetached(
            IAvatarPreparedModel active,
            IAvatarDriver detachedDriver,
            IAvatarVisualInstance detachedVisual,
            IAvatarMotionInstance detachedMotion)
        {
            if (active != null)
            {
                active.Dispose();
                return;
            }

            if (detachedDriver != null)
            {
                detachedDriver.ResetPose();
                detachedDriver.Dispose();
            }
            detachedVisual?.Dispose();
            detachedMotion?.Dispose();
        }

        private void CancelPendingLoad()
        {
            if (_loadCancellation == null) return;
            _loadCancellation.Cancel();
            _loadCancellation = null;
        }

        private void NotifyChanged()
        {
            Changed?.Invoke();
        }
    }
}
