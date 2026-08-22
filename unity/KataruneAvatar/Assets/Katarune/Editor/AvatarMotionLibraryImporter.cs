using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Katarune.Avatar.Editor
{
    public sealed class AvatarMotionLibraryImporter : EditorWindow
    {
        internal const string LocalRoot = "Assets/KataruneLocal/Motions";
        internal const string LibraryAssetPath = "Assets/KataruneLocal/Resources/AvatarMotionLibrary.asset";
        private const string Ual1FileName = "UAL1_Standard.fbx";
        private const string Ual2FileName = "UAL2_Standard.fbx";
        private const string MotifectReadmeName = "README.txt";

        private static readonly MotifectMotion[] MotifectMotions =
        {
            new MotifectMotion("nod_yes.fbx", "Motifect_Listening", loop: true),
            new MotifectMotion("check_phone_standing.fbx", "Motifect_Thinking", loop: true),
            new MotifectMotion("present_to_audience.fbx", "Motifect_Speaking", loop: true),
            new MotifectMotion("wave_hello.fbx", "Motifect_GreetWave", loop: false),
            new MotifectMotion("stretch_morning.fbx", "Motifect_Celebrate", loop: false),
        };

        private string _ual1Source = string.Empty;
        private string _ual2Source = string.Empty;
        private string _motifectSource = string.Empty;

        [MenuItem("Katarune/Avatar/Import Local Preset Motions...")]
        private static void Open()
        {
            var window = GetWindow<AvatarMotionLibraryImporter>(utility: true, title: "Preset Motions");
            window.minSize = new Vector2(620f, 330f);
            window.Show();
        }

        // Intended for local smoke tests. The downloaded archives remain outside the repository.
        public static void ImportDownloadedSamples()
        {
            var temporary = Path.GetTempPath();
            Import(
                Path.Combine(temporary, "Universal Animation Library Standard.zip"),
                Path.Combine(temporary, "Universal Animation Library 2 Standard.zip"));
        }

        // Intended for local smoke tests. The downloaded archive remains outside the repository.
        public static void ImportDownloadedMotifectSample()
        {
            var source = Environment.GetEnvironmentVariable("KATARUNE_MOTIFECT_SOURCE");
            if (string.IsNullOrWhiteSpace(source))
            {
                source = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    "Downloads",
                    "Motifect_daily_life_complete_v1_0.zip");
            }
            ImportMotifect(source);
        }

        private void OnGUI()
        {
            EditorGUILayout.LabelField("Katarune quiet idle + Quaternius technical samples", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox(
                "Select the Standard ZIP archives or extracted pack folders. Imported files are stored under Assets/KataruneLocal and are ignored by Git.",
                MessageType.Info);
            DrawSource("Universal Animation Library 1", ref _ual1Source);
            DrawSource("Universal Animation Library 2", ref _ual2Source);
            using (new EditorGUI.DisabledScope(
                string.IsNullOrWhiteSpace(_ual1Source) || string.IsNullOrWhiteSpace(_ual2Source)))
            {
                if (GUILayout.Button("Import Quaternius baseline", GUILayout.Height(30f)))
                {
                    RunImport(() => Import(_ual1Source, _ual2Source));
                }
            }

            EditorGUILayout.Space(14f);
            EditorGUILayout.LabelField("Motifect Daily Life alternate sample", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox(
                "Imports alternate listening, thinking, speaking, greeting and celebrate clips. The stable baseline Idle and Cough clips remain in use.",
                MessageType.Info);
            DrawSource("Motifect Daily Life", ref _motifectSource);
            GUILayout.FlexibleSpace();
            using (new EditorGUI.DisabledScope(string.IsNullOrWhiteSpace(_motifectSource)))
            {
                if (GUILayout.Button("Import Motifect alternate set", GUILayout.Height(34f)))
                {
                    RunImport(() => ImportMotifect(_motifectSource));
                }
            }
        }

        private static void RunImport(Action import)
        {
            try
            {
                import();
                EditorUtility.DisplayDialog("Katarune", "Local preset motion library imported.", "OK");
            }
            catch (Exception error)
            {
                Debug.LogException(error);
                EditorUtility.DisplayDialog("Katarune", error.Message, "OK");
            }
        }

        private static void DrawSource(string label, ref string source)
        {
            EditorGUILayout.BeginHorizontal();
            source = EditorGUILayout.TextField(label, source);
            if (GUILayout.Button("ZIP", GUILayout.Width(48f)))
            {
                source = EditorUtility.OpenFilePanel(label, string.Empty, "zip");
            }
            if (GUILayout.Button("Folder", GUILayout.Width(60f)))
            {
                source = EditorUtility.OpenFolderPanel(label, string.Empty, string.Empty);
            }
            EditorGUILayout.EndHorizontal();
        }

        internal static void Import(string ual1Source, string ual2Source)
        {
            var stagingRoot = Path.Combine(
                Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Library")),
                "KataruneMotionImport",
                Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(stagingRoot);
            try
            {
                var ual1 = ResolvePack(ual1Source, Ual1FileName, Path.Combine(stagingRoot, "UAL1"));
                var ual2 = ResolvePack(ual2Source, Ual2FileName, Path.Combine(stagingRoot, "UAL2"));
                CopySource(ual1, Ual1FileName, "UAL1-License.txt");
                CopySource(ual2, Ual2FileName, "UAL2-License.txt");
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);

                var ual1Asset = $"{LocalRoot}/Source/{Ual1FileName}";
                var ual2Asset = $"{LocalRoot}/Source/{Ual2FileName}";
                ConfigureModelImporter(ual1Asset, "Idle", "Idle_Talking");
                ConfigureModelImporter(ual2Asset, "Idle_FoldArms", "Idle_Pose_Arms");

                var ual1Clips = LoadClips(ual1Asset);
                var ual2Clips = LoadClips(ual2Asset);
                var quietIdle = KataruneQuietIdleGenerator.CreateOrUpdateClip();
                var neutralIdle = RequireClip(ual1Clips, "Idle");
                var talking = RequireClip(ual1Clips, "Idle_Talking");
                var foldedArmsIdle = RequireClip(ual2Clips, "Idle_FoldArms", "Idle_Pose_Arms");
                var wave = FindClip(ual2Clips, "Wave");
                if (wave == null)
                {
                    wave = RequireClip(ual1Clips, "Interact");
                    Debug.LogWarning("UAL2 Standard has no Wave clip; GreetWave uses the technical Interact fallback.");
                }
                var dance = RequireClip(ual1Clips, "Dance");
                var coughing = FindClip(ual2Clips, "Coughing");
                if (coughing == null)
                {
                    coughing = RequireClip(ual2Clips, "Consume");
                    Debug.LogWarning("UAL2 Standard has no Coughing clip; Cough uses the technical Consume fallback.");
                }

                var library = AssetDatabase.LoadAssetAtPath<AvatarMotionLibrary>(LibraryAssetPath);
                if (library == null)
                {
                    EnsureAssetFolder("Assets/KataruneLocal/Resources");
                    library = CreateInstance<AvatarMotionLibrary>();
                    AssetDatabase.CreateAsset(library, LibraryAssetPath);
                }
                library.Configure(
                    quietIdle,
                    neutralIdle,
                    foldedArmsIdle,
                    talking,
                    new[]
                    {
                        new AvatarActionDefinition(AvatarPresetAction.GreetWave, wave),
                        new AvatarActionDefinition(AvatarPresetAction.Explain, talking, 2.4f),
                        new AvatarActionDefinition(AvatarPresetAction.Celebrate, dance, 3f),
                        new AvatarActionDefinition(AvatarPresetAction.Cough, coughing),
                    });
                if (!library.IsValid) throw new InvalidOperationException("The generated motion library is incomplete.");
                EditorUtility.SetDirty(library);
                AssetDatabase.SaveAssets();
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                Debug.Log($"KATARUNE_MOTION_LIBRARY_READY path={LibraryAssetPath}");
            }
            finally
            {
                if (Directory.Exists(stagingRoot)) Directory.Delete(stagingRoot, recursive: true);
            }
        }

        internal static void ImportMotifect(string source)
        {
            var library = AssetDatabase.LoadAssetAtPath<AvatarMotionLibrary>(LibraryAssetPath);
            if (library == null || !library.IsValid)
            {
                throw new InvalidOperationException(
                    "Import the Quaternius baseline first. Motifect has no neutral Idle or Cough clip, so the alternate set intentionally preserves those two baseline motions.");
            }
            var ual2Clips = LoadClips($"{LocalRoot}/Source/{Ual2FileName}");
            var idle = KataruneQuietIdleGenerator.CreateOrUpdateClip();
            if (!library.TryGetAction(AvatarPresetAction.Cough, out var oldCough) || oldCough?.Clip == null)
            {
                throw new InvalidOperationException("The existing motion library has no valid Cough clip.");
            }

            var stagingRoot = Path.Combine(
                Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Library")),
                "KataruneMotifectImport",
                Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(stagingRoot);
            try
            {
                var pack = ResolveMotifectPack(source, stagingRoot);
                CopyMotifectSources(pack);
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);

                var motifectClips = new Dictionary<string, AnimationClip>(StringComparer.OrdinalIgnoreCase);
                foreach (var pair in pack.AnimationFiles.OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase))
                {
                    var selected = MotifectMotions.FirstOrDefault(motion => string.Equals(
                        motion.FileName,
                        pair.Key,
                        StringComparison.OrdinalIgnoreCase));
                    var isSelected = !string.IsNullOrEmpty(selected.FileName);
                    var clipName = isSelected
                        ? selected.ClipName
                        : $"MotifectPreview_{Path.GetFileNameWithoutExtension(pair.Key)}";
                    var assetPath = $"{LocalRoot}/Motifect/{pair.Key}";
                    ConfigureSingleClipModelImporter(assetPath, clipName, isSelected && selected.Loop);
                    motifectClips.Add(pair.Key, LoadSingleClip(assetPath, clipName));
                }

                library.Configure(
                    idle,
                    motifectClips["nod_yes.fbx"],
                    motifectClips["check_phone_standing.fbx"],
                    motifectClips["present_to_audience.fbx"],
                    new[]
                    {
                        new AvatarActionDefinition(
                            AvatarPresetAction.GreetWave,
                            motifectClips["wave_hello.fbx"]),
                        new AvatarActionDefinition(
                            AvatarPresetAction.Explain,
                            motifectClips["present_to_audience.fbx"],
                            4f),
                        new AvatarActionDefinition(
                            AvatarPresetAction.Celebrate,
                            motifectClips["stretch_morning.fbx"],
                            3f),
                        new AvatarActionDefinition(
                            AvatarPresetAction.Cough,
                            oldCough.Clip,
                            speed: oldCough.Speed),
                    });
                if (!library.IsValid) throw new InvalidOperationException("The generated Motifect motion library is incomplete.");
                EditorUtility.SetDirty(library);
                AssetDatabase.SaveAssets();
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                Debug.Log($"KATARUNE_MOTIFECT_LIBRARY_READY path={LibraryAssetPath}");
            }
            finally
            {
                if (Directory.Exists(stagingRoot)) Directory.Delete(stagingRoot, recursive: true);
            }
        }

        internal static string ResolveAlias(IEnumerable<string> names, params string[] aliases)
        {
            var matches = names
                .Where(name => aliases.Any(alias => string.Equals(
                    NormalizeClipName(name),
                    NormalizeClipName(alias),
                    StringComparison.OrdinalIgnoreCase)))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
            if (matches.Length == 0) return null;
            if (matches.Length > 1)
            {
                throw new InvalidOperationException($"Multiple clips match aliases: {string.Join(", ", matches)}");
            }
            return matches[0];
        }

        internal static string NormalizeClipName(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return string.Empty;
            var result = name.Trim();
            var separator = result.LastIndexOf('|');
            if (separator >= 0 && separator < result.Length - 1) result = result.Substring(separator + 1);
            if (result.EndsWith("_Loop", StringComparison.OrdinalIgnoreCase))
            {
                result = result.Substring(0, result.Length - "_Loop".Length);
            }
            return result;
        }

        private static PackSource ResolvePack(string source, string expectedFbx, string extractionPath)
        {
            if (string.IsNullOrWhiteSpace(source)) throw new ArgumentException("A motion pack source is required.");
            var fullPath = Path.GetFullPath(source.Trim().Trim('"'));
            string root;
            if (File.Exists(fullPath) && string.Equals(Path.GetExtension(fullPath), ".zip", StringComparison.OrdinalIgnoreCase))
            {
                Directory.CreateDirectory(extractionPath);
                ZipFile.ExtractToDirectory(fullPath, extractionPath);
                root = extractionPath;
            }
            else if (Directory.Exists(fullPath))
            {
                root = fullPath;
            }
            else
            {
                throw new FileNotFoundException("The selected motion pack was not found.", fullPath);
            }

            var fbxMatches = Directory.GetFiles(root, expectedFbx, SearchOption.AllDirectories);
            if (fbxMatches.Length != 1)
            {
                throw new InvalidOperationException($"Expected exactly one {expectedFbx}; found {fbxMatches.Length}.");
            }
            var licenseMatches = Directory.GetFiles(root, "License.txt", SearchOption.AllDirectories);
            var license = licenseMatches.FirstOrDefault(path =>
                File.ReadAllText(path).IndexOf("CC0", StringComparison.OrdinalIgnoreCase) >= 0);
            if (license == null)
            {
                throw new InvalidOperationException($"{expectedFbx} has no verifiable CC0 License.txt.");
            }
            return new PackSource(fbxMatches[0], license);
        }

        private static void CopySource(PackSource source, string fbxName, string licenseName)
        {
            var targetFolder = Path.Combine(Application.dataPath, "KataruneLocal", "Motions", "Source");
            Directory.CreateDirectory(targetFolder);
            File.Copy(source.FbxPath, Path.Combine(targetFolder, fbxName), overwrite: true);
            File.Copy(source.LicensePath, Path.Combine(targetFolder, licenseName), overwrite: true);
        }

        private static void ConfigureModelImporter(string assetPath, params string[] loopClips)
        {
            AssetDatabase.ImportAsset(assetPath, ImportAssetOptions.ForceSynchronousImport);
            var importer = AssetImporter.GetAtPath(assetPath) as ModelImporter
                ?? throw new InvalidOperationException($"No ModelImporter was created for {assetPath}.");
            importer.importAnimation = true;
            importer.animationType = ModelImporterAnimationType.Human;
            importer.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
            var clips = importer.defaultClipAnimations;
            if (clips.Length == 0) clips = importer.clipAnimations;
            foreach (var clip in clips)
            {
                var loop = loopClips.Any(name => string.Equals(
                    NormalizeClipName(name),
                    NormalizeClipName(clip.name),
                    StringComparison.OrdinalIgnoreCase));
                ConfigureClip(clip, loop);
            }
            importer.clipAnimations = clips;
            importer.SaveAndReimport();
        }

        internal static void ConfigureClip(ModelImporterClipAnimation clip, bool loop)
        {
            if (clip == null) throw new ArgumentNullException(nameof(clip));
            clip.loopTime = loop;
            clip.lockRootRotation = true;
            clip.lockRootHeightY = true;
            clip.lockRootPositionXZ = true;
            // Quaternius' FBX armature carries a 180-degree source-space facing offset.
            // Humanoid Body Orientation removes that source offset before retargeting to VRM.
            clip.keepOriginalOrientation = false;
            clip.rotationOffset = 0f;
            clip.keepOriginalPositionY = true;
            clip.heightFromFeet = false;
        }

        private static MotifectPackSource ResolveMotifectPack(string source, string extractionPath)
        {
            if (string.IsNullOrWhiteSpace(source)) throw new ArgumentException("A Motifect source is required.");
            var fullPath = Path.GetFullPath(source.Trim().Trim('"'));
            string root;
            if (File.Exists(fullPath) && string.Equals(Path.GetExtension(fullPath), ".zip", StringComparison.OrdinalIgnoreCase))
            {
                Directory.CreateDirectory(extractionPath);
                ZipFile.ExtractToDirectory(fullPath, extractionPath);
                root = extractionPath;
            }
            else if (Directory.Exists(fullPath))
            {
                root = fullPath;
            }
            else
            {
                throw new FileNotFoundException("The selected Motifect pack was not found.", fullPath);
            }

            var readmes = Directory.GetFiles(root, MotifectReadmeName, SearchOption.AllDirectories);
            if (readmes.Length != 1 || !IsValidMotifectReadme(File.ReadAllText(readmes[0])))
            {
                throw new InvalidOperationException(
                    "Motifect README.txt is missing or its project-use license could not be verified.");
            }

            var animationFiles = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var path in Directory.GetFiles(root, "*.fbx", SearchOption.AllDirectories))
            {
                var fileName = Path.GetFileName(path);
                if (animationFiles.ContainsKey(fileName))
                {
                    throw new InvalidOperationException(
                        $"Motifect contains duplicate FBX file names: {fileName}.");
                }
                animationFiles.Add(fileName, path);
            }
            if (animationFiles.Count == 0)
            {
                throw new InvalidOperationException("Motifect contains no FBX animation files.");
            }
            foreach (var motion in MotifectMotions)
            {
                if (!animationFiles.ContainsKey(motion.FileName))
                {
                    throw new InvalidOperationException($"Motifect is missing {motion.FileName}.");
                }
            }
            return new MotifectPackSource(readmes[0], animationFiles);
        }

        internal static bool IsValidMotifectReadme(string contents)
        {
            return !string.IsNullOrWhiteSpace(contents)
                && contents.IndexOf("Motifect Daily Life Motion Pack", StringComparison.OrdinalIgnoreCase) >= 0
                && contents.IndexOf("Free for personal and commercial use", StringComparison.OrdinalIgnoreCase) >= 0
                && contents.IndexOf("Do not redistribute or resell", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static void CopyMotifectSources(MotifectPackSource source)
        {
            var targetFolder = Path.Combine(Application.dataPath, "KataruneLocal", "Motions", "Motifect");
            Directory.CreateDirectory(targetFolder);
            File.Copy(source.ReadmePath, Path.Combine(targetFolder, MotifectReadmeName), overwrite: true);
            foreach (var pair in source.AnimationFiles)
            {
                File.Copy(pair.Value, Path.Combine(targetFolder, pair.Key), overwrite: true);
            }
        }

        private static void ConfigureSingleClipModelImporter(string assetPath, string clipName, bool loop)
        {
            AssetDatabase.ImportAsset(assetPath, ImportAssetOptions.ForceSynchronousImport);
            var importer = AssetImporter.GetAtPath(assetPath) as ModelImporter
                ?? throw new InvalidOperationException($"No ModelImporter was created for {assetPath}.");
            importer.importAnimation = true;
            importer.animationType = ModelImporterAnimationType.Human;
            importer.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
            var clips = importer.defaultClipAnimations;
            if (clips.Length == 0) clips = importer.clipAnimations;
            if (clips.Length != 1)
            {
                throw new InvalidOperationException(
                    $"Expected one animation clip in {assetPath}; found {clips.Length}.");
            }
            clips[0].name = clipName;
            ConfigureClip(clips[0], loop);
            importer.clipAnimations = clips;
            importer.SaveAndReimport();
        }

        private static AnimationClip LoadSingleClip(string assetPath, string clipName)
        {
            var matches = AssetDatabase.LoadAllAssetsAtPath(assetPath)
                .OfType<AnimationClip>()
                .Where(clip => !clip.name.StartsWith("__preview__", StringComparison.OrdinalIgnoreCase))
                .Where(clip => string.Equals(clip.name, clipName, StringComparison.OrdinalIgnoreCase))
                .ToArray();
            if (matches.Length != 1)
            {
                throw new InvalidOperationException(
                    $"Expected one imported clip named {clipName} in {assetPath}; found {matches.Length}.");
            }
            return matches[0];
        }

        private static Dictionary<string, AnimationClip> LoadClips(params string[] assetPaths)
        {
            var result = new Dictionary<string, AnimationClip>(StringComparer.OrdinalIgnoreCase);
            foreach (var path in assetPaths)
            {
                foreach (var clip in AssetDatabase.LoadAllAssetsAtPath(path).OfType<AnimationClip>())
                {
                    if (clip.name.StartsWith("__preview__", StringComparison.OrdinalIgnoreCase)) continue;
                    if (result.ContainsKey(clip.name))
                    {
                        throw new InvalidOperationException($"Duplicate animation clip name: {clip.name}");
                    }
                    result.Add(clip.name, clip);
                }
            }
            return result;
        }

        private static AnimationClip RequireClip(
            IReadOnlyDictionary<string, AnimationClip> clips,
            params string[] aliases)
        {
            var clip = FindClip(clips, aliases);
            if (clip != null) return clip;
            throw new InvalidOperationException($"Required clip not found: {string.Join(" / ", aliases)}");
        }

        private static AnimationClip FindClip(
            IReadOnlyDictionary<string, AnimationClip> clips,
            params string[] aliases)
        {
            var resolved = ResolveAlias(clips.Keys, aliases);
            if (resolved == null)
            {
                return null;
            }
            return clips[resolved];
        }

        private static void EnsureAssetFolder(string path)
        {
            var parts = path.Split('/');
            var current = parts[0];
            for (var index = 1; index < parts.Length; index += 1)
            {
                var next = $"{current}/{parts[index]}";
                if (!AssetDatabase.IsValidFolder(next)) AssetDatabase.CreateFolder(current, parts[index]);
                current = next;
            }
        }

        private readonly struct PackSource
        {
            public PackSource(string fbxPath, string licensePath)
            {
                FbxPath = fbxPath;
                LicensePath = licensePath;
            }

            public string FbxPath { get; }
            public string LicensePath { get; }
        }

        private readonly struct MotifectMotion
        {
            public MotifectMotion(string fileName, string clipName, bool loop)
            {
                FileName = fileName;
                ClipName = clipName;
                Loop = loop;
            }

            public string FileName { get; }
            public string ClipName { get; }
            public bool Loop { get; }
        }

        private readonly struct MotifectPackSource
        {
            public MotifectPackSource(
                string readmePath,
                IReadOnlyDictionary<string, string> animationFiles)
            {
                ReadmePath = readmePath;
                AnimationFiles = animationFiles;
            }

            public string ReadmePath { get; }
            public IReadOnlyDictionary<string, string> AnimationFiles { get; }
        }
    }
}
