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

        public AvatarLightingMode LightingMode => _lightingRig != null
            ? _lightingRig.Mode
            : AvatarLightingMode.LightDesktop;
        internal AvatarActivityState LightingActivity => _lightingRig != null
            ? _lightingRig.Activity
            : AvatarActivityState.Idle;

        public void Configure(bool transparent, AvatarLightingMode lightingMode = AvatarLightingMode.LightDesktop)
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
                : new Color(0.91f, 0.915f, 0.96f, 1f);
            _camera.fieldOfView = 30f;
            _camera.allowHDR = false;
            _camera.allowMSAA = true;
            _camera.nearClipPlane = 0.01f;
            _camera.farClipPlane = 100f;

            _lightingRig = gameObject.AddComponent<AvatarLightingRig>();
            _lightingRig.Configure();
            _lightingRig.SetMode(lightingMode);
            EnsureOpaqueFloor();
            ApplyOpaqueBackdrop(lightingMode);
        }

        public void SetActivityLighting(AvatarActivityState activity)
        {
            _lightingRig?.SetActivity(activity);
        }

        public void SetLightingMode(AvatarLightingMode mode)
        {
            _lightingRig?.SetMode(mode);
            ApplyOpaqueBackdrop(mode);
        }

        public Bounds Frame(GameObject avatar)
        {
            if (avatar == null) throw new ArgumentNullException(nameof(avatar));

            var renderers = avatar.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0) throw new InvalidOperationException("The avatar contains no renderers.");
            var bounds = renderers[0].bounds;
            for (var index = 1; index < renderers.Length; index += 1) bounds.Encapsulate(renderers[index].bounds);

            ActivateFraming(bounds);
            return bounds;
        }

        internal AvatarFramingState CaptureFraming()
        {
            return new AvatarFramingState(
                _hasFramedBounds,
                _framedBounds,
                _camera != null ? _camera.transform.position : Vector3.zero,
                _camera != null ? _camera.transform.rotation : Quaternion.identity,
                _floor != null && _floor.activeSelf,
                _floor != null ? _floor.transform.position : Vector3.zero,
                _floor != null ? _floor.transform.localScale : Vector3.one);
        }

        internal void RestoreFraming(AvatarFramingState state)
        {
            _hasFramedBounds = state.HasBounds;
            _framedBounds = state.Bounds;
            if (_camera != null)
            {
                _camera.transform.SetPositionAndRotation(state.CameraPosition, state.CameraRotation);
            }
            if (_floor != null)
            {
                _floor.SetActive(state.FloorActive);
                _floor.transform.position = state.FloorPosition;
                _floor.transform.localScale = state.FloorScale;
            }
            _lastScreenSize = new Vector2Int(Screen.width, Screen.height);
        }

        internal void ActivateFraming(Bounds bounds)
        {
            _framedBounds = bounds;
            _hasFramedBounds = true;
            ApplyFraming(bounds);
            if (_floor != null)
            {
                _floor.SetActive(true);
                _floor.transform.position = new Vector3(bounds.center.x, bounds.min.y - 0.006f, bounds.center.z);
                _floor.transform.localScale = Vector3.one * Mathf.Max(0.8f, bounds.size.y * 0.7f);
            }
        }

        internal void ClearFraming()
        {
            _hasFramedBounds = false;
            if (_floor != null) _floor.SetActive(false);
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

        private void ApplyOpaqueBackdrop(AvatarLightingMode mode)
        {
            if (_transparent) return;
            if (_camera != null) _camera.backgroundColor = GetBackgroundColor(mode);
            if (_floorMaterial != null) _floorMaterial.color = GetFloorColor(mode);
        }

        private void EnsureOpaqueFloor()
        {
            if (_transparent || _floor != null) return;
            _floor = GameObject.CreatePrimitive(PrimitiveType.Plane);
            _floor.name = "Avatar Floor";
            var collider = _floor.GetComponent<Collider>();
            if (collider != null) Destroy(collider);
            var shader = Shader.Find("Universal Render Pipeline/Lit")
                ?? throw new InvalidOperationException("URP Lit shader was not found.");
            _floorMaterial = new Material(shader) { color = GetFloorColor(LightingMode) };
            _floor.GetComponent<Renderer>().sharedMaterial = _floorMaterial;
            _floor.SetActive(false);
        }

        private static Color GetBackgroundColor(AvatarLightingMode mode)
        {
            return mode == AvatarLightingMode.DarkDesktop
                ? new Color(0.018f, 0.022f, 0.032f, 1f)
                : new Color(0.91f, 0.915f, 0.96f, 1f);
        }

        private static Color GetFloorColor(AvatarLightingMode mode)
        {
            return mode == AvatarLightingMode.DarkDesktop
                ? new Color(0.19f, 0.18f, 0.22f)
                : new Color(0.78f, 0.79f, 0.86f);
        }

        private void OnDestroy()
        {
            if (_floorMaterial != null) Destroy(_floorMaterial);
            if (_floor != null) Destroy(_floor);
        }

        internal readonly struct AvatarFramingState
        {
            public AvatarFramingState(
                bool hasBounds,
                Bounds bounds,
                Vector3 cameraPosition,
                Quaternion cameraRotation,
                bool floorActive,
                Vector3 floorPosition,
                Vector3 floorScale)
            {
                HasBounds = hasBounds;
                Bounds = bounds;
                CameraPosition = cameraPosition;
                CameraRotation = cameraRotation;
                FloorActive = floorActive;
                FloorPosition = floorPosition;
                FloorScale = floorScale;
            }

            public bool HasBounds { get; }
            public Bounds Bounds { get; }
            public Vector3 CameraPosition { get; }
            public Quaternion CameraRotation { get; }
            public bool FloorActive { get; }
            public Vector3 FloorPosition { get; }
            public Vector3 FloorScale { get; }
        }
    }
}
