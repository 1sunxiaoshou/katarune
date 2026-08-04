using System;
using System.IO;
using UnityEngine;

namespace Katarune.Avatar
{
    public sealed class AvatarSceneRig : MonoBehaviour
    {
        private Camera _camera;
        private GameObject _floor;
        private Material _floorMaterial;
        private AvatarLightingRig _lightingRig;
        private Bounds _framedBounds;
        private bool _hasFramedBounds;
        private Vector2Int _lastScreenSize;

        private bool _transparent;

        public void Configure(bool transparent)
        {
            _transparent = transparent;
            _camera = Camera.main;
            if (_camera == null)
            {
                var cameraObject = new GameObject("Avatar Camera") { tag = "MainCamera" };
                _camera = cameraObject.AddComponent<Camera>();
            }

            _camera.clearFlags = CameraClearFlags.SolidColor;
            _camera.backgroundColor = transparent
                ? new Color(0f, 0f, 0f, 0f)
                : new Color(0.018f, 0.022f, 0.032f, 1f);
            _camera.fieldOfView = 30f;
            _camera.allowHDR = false;
            _camera.nearClipPlane = 0.01f;
            _camera.farClipPlane = 100f;

            _lightingRig = gameObject.AddComponent<AvatarLightingRig>();
            _lightingRig.Configure();
        }

        public void SetActivityLighting(AvatarActivityState activity)
        {
            _lightingRig?.SetActivity(activity);
        }

        public void SetRenderQuality(AvatarRenderQuality quality)
        {
            _lightingRig?.SetQuality(quality);
        }

        public Bounds Frame(GameObject avatar)
        {
            if (avatar == null) throw new ArgumentNullException(nameof(avatar));

            var renderers = avatar.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0) throw new InvalidOperationException("The avatar contains no renderers.");
            var bounds = renderers[0].bounds;
            for (var index = 1; index < renderers.Length; index += 1) bounds.Encapsulate(renderers[index].bounds);

            _framedBounds = bounds;
            _hasFramedBounds = true;
            ApplyFraming(bounds);

            if (!_transparent && _floor == null)
            {
                _floor = GameObject.CreatePrimitive(PrimitiveType.Plane);
                _floor.name = "Avatar Floor";
                var collider = _floor.GetComponent<Collider>();
                if (collider != null) Destroy(collider);
                var shader = Shader.Find("Universal Render Pipeline/Lit")
                    ?? throw new InvalidOperationException("URP Lit shader was not found.");
                _floorMaterial = new Material(shader) { color = new Color(0.19f, 0.18f, 0.22f) };
                _floor.GetComponent<Renderer>().sharedMaterial = _floorMaterial;
            }

            if (_floor != null)
            {
                _floor.transform.position = new Vector3(bounds.center.x, bounds.min.y - 0.006f, bounds.center.z);
                _floor.transform.localScale = Vector3.one * Mathf.Max(0.8f, bounds.size.y * 0.7f);
            }
            return bounds;
        }

        public static float GetDesiredViewportCenterX(float aspect)
        {
            return Mathf.Lerp(0.7f, 0.8f, Mathf.InverseLerp(1f, 2.4f, Mathf.Max(0.1f, aspect)));
        }

        public void Capture(string path)
        {
            var fullPath = Path.GetFullPath(path);
            var directory = Path.GetDirectoryName(fullPath);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            ScreenCapture.CaptureScreenshot(fullPath);
        }

        private void LateUpdate()
        {
            if (!_hasFramedBounds || _camera == null) return;
            var screenSize = new Vector2Int(Screen.width, Screen.height);
            if (screenSize == _lastScreenSize) return;
            ApplyFraming(_framedBounds);
        }

        private void ApplyFraming(Bounds bounds)
        {
            var screenHeight = Mathf.Max(1f, Screen.height);
            var aspect = Mathf.Max(0.1f, Screen.width / screenHeight);
            var target = bounds.center + Vector3.up * bounds.size.y * 0.015f;
            var halfHeight = Mathf.Max(bounds.extents.y, 0.5f);
            var distance = halfHeight / Mathf.Tan(_camera.fieldOfView * 0.5f * Mathf.Deg2Rad) * 1.1f;
            var verticalHalfWorld = distance * Mathf.Tan(_camera.fieldOfView * 0.5f * Mathf.Deg2Rad);
            var horizontalHalfWorld = verticalHalfWorld * aspect;
            var modelHalfNdc = bounds.extents.x / Mathf.Max(0.01f, horizontalHalfWorld);
            var desiredNdc = GetDesiredViewportCenterX(aspect) * 2f - 1f;
            var centerNdc = Mathf.Min(desiredNdc, 0.92f - modelHalfNdc);
            centerNdc = Mathf.Max(0f, centerNdc);
            var horizontalOffset = centerNdc * horizontalHalfWorld;
            var lookTarget = target + Vector3.right * horizontalOffset;
            _camera.transform.position = lookTarget + Vector3.forward * distance;
            _camera.transform.LookAt(lookTarget, Vector3.up);
            _lastScreenSize = new Vector2Int(Screen.width, Screen.height);
        }

        private void OnDestroy()
        {
            if (_floorMaterial != null) Destroy(_floorMaterial);
            if (_floor != null) Destroy(_floor);
        }
    }
}
