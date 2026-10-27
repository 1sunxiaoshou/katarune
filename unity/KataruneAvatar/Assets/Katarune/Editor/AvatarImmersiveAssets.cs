using System;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Katarune.Avatar.Editor
{
    public sealed class AvatarImmersiveTextureImporter : AssetPostprocessor
    {
        private void OnPreprocessTexture()
        {
            if (!assetPath.StartsWith("Assets/Katarune/Resources/Immersive/", StringComparison.Ordinal)) return;
            var importer = (TextureImporter)assetImporter;
            importer.npotScale = TextureImporterNPOTScale.None;
            importer.maxTextureSize = 4096;
            importer.textureCompression = TextureImporterCompression.Uncompressed;
            importer.wrapMode = TextureWrapMode.Repeat;
            importer.filterMode = FilterMode.Bilinear;
            importer.mipmapEnabled = true;
        }
    }

    public static class AvatarImmersivePreview
    {
        // Render the actual URP material at the same dimensions/times as the
        // offline Canvas reference. This never loads a scene or personal model.
        public static void Capture()
        {
            if (!Application.isBatchMode) throw new InvalidOperationException("Run the background comparison in a batch Editor.");
            var output = Path.GetFullPath(Path.Combine(Application.dataPath,"../../..",".test-dist/immersive-reference"));
            Directory.CreateDirectory(output);
            foreach (var path in new[] { "Typography", "Film", "Frames" })
                AssetDatabase.ImportAsset($"Assets/Katarune/Resources/Immersive/{path}.png", ImportAssetOptions.ForceUpdate);
            var root = new GameObject("Immersive background comparison camera");
            var camera = root.AddComponent<Camera>();
            var target = new RenderTexture(1920,1080,24,RenderTextureFormat.ARGB32);
            var pixels = new Texture2D(1920,1080,TextureFormat.RGB24,false);
            var previous = RenderTexture.active;
            try
            {
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = Color.clear;
                camera.targetTexture = target;
                var backdrop = root.AddComponent<AvatarImmersiveBackdrop>();
                backdrop.SetVisibility(true,1f);
                var material = root.GetComponentInChildren<MeshRenderer>().sharedMaterial;
                foreach (var time in new[] { 0, 5 })
                {
                    material.SetFloat("_MotionTime",time);
                    camera.Render();
                    RenderTexture.active = target;
                    pixels.ReadPixels(new Rect(0,0,1920,1080),0,0);
                    pixels.Apply();
                    File.WriteAllBytes(Path.Combine(output,$"shader-{time}.png"),pixels.EncodeToPNG());
                }
            }
            finally
            {
                RenderTexture.active = previous;
                camera.targetTexture = null;
                UnityEngine.Object.DestroyImmediate(root);
                UnityEngine.Object.DestroyImmediate(target);
                UnityEngine.Object.DestroyImmediate(pixels);
            }
        }
    }
}
