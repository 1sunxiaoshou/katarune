using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using UniGLTF;
using UniVRM10;
using UnityEngine;

namespace Katarune.Avatar
{
    internal interface IAvatarModelLoader
    {
        Task<AvatarLoadCandidate> LoadAsync(
            string path,
            AvatarPresentationSettings presentation,
            CancellationToken cancellationToken);
    }

    internal sealed class UniVrmAvatarLoader : IAvatarModelLoader
    {
        private readonly AvatarVisualController _visuals;
        private readonly AvatarMotionController _motions;

        public UniVrmAvatarLoader(AvatarVisualController visuals, AvatarMotionController motions)
        {
            _visuals = visuals ?? throw new ArgumentNullException(nameof(visuals));
            _motions = motions ?? throw new ArgumentNullException(nameof(motions));
        }

        public async Task<AvatarLoadCandidate> LoadAsync(
            string path,
            AvatarPresentationSettings presentation,
            CancellationToken cancellationToken)
        {
            var fullPath = ResolveModelPath(path);
            Vrm10Instance loaded = null;
            IAvatarDriver driver = null;
            AvatarVisualInstance visual = null;
            IAvatarMotionInstance motion = null;
            try
            {
                loaded = await Vrm10.LoadPathAsync(
                    fullPath,
                    canLoadVrm0X: true,
                    showMeshes: false,
                    awaitCaller: new RuntimeOnlyAwaitCaller(),
                    ct: cancellationToken);
                if (loaded == null) throw new InvalidOperationException("UniVRM returned no avatar instance.");

                var runtimeInstance = loaded.GetComponent<RuntimeGltfInstance>();
                if (runtimeInstance == null)
                {
                    throw new InvalidOperationException("The loaded avatar has no RuntimeGltfInstance.");
                }

                runtimeInstance.EnableUpdateWhenOffscreen();
                driver = new UniVrmAvatarDriver(loaded);
                var controlRigAnimator = loaded.Runtime?.ControlRig?.ControlRigAnimator;
                if (controlRigAnimator == null)
                {
                    throw new InvalidOperationException("The VRM control rig has no Animator.");
                }
                motion = _motions.Prepare(controlRigAnimator);
                visual = _visuals.Prepare(loaded.gameObject, presentation);
                var bounds = MeasureBounds(loaded.gameObject);
                var capabilities = ReadCapabilities(driver, motion);
                loaded.name = Path.GetFileNameWithoutExtension(fullPath);
                SetLayerRecursively(loaded.gameObject, LayerMask.NameToLayer("Ignore Raycast"));
                loaded.gameObject.SetActive(false);

                var model = new AvatarActiveModel(
                    loaded,
                    runtimeInstance,
                    driver,
                    visual,
                    motion,
                    bounds,
                    fullPath,
                    Path.GetFileName(fullPath),
                    capabilities);
                loaded = null;
                driver = null;
                visual = null;
                motion = null;
                return new AvatarLoadCandidate(model);
            }
            finally
            {
                driver?.Dispose();
                visual?.Dispose();
                motion?.Dispose();
                if (loaded != null) UnityEngine.Object.Destroy(loaded.gameObject);
            }
        }

        private static string ResolveModelPath(string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                throw new ArgumentException("A VRM model path is required.", nameof(path));
            }

            var fullPath = Path.GetFullPath(path.Trim().Trim('"'));
            if (!File.Exists(fullPath)) throw new FileNotFoundException("The VRM model was not found.", fullPath);
            if (!string.Equals(Path.GetExtension(fullPath), ".vrm", StringComparison.OrdinalIgnoreCase))
            {
                throw new ArgumentException("The selected model must use the .vrm extension.", nameof(path));
            }
            return fullPath;
        }

        private static Bounds MeasureBounds(GameObject avatar)
        {
            var renderers = avatar.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0) throw new InvalidOperationException("The avatar contains no renderers.");
            var bounds = renderers[0].bounds;
            for (var index = 1; index < renderers.Length; index += 1)
            {
                bounds.Encapsulate(renderers[index].bounds);
            }
            return bounds;
        }

        private static void SetLayerRecursively(GameObject root, int layer)
        {
            if (root == null || layer < 0) return;
            root.layer = layer;
            foreach (Transform child in root.transform) SetLayerRecursively(child.gameObject, layer);
        }

        private static AvatarCapabilitySet ReadCapabilities(
            IAvatarDriver driver,
            IAvatarMotionInstance motion)
        {
            var affects = AvatarAffectCapabilities.None;
            foreach (AvatarAffectPreset preset in Enum.GetValues(typeof(AvatarAffectPreset)))
            {
                if (driver.SupportsAffect(preset)) affects |= (AvatarAffectCapabilities)(1 << (int)preset);
            }
            return new AvatarCapabilitySet(
                affects,
                motion?.Actions ?? AvatarActionCapabilities.None);
        }
    }

    internal interface IAvatarPreparedModel : IDisposable
    {
        IAvatarDriver Driver { get; }
        IAvatarVisualInstance Visual { get; }
        IAvatarMotionInstance Motion { get; }
        Bounds Bounds { get; }
        string Path { get; }
        string Name { get; }
        AvatarCapabilitySet Capabilities { get; }
        void Show();
        void Hide();
    }

    internal sealed class AvatarLoadCandidate : IDisposable
    {
        private IAvatarPreparedModel _model;

        public AvatarLoadCandidate(IAvatarPreparedModel model)
        {
            _model = model ?? throw new ArgumentNullException(nameof(model));
        }

        public IAvatarPreparedModel Model => _model ?? throw new ObjectDisposedException(nameof(AvatarLoadCandidate));

        public IAvatarPreparedModel Take()
        {
            var model = Model;
            _model = null;
            return model;
        }

        public void Dispose()
        {
            _model?.Dispose();
            _model = null;
        }
    }

    internal sealed class AvatarActiveModel : IAvatarPreparedModel
    {
        private bool _disposed;

        public AvatarActiveModel(
            Vrm10Instance instance,
            RuntimeGltfInstance runtimeInstance,
            IAvatarDriver driver,
            AvatarVisualInstance visual,
            IAvatarMotionInstance motion,
            Bounds bounds,
            string path,
            string name,
            AvatarCapabilitySet capabilities)
        {
            Instance = instance ?? throw new ArgumentNullException(nameof(instance));
            RuntimeInstance = runtimeInstance ?? throw new ArgumentNullException(nameof(runtimeInstance));
            Driver = driver ?? throw new ArgumentNullException(nameof(driver));
            Visual = visual ?? throw new ArgumentNullException(nameof(visual));
            Motion = motion;
            Bounds = bounds;
            Path = path;
            Name = name;
            Capabilities = capabilities;
        }

        public Vrm10Instance Instance { get; }
        public RuntimeGltfInstance RuntimeInstance { get; }
        public IAvatarDriver Driver { get; }
        public IAvatarVisualInstance Visual { get; }
        public IAvatarMotionInstance Motion { get; }
        public Bounds Bounds { get; }
        public string Path { get; }
        public string Name { get; }
        public AvatarCapabilitySet Capabilities { get; }

        public void Show()
        {
            Instance.gameObject.SetActive(true);
            RuntimeInstance.ShowMeshes();
        }

        public void Hide()
        {
            if (Instance != null) Instance.gameObject.SetActive(false);
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            Driver.ResetPose();
            Driver.Dispose();
            Visual.Dispose();
            Motion?.Dispose();
            if (Instance != null) UnityEngine.Object.Destroy(Instance.gameObject);
        }
    }
}
