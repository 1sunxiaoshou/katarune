using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace Katarune.Avatar
{
    public sealed class AvatarMotionPacks : IDisposable
    {
        public const string Extension = ".motionpack";
        public const string LibraryAssetName = "motion-library";
        private readonly List<AssetBundle> _bundles = new();
        private bool _disposed;
        public AvatarMotionLibrary Library { get; private set; }
        public List<string> Diagnostics { get; } = new();

        public static string DefaultDirectory => Path.GetFullPath(Path.Combine(Application.dataPath, "..", "MotionPacks"));

        public async Task LoadAsync(string directory, CancellationToken cancellationToken = default)
        {
            if (_disposed || Library != null) throw new InvalidOperationException("Motion packs can only be loaded once.");
            var actions = new List<AvatarActionDefinition>();
            var actionIds = new HashSet<string>(StringComparer.Ordinal);
            var packIds = new HashSet<string>(StringComparer.Ordinal);
            AnimationClip baseClip = null;
            var footIK = false;
            var paths = Directory.Exists(directory) ? Directory.GetFiles(directory, "*" + Extension) : Array.Empty<string>();
            Array.Sort(paths, StringComparer.Ordinal);
            if (paths.Length > 64) throw new InvalidDataException("At most 64 motion packs can be installed.");
            foreach (var path in paths)
            {
                AssetBundle bundle = null;
                try
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (new FileInfo(path).Length > 128 * 1024 * 1024)
                        throw new InvalidDataException("Motion pack exceeds 128 MiB.");
                    var request = AssetBundle.LoadFromFileAsync(path);
                    await Awaitable.FromAsyncOperation(request);
                    bundle = request.assetBundle;
                    cancellationToken.ThrowIfCancellationRequested();
                    if (_disposed) throw new OperationCanceledException();
                    if (bundle == null) throw new InvalidDataException("Unity could not open this AssetBundle.");
                    var assets = bundle.LoadAssetAsync<AvatarMotionLibrary>(LibraryAssetName);
                    await Awaitable.FromAsyncOperation(assets);
                    cancellationToken.ThrowIfCancellationRequested();
                    if (_disposed) throw new OperationCanceledException();
                    var library = assets.asset as AvatarMotionLibrary;
                    Validate(library);
                    if (packIds.Contains(library.PackId)) throw new InvalidDataException("Duplicate pack ID: " + library.PackId);
                    foreach (var action in library.Definitions)
                        if (actionIds.Contains(action.Id)) throw new InvalidDataException("Duplicate action ID: " + action.Id);
                    if (library.TryGetBase(out var packBase) && baseClip != null)
                        throw new InvalidDataException("A base loop has already been installed.");
                    packIds.Add(library.PackId);
                    if (packBase != null) { baseClip = packBase; footIK = library.ApplyFootIK; }
                    foreach (var action in library.Definitions) { actionIds.Add(action.Id); actions.Add(action); }
                    _bundles.Add(bundle);
                    bundle = null;
                    Debug.Log($"KATARUNE_MOTION_PACK_READY id={library.PackId} actions={library.Definitions.Count}");
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception error)
                {
                    var message = $"{Path.GetFileName(path)}: {error.Message}";
                    Diagnostics.Add(message);
                    Debug.LogWarning("KATARUNE_MOTION_PACK_REJECTED " + message);
                }
                finally { if (bundle != null) bundle.Unload(true); }
            }
            cancellationToken.ThrowIfCancellationRequested();
            if (_disposed) throw new OperationCanceledException();
            Library = ScriptableObject.CreateInstance<AvatarMotionLibrary>();
            Library.Configure(baseClip, actions.ToArray(), footIK);
            if (baseClip == null && actions.Count > 0)
            {
                Diagnostics.Add("缺少基础待机包，动作暂不可用。");
                Debug.LogWarning("KATARUNE_MOTION_PACK_NO_BASE: install a pack with a base loop.");
            }
            Debug.Log($"KATARUNE_MOTION_CATALOG actions={actions.Count} base={baseClip != null} directory={directory}");
        }

        internal static void Validate(AvatarMotionLibrary library)
        {
            if (library == null) throw new InvalidDataException("Missing motion-library asset.");
            if (library.FormatVersion != 1 || library.UnityVersion != Application.unityVersion
                || library.Platform != "StandaloneWindows64")
                throw new InvalidDataException("Pack format, Unity version or platform does not match this runtime.");
            if (!AvatarActionIds.IsValid(library.PackId)) throw new InvalidDataException("Invalid pack ID.");
            if (library.Definitions == null || library.Definitions.Count > 256)
                throw new InvalidDataException("Invalid action count (maximum 256 per pack).");
            if (library.TryGetBase(out var baseClip))
            {
                ValidateClip(baseClip);
                if (!baseClip.isLooping) throw new InvalidDataException("The base animation must loop.");
            }
            if (baseClip == null && library.Definitions.Count == 0) throw new InvalidDataException("Empty motion pack.");
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var action in library.Definitions)
            {
                if (action == null || !AvatarActionIds.IsValid(action.Id) || !ids.Add(action.Id)
                    || string.IsNullOrWhiteSpace(action.DisplayName) || action.DisplayName.Length > 80
                    || !action.HasValidTiming)
                    throw new InvalidDataException("Invalid or duplicate action metadata.");
                foreach (var c in action.DisplayName)
                    if (char.IsControl(c)) throw new InvalidDataException("Action names cannot contain control characters.");
                ValidateClip(action.Clip);
            }
        }

        private static void ValidateClip(AnimationClip clip)
        {
            if (clip == null || clip.legacy || !clip.isHumanMotion || !(clip.length > 0f)
                || float.IsInfinity(clip.length) || clip.events.Length != 0)
                throw new InvalidDataException("Clips must be non-legacy Humanoid animations with positive duration and no AnimationEvents.");
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            if (Library != null) UnityEngine.Object.Destroy(Library);
            foreach (var bundle in _bundles)
                if (bundle != null) bundle.Unload(true);
            _bundles.Clear();
        }
    }
}
