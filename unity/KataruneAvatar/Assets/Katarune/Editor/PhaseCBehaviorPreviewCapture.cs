using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

namespace Katarune.Avatar.Editor
{
    internal static class PhaseCBehaviorPreviewCapture
    {
        private const string ExplainPath =
            "Assets/Katarune/Behaviors/QuaterniusFullBodyExplain.kbehavior";
        private const string DancePath =
            "Assets/Katarune/Behaviors/QuaterniusShortDance.kbehavior";

        public static void Capture()
        {
            if (!Application.isBatchMode)
            {
                throw new InvalidOperationException(
                    "Phase C preview capture runs only in an isolated batch Editor to avoid changing an open scene.");
            }
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PhaseCBehaviorSampleGenerator.SourcePath)
                ?? throw new InvalidOperationException("Import the local UAL1 Standard source first.");
            var explain = Load(ExplainPath);
            var dance = Load(DancePath);
            var output = Path.GetFullPath("TestResults/phase-c-preview");
            Directory.CreateDirectory(output);

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            try
            {
                var model = Object.Instantiate(prefab);
                model.name = "Phase C preview mannequin";
                SceneManager.MoveGameObjectToScene(model, scene);
                var animator = model.GetComponentInChildren<Animator>()
                    ?? throw new InvalidOperationException("UAL1 preview prefab has no Animator.");
                if (!animator.isHuman) throw new InvalidOperationException("UAL1 preview Animator is not Humanoid.");
                animator.runtimeAnimatorController = null;
                animator.applyRootMotion = false;
                animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
                animator.Update(0f);

                var cameraObject = new GameObject("Phase C preview camera");
                SceneManager.MoveGameObjectToScene(cameraObject, scene);
                var camera = cameraObject.AddComponent<Camera>();
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.055f, 0.065f, 0.08f, 1f);
                camera.fieldOfView = 30f;
                camera.nearClipPlane = 0.01f;
                camera.farClipPlane = 100f;

                var lightObject = new GameObject("Phase C preview light");
                SceneManager.MoveGameObjectToScene(lightObject, scene);
                var light = lightObject.AddComponent<Light>();
                light.type = LightType.Directional;
                light.intensity = 1.4f;
                lightObject.transform.rotation = Quaternion.Euler(35f, -30f, 0f);

                Frame(camera, model);
                CaptureSingle(camera, animator, explain.Clip, 2.0,
                    Path.Combine(output, "full-body-explain.png"));
                CaptureSingle(camera, animator, dance.Clip, 0.5,
                    Path.Combine(output, "short-dance-loop.png"));
                CaptureSingle(camera, animator, dance.Clip, 1.5,
                    Path.Combine(output, "short-dance-exit.png"));
            }
            finally
            {
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            }

