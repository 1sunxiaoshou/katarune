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
        private AvatarVisualController _visuals;
        private AvatarMotionController _motions;
        private AvatarRuntimeSession _session;
        private AvatarRuntimeFacade _facade;
        private AvatarHudController _hud;
        private AvatarWindow _avatarWindow;
        private bool _captureStarted;
        private bool _initialActionRequested;
        private bool _quitRequested;

        public IAvatarRuntimeFacade Runtime => _facade;
        public AvatarHudController Hud => _hud;

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
                _sceneRig.Configure(_options.TransparentWindow, _options.LightingMode);
                if (_options.TransparentWindow)
                {
                    _avatarWindow = gameObject.AddComponent<AvatarWindow>();
                }

                _behavior = gameObject.AddComponent<AvatarBehaviorController>();
                _motions = gameObject.AddComponent<AvatarMotionController>();
                _motions.Configure();
                _behavior.SetMotionSource(_motions);
                _visuals = gameObject.AddComponent<AvatarVisualController>();
                _visuals.Configure(
                    softOutlineEnabled: _options.SoftOutlineEnabled);
                var presentation = new AvatarPresentationSettings(
                    _options.LightingMode,
                    _options.SoftOutlineEnabled);
                var loader = new UniVrmAvatarLoader(_visuals, _motions);
                _session = new AvatarRuntimeSession(
                    loader,
                    _sceneRig,
                    _behavior,
                    _visuals,
                    _motions,
                    destroyCancellationToken);
                _facade = new AvatarRuntimeFacade(
                    _session,
                    _behavior,
                    _visuals,
                    _sceneRig,
                    _motions,
                    presentation);
                var hudPrefab = Resources.Load<GameObject>("AvatarHud");
                if (hudPrefab == null)
                {
                    throw new InvalidOperationException("AvatarHud prefab is missing from Resources.");
                }
                var hudObject = Instantiate(hudPrefab, transform);
                hudObject.name = "Avatar HUD";
                _hud = hudObject.GetComponent<AvatarHudController>();
                if (_hud == null)
                {
                    throw new InvalidOperationException("AvatarHud prefab has no AvatarHudController.");
                }
                var pointerSource = AvatarPointerPositionSource.CreateDefault();
                _hud.Configure(
                    _facade,
                    new AvatarVrmFilePicker(),
                    string.IsNullOrWhiteSpace(_options.ScreenshotPath),
                    pointerSource);
                _hud.SetLocalShortcutEnabled(Application.isEditor || _avatarWindow == null);
                if (_avatarWindow != null)
                {
                    _avatarWindow.BindHud(_hud.RootElement, pointerSource);
                    _avatarWindow.HudToggleRequested += _hud.ToggleVisible;
                    _hud.VisibilityChanged += _avatarWindow.SetHudVisible;
                    _hud.PointerInteractionChanged += _avatarWindow.SetHudPointerInteractionActive;
                    _avatarWindow.SetHudVisible(_hud.Visible);
                }

                if (!string.IsNullOrWhiteSpace(_options.ModelPath)) _ = _facade.LoadAsync(_options.ModelPath);
            }
            catch (Exception error)
            {
                Debug.LogException(error);
                if (_options != null && _options.ExitOnError) Application.Quit(1);
            }
        }

        private void Update()
        {
            if (_facade == null || _options == null) return;
            var snapshot = _facade.Snapshot;
            if (!_initialActionRequested
                && _options.InitialAction.HasValue
                && snapshot.RuntimeState == AvatarRuntimeState.Ready)
            {
                _initialActionRequested = true;
                var result = _facade.RequestAction(_options.InitialAction.Value);
                if (result.Outcome != AvatarActionRequestOutcome.Started)
                {
                    Debug.LogError($"Initial action failed: {result.Error}");
                    if (_options.ExitOnError) Application.Quit(1);
                    return;
                }
            }
            if (!_captureStarted
                && !string.IsNullOrWhiteSpace(_options.ScreenshotPath)
                && snapshot.RuntimeState == AvatarRuntimeState.Ready)
            {
                _captureStarted = true;
                StartCoroutine(CaptureAndFinish());
            }

            if (!_quitRequested && _options.ExitOnError && snapshot.RuntimeState == AvatarRuntimeState.Error)
            {
                _quitRequested = true;
                Application.Quit(1);
            }
        }

        private IEnumerator CaptureAndFinish()
        {
            if (_options.CaptureDelaySeconds > 0f)
            {
                yield return new WaitForSecondsRealtime(_options.CaptureDelaySeconds);
            }
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
            if (_avatarWindow != null && _hud != null)
            {
                _avatarWindow.HudToggleRequested -= _hud.ToggleVisible;
                _hud.VisibilityChanged -= _avatarWindow.SetHudVisible;
                _hud.PointerInteractionChanged -= _avatarWindow.SetHudPointerInteractionActive;
            }
            _facade?.Dispose();
            _facade = null;
            _session = null;
        }
    }
}
