using System;
using System.IO;
using Unity.VectorGraphics.Editor;
using UnityEditor;
using UnityEngine;
using UnityEngine.UIElements;

namespace Katarune.Avatar.Editor
{
    public static class AvatarHudAssetBuilder
    {
        private const string HudDirectory = "Assets/Katarune/Runtime/UI/Hud";
        private const string UxmlPath = HudDirectory + "/AvatarHud.uxml";
        private const string ThemePath = HudDirectory + "/AvatarHudRuntimeTheme.tss";
        private const string PanelSettingsPath = HudDirectory + "/AvatarHudPanelSettings.asset";
        private const string PrefabPath = "Assets/Katarune/Resources/AvatarHud.prefab";
        private static readonly string[] ControlIcons =
        {
            "mic", "mic-off", "message-circle-more", "ellipsis", "chevrons-right", "close", "chevron-down", "refresh-cw",
        };

        [MenuItem("Katarune/Avatar/Rebuild HUD Assets")]
        public static void BuildAssets()
        {
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            ConfigureVectorImages();

            var tree = AssetDatabase.LoadAssetAtPath<VisualTreeAsset>(UxmlPath);
            if (tree == null) throw new InvalidOperationException($"HUD UXML failed to import: {UxmlPath}");
            var theme = AssetDatabase.LoadAssetAtPath<ThemeStyleSheet>(ThemePath);
            if (theme == null) throw new InvalidOperationException($"HUD theme failed to import: {ThemePath}");

            var panelSettings = GetOrCreatePanelSettings();
            panelSettings.themeStyleSheet = theme;
            panelSettings.scaleMode = PanelScaleMode.ConstantPixelSize;
            panelSettings.scale = 1f;
            panelSettings.referenceResolution = new Vector2Int(1920, 1080);
            panelSettings.screenMatchMode = PanelScreenMatchMode.MatchWidthOrHeight;
            panelSettings.match = 0.5f;
            panelSettings.sortingOrder = 100f;
            panelSettings.clearDepthStencil = true;
            panelSettings.clearColor = false;
            EditorUtility.SetDirty(panelSettings);

            EnsureAssetFolder(Path.GetDirectoryName(PrefabPath)?.Replace('\\', '/'));
            var hudObject = new GameObject("Avatar HUD");
            try
            {
                var document = hudObject.AddComponent<UIDocument>();
                document.panelSettings = panelSettings;
                document.visualTreeAsset = tree;
                document.sortingOrder = 100f;
                hudObject.AddComponent<AvatarHudController>();
                PrefabUtility.SaveAsPrefabAsset(hudObject, PrefabPath);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(hudObject);
            }

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            Debug.Log($"KATARUNE_HUD_ASSETS_READY prefab={PrefabPath}");
        }

        private static PanelSettings GetOrCreatePanelSettings()
        {
            var settings = AssetDatabase.LoadAssetAtPath<PanelSettings>(PanelSettingsPath);
            if (settings != null) return settings;
            settings = ScriptableObject.CreateInstance<PanelSettings>();
            AssetDatabase.CreateAsset(settings, PanelSettingsPath);
            return settings;
        }

        private static void ConfigureVectorImages()
        {
            foreach (var file in Directory.GetFiles(HudDirectory + "/Icons", "*.svg"))
            {
                var path = file.Replace('\\', '/');
                if (!(AssetImporter.GetAtPath(path) is SVGImporter importer)) continue;
                var isControlIcon = Array.IndexOf(ControlIcons, Path.GetFileNameWithoutExtension(path)) >= 0;
                if (importer.SvgType == SVGType.VectorImage && (!isControlIcon ||
                    importer.ViewportOptions == Unity.VectorGraphics.ViewportOptions.PreserveViewport)) continue;
                importer.SvgType = SVGType.VectorImage;
                // Icons also include a transparent canvas rectangle to keep VectorImage mesh bounds at 24x24.
                if (isControlIcon)
                {
                    importer.ViewportOptions = Unity.VectorGraphics.ViewportOptions.PreserveViewport;
                }
                EditorUtility.SetDirty(importer);
                importer.SaveAndReimport();
            }
        }

        private static void EnsureAssetFolder(string path)
        {
            if (string.IsNullOrWhiteSpace(path) || AssetDatabase.IsValidFolder(path)) return;
            var parent = Path.GetDirectoryName(path)?.Replace('\\', '/');
            EnsureAssetFolder(parent);
            AssetDatabase.CreateFolder(parent, Path.GetFileName(path));
        }
    }
}
