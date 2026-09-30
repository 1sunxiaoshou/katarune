using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Katarune.Avatar.Editor
{
    public static class AvatarMotionPackBuilder
    {
        public const string LocalLibraryPath = "Assets/KataruneLocal/Motions/AvatarMotionLibrary.asset";
        private const string SourceDirectory = "Assets/KataruneLocal/MotionPacks";

        [MenuItem("Katarune/Motion Packs/Build Selected Clips or Library")]
        public static void BuildSelected()
        {
            if (Selection.activeObject is AvatarMotionLibrary library)
            {
                Build(library, library.PackId);
                return;
            }
            var clips = Selection.objects.OfType<AnimationClip>().ToArray();
            if (clips.Length == 0) throw new InvalidOperationException("Select .anim clips or a motion library asset first.");
            foreach (var clip in clips)
            {
                var path = AssetDatabase.GetAssetPath(clip);
                var id = "clip-" + AssetDatabase.AssetPathToGUID(path);
                BuildClip(clip, id, Path.GetFileNameWithoutExtension(path));
            }
        }

        public static void BuildFromCommandLine()
        {
            var args = Environment.GetCommandLineArgs();
            string Read(string flag)
            {
                var index = Array.IndexOf(args, flag);
                return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
            }
            var path = Read("--motion-source");
            var id = Read("--motion-id");
            var clip = AssetDatabase.LoadAssetAtPath<AnimationClip>(path ?? string.Empty);
            BuildClip(clip, id, Read("--motion-name") ?? Path.GetFileNameWithoutExtension(path));
        }

        private static void BuildClip(AnimationClip clip, string id, string displayName)
        {
            if (clip == null || !AvatarActionIds.IsValid(id))
                throw new ArgumentException("Provide an imported .anim and a valid stable motion ID.");
            Directory.CreateDirectory(SourceDirectory);
            AssetDatabase.Refresh();
            var path = $"{SourceDirectory}/{id}.asset";
            var library = AssetDatabase.LoadAssetAtPath<AvatarMotionLibrary>(path);
            if (library == null)
            {
                library = ScriptableObject.CreateInstance<AvatarMotionLibrary>();
                AssetDatabase.CreateAsset(library, path);
            }
            library.Configure(null, new[] { new AvatarActionDefinition(id, displayName, clip) }, false);
            Build(library, id);
        }

        [MenuItem("Katarune/Motion Packs/Build Local Defaults")]
        public static void BuildLocalDefaults()
        {
            const string oldPath = "Assets/KataruneLocal/Resources/AvatarMotionLibrary.asset";
            if (AssetDatabase.LoadAssetAtPath<AvatarMotionLibrary>(LocalLibraryPath) == null
                && AssetDatabase.LoadAssetAtPath<AvatarMotionLibrary>(oldPath) != null)
            {
                var error = AssetDatabase.MoveAsset(oldPath, LocalLibraryPath);
                if (!string.IsNullOrEmpty(error)) throw new IOException(error);
            }
            var library = AssetDatabase.LoadAssetAtPath<AvatarMotionLibrary>(LocalLibraryPath);
            if (library == null) throw new FileNotFoundException("Import the local motion library first.", LocalLibraryPath);
            Build(library, "00-local-defaults");
        }

        public static void Build(AvatarMotionLibrary library, string id)
        {
            if (library == null || !AvatarActionIds.IsValid(id)) throw new ArgumentException("The pack needs a valid ID.");
            if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.StandaloneWindows64)
                throw new InvalidOperationException("Switch the Editor build target to Windows x64 first.");
            var sourcePath = AssetDatabase.GetAssetPath(library);
            if (string.IsNullOrEmpty(sourcePath) || sourcePath.Contains("/Resources/"))
                throw new InvalidOperationException("Save the library outside Resources before packing it.");
            library.StampPack(id);
            AvatarMotionPacks.Validate(library);
            var clips = library.Definitions.Select(action => action.Clip).ToList();
            if (library.TryGetBase(out var baseClip)) clips.Add(baseClip);
            foreach (var clip in clips)
                if (!AssetDatabase.GetAssetPath(clip).EndsWith(".anim", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("Extract clips to standalone .anim files before packing.");
            EditorUtility.SetDirty(library);
            AssetDatabase.SaveAssets();
            foreach (var clip in clips) AvatarHumanoidClipValidator.ValidateBindings(clip);
            var stage = Path.GetFullPath("Temp/MotionPackBuild/" + id);
            Directory.CreateDirectory(stage);
            var filename = id + AvatarMotionPacks.Extension;
            var manifest = BuildPipeline.BuildAssetBundles(stage, new[]
            {
                new AssetBundleBuild
                {
                    assetBundleName = filename,
                    assetNames = new[] { sourcePath },
                    addressableNames = new[] { AvatarMotionPacks.LibraryAssetName },
                },
            }, BuildAssetBundleOptions.ChunkBasedCompression | BuildAssetBundleOptions.StrictMode,
                BuildTarget.StandaloneWindows64);
            if (manifest == null || manifest.GetAllDependencies(filename).Length != 0)
                throw new InvalidOperationException("Motion pack build failed or has external dependencies.");
            Directory.CreateDirectory(AvatarMotionPacks.DefaultDirectory);
            var output = Path.Combine(AvatarMotionPacks.DefaultDirectory, filename);
            File.Copy(Path.Combine(stage, filename), output, true);
            Debug.Log($"KATARUNE_MOTION_PACK_BUILT path={output} actions={library.Definitions.Count}");
        }

    }
}
