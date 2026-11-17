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
            importer.wrapMode = assetPath.EndsWith("/CloudObservatory.png", StringComparison.Ordinal)
                ? TextureWrapMode.Clamp : TextureWrapMode.Repeat;
            importer.filterMode = FilterMode.Bilinear;
            importer.mipmapEnabled = true;
        }
    }

    public static class AvatarImmersivePreview
    {
        // Render the actual URP background without loading a scene or personal model.
        public static void Capture()
        {
            if (!Application.isBatchMode) throw new InvalidOperationException("Run the background capture in a batch Editor.");
            var output = Path.GetFullPath(Path.Combine(Application.dataPath,"../../..",".test-dist/immersive-reference"));
            Directory.CreateDirectory(output);
            foreach (var path in new[] { "Typography", "Film", "Frames", "CloudObservatory" })
                AssetDatabase.ImportAsset($"Assets/Katarune/Resources/Immersive/{path}.png", ImportAssetOptions.ForceUpdate);
            var root = new GameObject("Immersive background capture camera");
            var camera = root.AddComponent<Camera>();
            try
            {
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = Color.clear;
                var backdrop = root.AddComponent<AvatarImmersiveBackdrop>();
                backdrop.SetVisible(true);
                backdrop.Advance(1f);
                var material = root.GetComponentInChildren<MeshRenderer>().sharedMaterial;
                foreach (var time in new[] { 0, 5 })
                {
                    material.SetFloat("_MotionTime",time);
                    SaveFrame(camera,1920,1080,Path.Combine(output,$"shader-{time}.png"));
                }
                backdrop.SetBackground("cloud-observatory");
                SaveFrame(camera,1920,1080,Path.Combine(output,"cloud-observatory-landscape.png"));
                SaveFrame(camera,1080,1920,Path.Combine(output,"cloud-observatory-portrait.png"));
                backdrop.SetBackground("island-coast");
                camera.fieldOfView = 28;
                camera.transform.position = new Vector3(0,1.15f,4.1f);
                camera.transform.LookAt(new Vector3(0,.86f,0));
                SaveFrame(camera,1920,1080,Path.Combine(output,"island-coast-fullbody.png"));
                SaveFrame(camera,1080,1920,Path.Combine(output,"island-coast-portrait.png"));
                camera.fieldOfView = 26;
                camera.transform.position = new Vector3(0,1.4f,2.25f);
                camera.transform.LookAt(new Vector3(0,1.3f,0));
                SaveFrame(camera,1920,1080,Path.Combine(output,"island-coast-dialogue.png"));
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        private static void SaveFrame(Camera camera, int width, int height, string path)
        {
            var target = new RenderTexture(width,height,24,RenderTextureFormat.ARGB32);
            var pixels = new Texture2D(width,height,TextureFormat.RGB24,false);
            var previous = RenderTexture.active;
            try
            {
                camera.targetTexture = target;
                camera.aspect = width/(float)height;
                camera.Render();
                RenderTexture.active = target;
                pixels.ReadPixels(new Rect(0,0,width,height),0,0);
                pixels.Apply();
                File.WriteAllBytes(path,pixels.EncodeToPNG());
            }
            finally
            {
                RenderTexture.active = previous;
                camera.targetTexture = null;
                UnityEngine.Object.DestroyImmediate(target);
                UnityEngine.Object.DestroyImmediate(pixels);
            }
        }
    }
}
