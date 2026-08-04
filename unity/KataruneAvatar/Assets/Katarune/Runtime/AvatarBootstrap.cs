using System;
using System.Collections;
using System.IO;
using UnityEngine;

namespace Katarune.Avatar
{
    public sealed class AvatarBootstrap : MonoBehaviour
    {
        private AvatarCommandLine _options;
        private AvatarSceneRig _sceneRig;
        private AvatarBehaviorController _behavior;
        private AvatarRuntimeSession _session;
        private AvatarDebugPanel _debugPanel;
        private AvatarWindow _avatarWindow;
        private bool _captureStarted;
        private bool _quitRequested;

        public AvatarRuntimeSession Session => _session;
        public AvatarBehaviorController Behavior => _behavior;
        public AvatarDebugPanel DebugPanel => _debugPanel;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void Initialize()
        {
            if (FindFirstObjectByType<AvatarBootstrap>() == null)
            {
                new GameObject("Katarune Avatar Runtime").AddComponent<AvatarBootstrap>();
            }
        }

        private void Start()
        {
            try
            {
                _options = AvatarCommandLine.Parse(Environment.GetCommandLineArgs());
                _sceneRig = gameObject.AddComponent<AvatarSceneRig>();
                _sceneRig.Configure(_options.TransparentWindow);
                if (_options.TransparentWindow) _avatarWindow = gameObject.AddComponent<AvatarWindow>();

                _behavior = gameObject.AddComponent<AvatarBehaviorController>();
                _session = new AvatarRuntimeSession(_sceneRig, _behavior, destroyCancellationToken);
                _debugPanel = gameObject.AddComponent<AvatarDebugPanel>();
                _debugPanel.Configure(
                    _session,
                    _behavior,
                    _options.ModelPath,
                    (Application.isEditor || _options.DebugUi) && string.IsNullOrWhiteSpace(_options.ScreenshotPath),
                    !string.IsNullOrWhiteSpace(_options.ScreenshotPath),
                    _avatarWindow == null);
                if (_avatarWindow != null)
                {
                    _avatarWindow.DebugUiToggleRequested += _debugPanel.ToggleVisible;
                    _debugPanel.VisibilityChanged += _avatarWindow.SetDebugUiVisible;
                    _avatarWindow.SetDebugUiVisible(_debugPanel.Visible);
                }

                if (!string.IsNullOrWhiteSpace(_options.ModelPath)) _ = _session.LoadAsync(_options.ModelPath);
            }
            catch (Exception error)
            {
                Debug.LogException(error);
                if (_options != null && _options.ExitOnError) Application.Quit(1);
            }
        }

        private void Update()
        {
            if (_session == null || _options == null) return;
            if (!_captureStarted
                && !string.IsNullOrWhiteSpace(_options.ScreenshotPath)
                && _session.State == AvatarRuntimeState.Ready)
            {
                _captureStarted = true;
                StartCoroutine(CaptureAndFinish());
            }

            if (!_quitRequested && _options.ExitOnError && _session.State == AvatarRuntimeState.Error)
            {
                _quitRequested = true;
                Application.Quit(1);
            }
        }

        private IEnumerator CaptureAndFinish()
        {
            yield return null;
            yield return new WaitForEndOfFrame();
            _sceneRig.Capture(_options.ScreenshotPath);
            const int maximumWaitFrames = 300;
            for (var frame = 0; frame < maximumWaitFrames; frame += 1)
            {
                if (File.Exists(_options.ScreenshotPath) && new FileInfo(_options.ScreenshotPath).Length > 0)
                {
                    Debug.Log($"KATARUNE_AVATAR_SCREENSHOT path={_options.ScreenshotPath}");
                    if (_options.ExitAfterCapture) Application.Quit(0);
                    yield break;
                }
                yield return null;
            }

            Debug.LogError($"Timed out waiting for screenshot: {_options.ScreenshotPath}");
            if (_options.ExitAfterCapture) Application.Quit(2);
        }

        private void OnDestroy()
        {
            if (_avatarWindow != null && _debugPanel != null)
            {
                _avatarWindow.DebugUiToggleRequested -= _debugPanel.ToggleVisible;
                _debugPanel.VisibilityChanged -= _avatarWindow.SetDebugUiVisible;
            }
            _session?.Dispose();
            _session = null;
        }
    }
}
