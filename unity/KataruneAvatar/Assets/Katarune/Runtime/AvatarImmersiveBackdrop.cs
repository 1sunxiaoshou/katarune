using System;
using UnityEngine;
using UnityEngine.Rendering;

namespace Katarune.Avatar
{
    // Screen backgrounds and an optional world-space island share the avatar camera.
    // No extra window, camera, texture upload or model transform changes.
    [DefaultExecutionOrder(1000)]
    public sealed class AvatarImmersiveBackdrop : MonoBehaviour
    {
        internal const string DefaultBackgroundId = "film";
        internal string BackgroundId { get; private set; } = DefaultBackgroundId;
        private GameObject _surface;
        private Mesh _mesh;
        private Material _material;
        private float _opacity;
        private float _motionTime;
        private bool _visible;
        private AvatarIslandBackdrop _island;
        private Vector3 _stageOrigin;
        private float _stageScale = 1f;
        private Transform _avatar;

        internal void BindAvatar(Transform avatar)
        {
            _avatar = avatar;
            _island?.BindAvatar(avatar);
        }

        private void Awake() => EnsureResources();

        internal void SetBackground(string id)
        {
            if (id != DefaultBackgroundId && id != "cloud-observatory" && id != "island-coast")
                throw new ArgumentException("背景无效。", nameof(id));
            var picture = id == "cloud-observatory"
                ? Resources.Load<Texture2D>("Immersive/CloudObservatory")
                    ?? throw new InvalidOperationException("云端星象背景资源缺失。")
                : null;
            EnsureResources();
            if (id == "island-coast" && _island == null) _island = new AvatarIslandBackdrop(GetComponent<Camera>());
            _island?.BindAvatar(_avatar);
            _material.SetTexture("_Picture", picture);
            _material.SetFloat("_PictureMode", picture != null ? 1f : 0f);
            _material.SetFloat("_IslandSky", id == "island-coast" ? 1f : 0f);
            BackgroundId = id;
            UpdateIsland();
        }

        internal void SetStage(Vector3 origin, float height)
        {
            _stageOrigin = origin;
            _stageScale = Mathf.Max(.1f, height / 1.65f);
            UpdateIsland();
        }

        private void UpdateIsland() => _island?.Update(
            BackgroundId == "island-coast" ? Mathf.SmoothStep(0f, 1f, _opacity) : 0f,
            _motionTime, _stageOrigin, _stageScale);

        internal void SetVisible(bool visible)
        {
            _visible = visible;
            if (visible) EnsureResources();
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

        private void LateUpdate() => Advance(Time.unscaledDeltaTime);

        internal void Advance(float deltaTime)
        {
            if (_material == null) return;
            _opacity = Mathf.MoveTowards(_opacity, _visible ? 1f : 0f, Mathf.Max(0f, deltaTime) / .9f);
            _material.SetFloat("_Opacity", Mathf.SmoothStep(0f, 1f, _opacity));
            _motionTime += Mathf.Max(0f, deltaTime);
            _material.SetFloat("_MotionTime", _motionTime);
            _surface.SetActive(_opacity > 0f);
            UpdateIsland();
        }

        private void OnDestroy()
        {
            _island?.Dispose();
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
