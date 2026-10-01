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

    internal sealed class UniVrmAvatarLoader : IAvatarModelLoader, IAvatarPackageModelLoader
    {
        private readonly AvatarVisualController _visuals;
        private readonly AvatarMotionController _motions;

        public UniVrmAvatarLoader(AvatarVisualController visuals, AvatarMotionController motions)
        {
            _visuals = visuals ?? throw new ArgumentNullException(nameof(visuals));
            _motions = motions ?? throw new ArgumentNullException(nameof(motions));
        }

        public Task<AvatarLoadCandidate> LoadPackageAsync(AvatarCharacterPackage package, AvatarPresentationSettings presentation, CancellationToken token)
            => PrepareAsync(package.model, presentation, token, package);
        public Task<AvatarLoadCandidate> LoadAsync(string path, AvatarPresentationSettings presentation, CancellationToken token)
            => PrepareAsync(path, presentation, token, null);

        private async Task<AvatarLoadCandidate> PrepareAsync(
            string path,
            AvatarPresentationSettings presentation,
            CancellationToken cancellationToken, AvatarCharacterPackage package)
        {
            var fullPath = package != null ? Path.GetFullPath(path) : ResolveModelPath(path);
            Vrm10Instance loaded = null;
            IAvatarDriver driver = null;
            AvatarVisualInstance visual = null;
            IAvatarMotionInstance motion = null;
            try
            {
                var bytes = await Task.Run(() => File.ReadAllBytes(fullPath), cancellationToken);
                using (var data = new GlbLowLevelParser(fullPath, bytes).Parse())
                {
                    VrmaSource.ValidateSelfContained(data);
                    if (Vrm10Data.Parse(data) == null)
                        throw new InvalidOperationException("当前仅支持 VRM 1.0。请先将 VRM 0.x 模型离线转换为 VRM 1.0，再重新连接桌宠。");
                }
                loaded = await Vrm10.LoadBytesAsync(
                    bytes,
                    canLoadVrm0X: false,
                    showMeshes: false,
                    awaitCaller: new RuntimeOnlyAwaitCaller(),
                    // The Player can load before URP creates its first pipeline instance.
                    // Auto-detection would select Built-in shaders at that point.
                    materialGenerator: new UrpVrm10MaterialDescriptorGenerator(),
                    ct: cancellationToken);
                if (loaded == null) throw new InvalidOperationException("UniVRM returned no avatar instance.");

                var runtimeInstance = loaded.GetComponent<RuntimeGltfInstance>();
                if (runtimeInstance == null)
                {
                    throw new InvalidOperationException("The loaded avatar has no RuntimeGltfInstance.");
                }

                runtimeInstance.EnableUpdateWhenOffscreen();
                driver = new UniVrmAvatarDriver(loaded);
                var rigBinding = CreateRigBinding(loaded);
                motion = package == null ? _motions.Prepare(rigBinding) : await VrmaMotionInstance.PrepareAsync(loaded, package, cancellationToken);
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
                    Path.GetFileNameWithoutExtension(fullPath),
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

        private static ICharacterRigBinding CreateRigBinding(Vrm10Instance loaded)
        {
            var animator = loaded.Runtime?.ControlRig?.ControlRigAnimator;
            if (animator == null)
            {
                throw new InvalidOperationException("The VRM control rig has no Animator.");
            }

            return new HumanoidCharacterRigBinding(
                animator,
                CharacterRigCapabilities.HumanoidBody);
        }
    }

    internal interface IAvatarPreparedModel : IDisposable
    {
        Transform RootTransform { get; }
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
        public Transform RootTransform => Instance.transform;
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
            Driver.Dispose();
            Visual.Dispose();
            Motion?.Dispose();
            if (Instance != null) UnityEngine.Object.Destroy(Instance.gameObject);
        }
    }
}
