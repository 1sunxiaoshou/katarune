using System;
using UnityEngine;
using UnityEngine.Rendering;

namespace Katarune.Avatar
{
    // A screen-space background pass in the avatar camera. No second window,
    // scene camera, WebView, per-frame texture upload or model transform changes.
    [DefaultExecutionOrder(1000)]
    public sealed class AvatarImmersiveBackdrop : MonoBehaviour
    {
        private GameObject _surface;
        private Mesh _mesh;
        private Material _material;
        private float _opacity;
        private float _motionTime;
        private void Awake()
        {
            EnsureResources();
        }

        private void EnsureResources()
        {
            if (_material != null) return;
            var shader = Resources.Load<Shader>("Immersive/Backdrop")
                ?? throw new InvalidOperationException("Immersive backdrop shader is missing.");
            _material = new Material(shader);
            _material.SetTexture("_Typography", Resources.Load<Texture2D>("Immersive/Typography"));
            _material.SetTexture("_Film", Resources.Load<Texture2D>("Immersive/Film"));
            _material.SetTexture("_Frames", Resources.Load<Texture2D>("Immersive/Frames"));
            _mesh = new Mesh { name = "Immersive screen quad" };
            _mesh.vertices = new[] { new Vector3(-.5f,-.5f,0), new Vector3(.5f,-.5f,0), new Vector3(.5f,.5f,0), new Vector3(-.5f,.5f,0) };
            _mesh.uv = new[] { Vector2.zero, Vector2.right, Vector2.one, Vector2.up };
            _mesh.triangles = new[] { 0,1,2,0,2,3 };
            _mesh.bounds = new Bounds(Vector3.zero, Vector3.one * 100f);
            _surface = new GameObject("Katarune immersive background");
            _surface.transform.SetParent(transform, false);
            _surface.transform.localPosition = Vector3.forward;
            _surface.AddComponent<MeshFilter>().sharedMesh = _mesh;
            var renderer = _surface.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = _material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.lightProbeUsage = LightProbeUsage.Off;
            renderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
            _surface.SetActive(false);
        }

        internal void SetVisibility(bool visible, float deltaTime)
        {
            EnsureResources();
            _opacity = Mathf.MoveTowards(_opacity, visible ? 1f : 0f, Mathf.Max(0f, deltaTime) / .9f);
            _material.SetFloat("_Opacity", Mathf.SmoothStep(0f, 1f, _opacity));
            _motionTime += Mathf.Max(0f, deltaTime);
            _material.SetFloat("_MotionTime", _motionTime);
            _surface.SetActive(_opacity > 0f);
        }

        private void OnDestroy()
        {
            Release(_surface);
            Release(_mesh);
            Release(_material);
        }

        private static void Release(UnityEngine.Object resource)
        {
            if (resource == null) return;
            if (Application.isPlaying) Destroy(resource);
            else DestroyImmediate(resource);
        }
    }
}
