using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using UniGLTF;
using UniVRM10;
using UnityEngine;

namespace Katarune.Avatar
{
    public enum AvatarRuntimeState
    {
        Empty,
        Loading,
        Ready,
        Error,
    }

    public sealed class AvatarLoadRequestGate
    {
        private int _version;

        public int Begin() => ++_version;
        public bool IsCurrent(int version) => version == _version;
        public void Invalidate() => _version += 1;
    }

    public sealed class AvatarRuntimeSession : IDisposable
    {
        private readonly AvatarSceneRig _sceneRig;
        private readonly AvatarBehaviorController _behavior;
        private readonly CancellationToken _lifetimeToken;
        private readonly AvatarLoadRequestGate _requestGate = new AvatarLoadRequestGate();
        private CancellationTokenSource _loadCancellation;
        private Vrm10Instance _avatar;

        public AvatarRuntimeSession(
            AvatarSceneRig sceneRig,
            AvatarBehaviorController behavior,
            CancellationToken lifetimeToken)
        {
            _sceneRig = sceneRig ?? throw new ArgumentNullException(nameof(sceneRig));
            _behavior = behavior ?? throw new ArgumentNullException(nameof(behavior));
            _lifetimeToken = lifetimeToken;
        }

        public AvatarRuntimeState State { get; private set; } = AvatarRuntimeState.Empty;
        public string ModelPath { get; private set; }
        public string ModelName { get; private set; }
        public string LastError { get; private set; }
        public float ModelHeight { get; private set; }
        public bool HasAvatar => _avatar != null;
        public event Action Changed;

        public async Task LoadAsync(string path)
        {
            var request = _requestGate.Begin();
            CancelPendingLoad();
            _loadCancellation = CancellationTokenSource.CreateLinkedTokenSource(_lifetimeToken);
            var cancellationToken = _loadCancellation.Token;
            State = AvatarRuntimeState.Loading;
            LastError = null;
            NotifyChanged();

            Vrm10Instance loaded = null;
            UniVrmAvatarDriver loadedDriver = null;
            try
            {
                var fullPath = ResolveModelPath(path);
                loaded = await Vrm10.LoadPathAsync(
                    fullPath,
                    canLoadVrm0X: true,
                    showMeshes: false,
                    awaitCaller: new RuntimeOnlyAwaitCaller(),
                    ct: cancellationToken);
                if (loaded == null) throw new InvalidOperationException("UniVRM returned no avatar instance.");

                var runtimeInstance = loaded.GetComponent<RuntimeGltfInstance>();
                if (runtimeInstance == null) throw new InvalidOperationException("The loaded avatar has no RuntimeGltfInstance.");
                runtimeInstance.EnableUpdateWhenOffscreen();
                loadedDriver = new UniVrmAvatarDriver(loaded);
                if (!_requestGate.IsCurrent(request) || cancellationToken.IsCancellationRequested)
                {
                    loadedDriver.Dispose();
                    loadedDriver = null;
                    UnityEngine.Object.Destroy(loaded.gameObject);
                    loaded = null;
                    return;
                }

                loaded.name = Path.GetFileNameWithoutExtension(fullPath);
                runtimeInstance.ShowMeshes();
                var bounds = _sceneRig.Frame(loaded.gameObject);

                _behavior.Unbind();
                var previous = _avatar;
                _avatar = loaded;
                loaded = null;
                _behavior.Bind(loadedDriver);
                loadedDriver = null;
                if (previous != null)
                {
                    previous.gameObject.SetActive(false);
                    UnityEngine.Object.Destroy(previous.gameObject);
                }

                ModelPath = fullPath;
                ModelName = Path.GetFileName(fullPath);
                ModelHeight = bounds.size.y;
                LastError = null;
                State = AvatarRuntimeState.Ready;
                Debug.Log($"KATARUNE_AVATAR_READY path={fullPath} height={bounds.size.y:F3}");
                NotifyChanged();
            }
            catch (OperationCanceledException)
            {
                if (_requestGate.IsCurrent(request))
                {
                    State = _avatar != null ? AvatarRuntimeState.Ready : AvatarRuntimeState.Empty;
                    NotifyChanged();
                }
            }
            catch (Exception error)
            {
                if (!_requestGate.IsCurrent(request)) return;
                LastError = error.Message;
                State = _avatar != null ? AvatarRuntimeState.Ready : AvatarRuntimeState.Error;
                Debug.LogException(error);
                NotifyChanged();
            }
            finally
            {
                loadedDriver?.Dispose();
                if (loaded != null) UnityEngine.Object.Destroy(loaded.gameObject);
            }
        }

        public void Unload()
        {
            _requestGate.Invalidate();
            CancelPendingLoad();
            _behavior.Unbind();
            if (_avatar != null) UnityEngine.Object.Destroy(_avatar.gameObject);
            _avatar = null;
            ModelPath = null;
            ModelName = null;
            ModelHeight = 0f;
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

        private static string ResolveModelPath(string path)
        {
            if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("A VRM model path is required.", nameof(path));
            var fullPath = Path.GetFullPath(path.Trim().Trim('"'));
            if (!File.Exists(fullPath)) throw new FileNotFoundException("The VRM model was not found.", fullPath);
            if (!string.Equals(Path.GetExtension(fullPath), ".vrm", StringComparison.OrdinalIgnoreCase))
            {
                throw new ArgumentException("The selected model must use the .vrm extension.", nameof(path));
            }
            return fullPath;
        }

        private void CancelPendingLoad()
        {
            if (_loadCancellation == null) return;
            _loadCancellation.Cancel();
            _loadCancellation.Dispose();
            _loadCancellation = null;
        }

        private void NotifyChanged()
        {
            Changed?.Invoke();
        }
    }
}