            Debug.Log($"KATARUNE_PHASE_C_PREVIEW_READY path={output}");
        }

        private static BehaviorDefinitionAsset Load(string path) =>
            AssetDatabase.LoadAssetAtPath<BehaviorDefinitionAsset>(path)
            ?? throw new InvalidOperationException($"Behavior definition is missing: {path}");

        private static void CaptureSingle(
            Camera camera,
            Animator animator,
            AnimationClip clip,
            double time,
            string path)
        {
            CaptureSingle(camera, animator, clip, time, path, allowRetry: true);
        }

        private static void CaptureSingle(
            Camera camera,
            Animator animator,
            AnimationClip clip,
            double time,
            string path,
            bool allowRetry)
        {
            animator.Rebind();
            animator.Update(0f);
            var graph = PlayableGraph.Create("Phase C preview clip");
            var captured = false;
            try
            {
                graph.SetTimeUpdateMode(DirectorUpdateMode.Manual);
                var playable = AnimationClipPlayable.Create(graph, clip);
                playable.SetTime(time);
                playable.SetSpeed(0d);
                var output = AnimationPlayableOutput.Create(graph, "Humanoid", animator);
                output.SetSourcePlayable(playable);
                graph.Play();
                graph.Evaluate(0.01f);
                graph.Evaluate(0.01f);
                captured = Render(camera, animator, path);
            }
            finally
            {
                if (graph.IsValid()) graph.Destroy();
            }
            if (!captured)
            {
                if (!allowRetry) throw new InvalidOperationException($"Preview render stayed empty: {path}");
                CaptureSingle(camera, animator, clip, time, path, allowRetry: false);
            }
        }

        private static void Frame(Camera camera, GameObject model)
        {
            var renderers = model.GetComponentsInChildren<Renderer>();
            if (renderers.Length == 0) throw new InvalidOperationException("UAL1 preview has no Renderer.");
            foreach (var renderer in renderers)
            {
                renderer.enabled = true;
                renderer.gameObject.SetActive(true);
            }
            var bounds = renderers[0].bounds;
            foreach (var renderer in renderers.Skip(1)) bounds.Encapsulate(renderer.bounds);
            var height = Mathf.Max(bounds.size.y, 0.1f);
            camera.transform.position = bounds.center + new Vector3(0f, 0f, height * 2.5f);
            camera.transform.LookAt(bounds.center + Vector3.up * height * 0.03f);
            Debug.Log(
                $"KATARUNE_PHASE_C_PREVIEW_FRAME renderers={renderers.Length} bounds={bounds} camera={camera.transform.position}");
        }

        private static bool Render(Camera camera, Animator animator, string path)
        {
            var target = RenderTexture.GetTemporary(720, 960, 24, RenderTextureFormat.ARGB32);
            var previous = RenderTexture.active;
            var skins = animator.GetComponentsInChildren<SkinnedMeshRenderer>();
            var bakedMeshes = new Mesh[skins.Length];
            var proxies = new GameObject[skins.Length];
            try
            {
                for (var index = 0; index < skins.Length; index += 1)
                {
                    var skin = skins[index];
                    var mesh = new Mesh { name = skin.name + " preview bake" };
                    skin.BakeMesh(mesh);
                    var proxy = new GameObject(skin.name + " preview proxy");
                    SceneManager.MoveGameObjectToScene(proxy, camera.gameObject.scene);
                    proxy.transform.SetPositionAndRotation(skin.transform.position, skin.transform.rotation);
                    proxy.transform.localScale = skin.transform.lossyScale;
                    proxy.AddComponent<MeshFilter>().sharedMesh = mesh;
                    proxy.AddComponent<MeshRenderer>().sharedMaterials = skin.sharedMaterials;
                    skin.forceRenderingOff = true;
                    bakedMeshes[index] = mesh;
                    proxies[index] = proxy;
                }
                camera.targetTexture = target;
                camera.Render();
                camera.Render();
                RenderTexture.active = target;
                var texture = new Texture2D(720, 960, TextureFormat.RGBA32, false);
                try
                {
                    texture.ReadPixels(new Rect(0f, 0f, 720f, 960f), 0, 0);
                    texture.Apply();
                    var visiblePixels = texture.GetPixels32().Count(pixel =>
                        pixel.r > 45 || pixel.g > 45 || pixel.b > 45);
                    if (visiblePixels < 100) return false;
                    File.WriteAllBytes(path, texture.EncodeToPNG());
                    return true;
                }
                finally
                {
                    Object.DestroyImmediate(texture);
                }
            }
            finally
            {
                for (var index = 0; index < skins.Length; index += 1)
                {
                    skins[index].forceRenderingOff = false;
                    if (proxies[index] != null) Object.DestroyImmediate(proxies[index]);
                    if (bakedMeshes[index] != null) Object.DestroyImmediate(bakedMeshes[index]);
                }
                camera.targetTexture = null;
                RenderTexture.active = previous;
                RenderTexture.ReleaseTemporary(target);
            }
        }
    }
}
