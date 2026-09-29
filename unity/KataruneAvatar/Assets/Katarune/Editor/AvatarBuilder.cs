using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using VRM10.MToon10;

namespace Katarune.Avatar.Editor
{
    public static class AvatarBuilder
    {
        public static void BuildWindows()
        {
            var outputPath = Path.GetFullPath(Path.Combine(
                Application.dataPath,
                "..",
                "Builds",
                "Windows",
                "KataruneAvatar.exe"));
            var outputDirectory = Path.GetDirectoryName(outputPath);
            if (string.IsNullOrEmpty(outputDirectory)) throw new InvalidOperationException("The build output directory could not be resolved.");

            Directory.CreateDirectory(outputDirectory);
            ConfigurePlayer();
            ConfigureTransparentUrp();
            ConfigureAvatarRenderingAssets();
            PreserveRuntimeShaders();
            var scenes = EditorBuildSettings.scenes.Where(scene => scene.enabled).Select(scene => scene.path).ToArray();
            if (scenes.Length == 0) throw new InvalidOperationException("At least one enabled scene is required for the avatar build.");

            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = scenes,
                locationPathName = outputPath,
                target = BuildTarget.StandaloneWindows64,
                options = BuildOptions.None,
            });
            if (report.summary.result != BuildResult.Succeeded)
            {
                throw new InvalidOperationException($"Avatar build failed with result {report.summary.result} and {report.summary.totalErrors} errors.");
            }
            CopyLocalDefaultAssets(outputPath);
            CopyLocalMotionPacks(outputDirectory);
            Debug.Log($"KATARUNE_AVATAR_BUILD_READY path={outputPath} bytes={report.summary.totalSize}");
        }

        private static void CopyLocalMotionPacks(string outputDirectory)
        {
            var destination = Path.Combine(outputDirectory, "MotionPacks");
            Directory.CreateDirectory(destination);
            if (!Directory.Exists(AvatarMotionPacks.DefaultDirectory)) return;
            foreach (var pack in Directory.GetFiles(AvatarMotionPacks.DefaultDirectory, "*" + AvatarMotionPacks.Extension))
                File.Copy(pack, Path.Combine(destination, Path.GetFileName(pack)), true);
        }

        private static void CopyLocalDefaultAssets(string playerPath)
        {
            var playerDirectory = Path.GetDirectoryName(playerPath)
                ?? throw new InvalidOperationException("The player directory could not be resolved.");
            var dataDirectory = Path.Combine(
                playerDirectory,
                Path.GetFileNameWithoutExtension(playerPath) + "_Data");
            CopyLocalAsset(AvatarDefaultAssets.ModelPath(Application.dataPath), AvatarDefaultAssets.ModelPath(dataDirectory));
        }

        private static void CopyLocalAsset(string sourcePath, string destinationPath)
        {
            if (!File.Exists(sourcePath))
            {
                Debug.LogWarning($"KATARUNE_LOCAL_DEFAULT_ASSET_MISSING path={sourcePath}");
                return;
            }
            Directory.CreateDirectory(Path.GetDirectoryName(destinationPath));
            File.Copy(sourcePath, destinationPath, overwrite: true);
            Debug.Log($"KATARUNE_LOCAL_DEFAULT_ASSET_COPIED path={destinationPath}");
        }

        [MenuItem("Katarune/配置角色渲染")]
        public static void ConfigureAvatarRenderingAssets()
        {
            EnsureDefaultVisualProfile();
            EnsureMToonOutlineFeature("Assets/Settings/PC_Renderer.asset");
            EnsureMToonOutlineFeature("Assets/Settings/Mobile_Renderer.asset");
            AssetDatabase.SaveAssets();
            Debug.Log("KATARUNE_AVATAR_RENDERING_ASSETS_READY");
        }

        private static void EnsureDefaultVisualProfile()
        {
            const string resourcesFolder = "Assets/Katarune/Resources";
            const string profilePath = resourcesFolder + "/AvatarVisualProfile.asset";
            if (!AssetDatabase.IsValidFolder(resourcesFolder))
            {
                AssetDatabase.CreateFolder("Assets/Katarune", "Resources");
            }
            if (AssetDatabase.LoadAssetAtPath<AvatarVisualProfile>(profilePath) != null) return;

            var profile = ScriptableObject.CreateInstance<AvatarVisualProfile>();
            profile.name = "AvatarVisualProfile";
            AssetDatabase.CreateAsset(profile, profilePath);
        }

        private static void EnsureMToonOutlineFeature(string rendererDataPath)
        {
            var rendererData = AssetDatabase.LoadAssetAtPath<ScriptableRendererData>(rendererDataPath)
                ?? throw new InvalidOperationException($"URP renderer data was not found: {rendererDataPath}");
            if (rendererData.rendererFeatures.Any(feature => feature is MToonOutlineRenderFeature)) return;

            var outlineFeature = ScriptableObject.CreateInstance<MToonOutlineRenderFeature>();
            outlineFeature.name = "MToon Outline";
            outlineFeature.Create();
            AssetDatabase.AddObjectToAsset(outlineFeature, rendererData);
            rendererData.rendererFeatures.Add(outlineFeature);
            EditorUtility.SetDirty(rendererData);
        }

        private static void ConfigurePlayer()
        {
            PlayerSettings.companyName = "Katarune";
            PlayerSettings.productName = "Katarune Avatar";
            PlayerSettings.fullScreenMode = FullScreenMode.FullScreenWindow;
            PlayerSettings.defaultIsNativeResolution = true;
            PlayerSettings.resizableWindow = false;
            PlayerSettings.allowFullscreenSwitch = false;
            PlayerSettings.runInBackground = true;
            PlayerSettings.SplashScreen.show = false;
            PlayerSettings.SplashScreen.showUnityLogo = false;
            PlayerSettings.useFlipModelSwapchain = false;
            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.StandaloneWindows64, false);
            PlayerSettings.SetGraphicsAPIs(
                BuildTarget.StandaloneWindows64,
                new[] { GraphicsDeviceType.Direct3D11 });
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Standalone, "app.katarune.avatar");
        }

        private static void PreserveRuntimeShaders()
        {
            var shaderNames = new[]
            {
                "VRM10/Universal Render Pipeline/MToon10",
                "UniGLTF/UniUnlit",
                "Universal Render Pipeline/Lit",
                "Universal Render Pipeline/Unlit",
            };
            var graphicsSettings = new SerializedObject(GraphicsSettings.GetGraphicsSettings());
            var shaders = graphicsSettings.FindProperty("m_AlwaysIncludedShaders")
                ?? throw new InvalidOperationException("Unity GraphicsSettings no longer exposes m_AlwaysIncludedShaders.");
            foreach (var shaderName in shaderNames)
            {
                var shader = Shader.Find(shaderName)
                    ?? throw new InvalidOperationException($"Required runtime shader was not found: {shaderName}");
                var isIncluded = Enumerable.Range(0, shaders.arraySize)
                    .Any(index => shaders.GetArrayElementAtIndex(index).objectReferenceValue == shader);
                if (isIncluded) continue;
                var index = shaders.arraySize;
                shaders.InsertArrayElementAtIndex(index);
                shaders.GetArrayElementAtIndex(index).objectReferenceValue = shader;
            }
            graphicsSettings.ApplyModifiedPropertiesWithoutUndo();
            AssetDatabase.SaveAssets();
        }

        private static void ConfigureTransparentUrp()
        {
            var pipelineGuids = AssetDatabase.FindAssets("t:UniversalRenderPipelineAsset");
            if (pipelineGuids.Length == 0)
            {
                throw new InvalidOperationException("No Universal Render Pipeline asset was found.");
            }

            foreach (var guid in pipelineGuids)
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                var pipeline = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(path);
                pipeline.supportsHDR = false;

                var serialized = new SerializedObject(pipeline);
                var alphaProcessing = serialized.FindProperty("m_AllowPostProcessAlphaOutput")
                    ?? throw new InvalidOperationException($"URP asset has no Alpha Processing setting: {path}");
                alphaProcessing.boolValue = true;
                serialized.ApplyModifiedPropertiesWithoutUndo();
                EditorUtility.SetDirty(pipeline);
            }

            AssetDatabase.SaveAssets();
        }

    }
}
