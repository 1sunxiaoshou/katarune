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
        private AvatarWindow _avatarWindow;
        private AvatarSpeechPlayer _speech;
        private bool _captureStarted;
        private bool _initialActionRequested;
        private bool _quitRequested;

        public IAvatarRuntimeFacade Runtime => _facade;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void Initialize()
        {
            if (FindFirstObjectByType<AvatarBootstrap>() == null
                && FindFirstObjectByType<AvatarSceneRig>() != null)
            {
                new GameObject("Katarune Avatar Runtime").AddComponent<AvatarBootstrap>();
            }
        }

        private async void Start()
        {
            try
            {
                var args = Environment.GetCommandLineArgs();
                var validateIndex = Array.IndexOf(args, "--validate-package");
                if (validateIndex >= 0) { await ValidatePackage(args, validateIndex); return; }
                _options = AvatarCommandLine.Parse(args);
                _sceneRig = FindFirstObjectByType<AvatarSceneRig>();
                if (_sceneRig == null)
                {
                    throw new InvalidOperationException(
                        "The startup scene must contain AvatarSceneRig on the avatar camera.");
                }
                _sceneRig.Configure(_options.TransparentWindow);
                if (_options.TransparentWindow)
                {
                    _avatarWindow = FindFirstObjectByType<AvatarWindow>();
                    if (_avatarWindow == null)
                    {
                        throw new InvalidOperationException(
                            "The startup scene must contain the configured UniWindowController prefab and AvatarWindow.");
                    }
                }

                _behavior = gameObject.AddComponent<AvatarBehaviorController>();
                _motions = gameObject.AddComponent<AvatarMotionController>();
                var packageFile = Environment.GetEnvironmentVariable("KATARUNE_CHARACTER_PACKAGE");
                if (string.IsNullOrWhiteSpace(packageFile))
                    await _motions.LoadExternalPacksAsync(_options.MotionPacksDirectory ?? AvatarMotionPacks.DefaultDirectory, destroyCancellationToken);
                destroyCancellationToken.ThrowIfCancellationRequested();
                _behavior.SetMotionSource(_motions);
                _visuals = gameObject.AddComponent<AvatarVisualController>();
                _visuals.Configure(
                    softOutlineEnabled: _options.SoftOutlineEnabled);
                var presentation = new AvatarPresentationSettings(_options.SoftOutlineEnabled);
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
                _speech = new GameObject("Avatar Speech").AddComponent<AvatarSpeechPlayer>();
                _speech.transform.SetParent(transform);
                _speech.Configure(_facade);
                var speechCapture = Environment.GetEnvironmentVariable("KATARUNE_SPEECH_CAPTURE");
                if (!string.IsNullOrWhiteSpace(speechCapture))
                    _speech.gameObject.AddComponent<AvatarSpeechCapture>().Configure(speechCapture, _facade, _speech);
                var controlPipe = Environment.GetEnvironmentVariable("KATARUNE_AVATAR_PIPE");
                if (!string.IsNullOrWhiteSpace(controlPipe))
                    gameObject.AddComponent<AvatarControlConnection>().Configure(_facade, controlPipe, _speech);

                var initialModelPath = ResolveInitialModelPath(_options.ModelPath, Application.dataPath);
                if (!string.IsNullOrWhiteSpace(packageFile))
                    _ = _facade.LoadPackageAsync(JsonUtility.FromJson<AvatarCharacterPackage>(File.ReadAllText(packageFile)), destroyCancellationToken);
                else if (!string.IsNullOrWhiteSpace(initialModelPath)) _ = _facade.LoadAsync(initialModelPath);
            }
            catch (OperationCanceledException) { }
            catch (Exception error)
            {
                Debug.LogException(error);
                if (_options != null && _options.ExitOnError) Application.Quit(1);
            }
        }

        [Serializable] private sealed class PackageValidationResult { public bool ok; public string error; }
        private async System.Threading.Tasks.Task ValidatePackage(string[] args, int inputIndex)
        {
            var outputIndex = Array.IndexOf(args, "--validation-result");
            if (inputIndex + 1 >= args.Length || outputIndex < 0 || outputIndex + 1 >= args.Length) { Application.Quit(1); return; }
            var report = new PackageValidationResult();
            AvatarLoadCandidate candidate = null;
            try
            {
                var package = JsonUtility.FromJson<AvatarCharacterPackage>(File.ReadAllText(args[inputIndex + 1]));
                _motions = gameObject.AddComponent<AvatarMotionController>();
                _visuals = gameObject.AddComponent<AvatarVisualController>();
                _visuals.Configure(softOutlineEnabled: false);
                var loader = new UniVrmAvatarLoader(_visuals, _motions);
                candidate = await loader.LoadPackageAsync(package, new AvatarPresentationSettings(false), destroyCancellationToken);
                candidate.Model.Motion.Tick(1f / 30f);
                report.ok = true;
            }
            catch (Exception error) { report.error = error.Message; Debug.LogException(error); }
            finally
            {
                candidate?.Dispose();
                File.WriteAllText(args[outputIndex + 1], JsonUtility.ToJson(report));
                Application.Quit(report.ok ? 0 : 1);
            }
        }

        private void Update()
        {
            if (_facade == null || _options == null) return;
            var snapshot = _facade.Snapshot;
            if (!_initialActionRequested
                && _options.InitialAction != null
                && snapshot.RuntimeState == AvatarRuntimeState.Ready)
            {
                _initialActionRequested = true;
                var result = _facade.RequestAction(_options.InitialAction);
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

        internal static string ResolveInitialModelPath(string requestedPath, string assetsPath)
        {
            if (!string.IsNullOrWhiteSpace(requestedPath)) return requestedPath;
            if (string.IsNullOrWhiteSpace(assetsPath)) return null;

            var localDefaultPath = AvatarDefaultAssets.ModelPath(assetsPath);
            return File.Exists(localDefaultPath) ? localDefaultPath : null;
        }

        private void OnDestroy()
        {
            _speech?.Release();
            _facade?.Dispose();
            _facade = null;
            _session = null;
        }
    }
}
