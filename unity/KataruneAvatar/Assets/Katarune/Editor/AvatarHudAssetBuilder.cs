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
            panelSettings.scaleMode = PanelScaleMode.ScaleWithScreenSize;
            panelSettings.referenceResolution = new Vector2Int(1920, 1080);
            panelSettings.screenMatchMode = PanelScreenMatchMode.MatchWidthOrHeight;
            panelSettings.match = 0.5f;
            panelSettings.sortingOrder = 100f;
            panelSettings.clearDepthStencil = false;
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
            foreach (var guid in AssetDatabase.FindAssets("t:DefaultAsset", new[] { HudDirectory + "/Icons" }))
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                if (!path.EndsWith(".svg", StringComparison.OrdinalIgnoreCase)) continue;
                if (!(AssetImporter.GetAtPath(path) is SVGImporter importer)) continue;
                if (importer.SvgType == SVGType.VectorImage) continue;
                importer.SvgType = SVGType.VectorImage;
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
