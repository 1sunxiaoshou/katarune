using System;
using System.IO;
using UnityEngine;

namespace Katarune.Avatar
{
    [DisallowMultipleComponent]
    [RequireComponent(typeof(Camera))]
    public sealed class AvatarSceneRig : MonoBehaviour
    {
        private const float PhysicalSensorHeightMillimeters = 24f;
        private const float RotationDegreesPerPixel = 0.32f;
        private const float RotationSmoothTimeSeconds = 0.055f;
        private const float MaximumRotationSpeedDegreesPerSecond = 900f;
        private const float DragVelocityResponse = 20f;
        private const float InertiaReleaseVelocityScale = 0.22f;
        private const float MaximumInertiaSpeedDegreesPerSecond = 140f;
        private const float InertiaDamping = 5f;
        private const float InertiaStopSpeedDegreesPerSecond = 0.05f;
        private const float VerticalRotationDegreesPerPixel = 0.16f;
        private const float VerticalRotationSmoothTimeSeconds = 0.08f;
        private const float MinimumShowcasePitchDegrees = -45f;
        private const float MaximumShowcasePitchDegrees = 45f;
        private const float MinimumZoomMagnification = 1f / 3f;
        private const float MaximumZoomMagnification = 1f / 0.35f;

        [Header("初始构图")]
        [SerializeField, Range(MinimumZoomMagnification, 1f)]
        private float initialZoomMagnification = 0.6f;
        [SerializeField, Range(0f, 0.25f)] private float rightViewportMargin = 0.08f;
        [SerializeField, Range(0f, 0.25f)] private float bottomViewportMargin = 0.08f;
        [SerializeField, Min(1f)] private float framingDistancePadding = 1.1f;

        private Camera _camera;
        private GameObject _floor;
        private Material _floorMaterial;
        private Bounds _framedBounds;
        private bool _hasFramedBounds;
        private Vector2Int _lastScreenSize;
        private Transform _showcaseAvatar;
        private Vector3 _showcaseBasePosition;
        private Quaternion _showcaseBaseRotation;
        private Vector3 _framingTarget;
        private Vector3 _fixedCameraPosition;
        private Quaternion _fixedCameraRotation;
        private Vector2 _fixedLensShift;
        private float _showcaseYaw;
        private float _targetShowcaseYaw;
        private float _showcaseYawVelocity;
        private float _inertialYawVelocity;
        private float _filteredDragVelocity;
        private float _showcasePitch;
        private float _targetShowcasePitch;
        private float _showcasePitchVelocity;
        private bool _isDragging;
        private Vector2 _previousPointerPosition;
        private bool _transparent;
        private float _baseVerticalFieldOfViewDegrees;
        private Vector2 _desktopCenter = new Vector2(0.78f, 0.5f);
        private float _desktopHeight = 0.65f;

        private AvatarWindow _desktopWindow;
        public Vector2 ReferenceWindowSize { get; private set; } = new Vector2(0.3f, 0.8f);
        internal float DesktopYaw => _targetShowcaseYaw;
        internal float DesktopPitch => _targetShowcasePitch;
        internal Vector2 DesktopCenter => _desktopCenter;
        internal float DesktopHeight => _desktopHeight;
        internal void SetDesktopPlacement(float x, float y, float height)
        {
            _desktopCenter = new Vector2(Mathf.Clamp01(x), Mathf.Clamp01(y));
            if (float.IsNaN(height) || float.IsInfinity(height)) return;
            _desktopHeight = Mathf.Max(0.05f, height);
            if (_hasFramedBounds && _camera != null) ApplyDesktopProjection();
        }
        internal void MoveDesktopByPixels(float deltaX, float deltaY)
        {
            SetDesktopPlacement(_desktopCenter.x + deltaX / Mathf.Max(1, Screen.width),
                _desktopCenter.y - deltaY / Mathf.Max(1, Screen.height), _desktopHeight);
        }
        internal void ZoomDesktop(float scroll)
        {
            SetDesktopPlacement(_desktopCenter.x, _desktopCenter.y,
                _desktopHeight * Mathf.Pow(1.08f, scroll));
        }
        internal Rect DesktopControlBounds
        {
            get
            {
                if (!_hasFramedBounds || _camera == null) return Rect.zero;
                var bounds = GetViewportBounds(_camera, _framedBounds);
                return Rect.MinMaxRect(Mathf.Clamp01(bounds.xMin - 0.035f),
                    Mathf.Clamp01(bounds.yMin - 0.035f), Mathf.Clamp01(bounds.xMax + 0.035f),
                    Mathf.Clamp01(bounds.yMax + 0.035f));
            }
        }
        internal void SetDesktopPose(float yaw, float pitch)
        {
            EndShowcaseDrag(preserveInertia: false);
            _showcaseYaw = _targetShowcaseYaw = yaw;
            _showcasePitch = _targetShowcasePitch = Mathf.Clamp(pitch, -45f, 45f);
            _showcaseYawVelocity = _showcasePitchVelocity = _inertialYawVelocity = 0;
            ApplyShowcaseRotation();
        }

        public bool CharacterShowcaseControlEnabled { get; private set; }

        public void Configure(bool transparent)
        {
            _transparent = transparent;
            if (transparent && !Application.isEditor) _desktopWindow = FindFirstObjectByType<AvatarWindow>();
            _camera = GetComponent<Camera>();
            if (_camera == null)
            {
                throw new InvalidOperationException("AvatarSceneRig must be attached to the avatar camera.");
            }

            _baseVerticalFieldOfViewDegrees = Mathf.Clamp(_camera.fieldOfView, 1f, 179f);
            _camera.clearFlags = CameraClearFlags.SolidColor;
            _camera.backgroundColor = transparent
                ? new Color(0f, 0f, 0f, 0f)
                : new Color(0.91f, 0.915f, 0.96f, 1f);
            ConfigurePhysicalProjection(
                _camera,
                Mathf.Max(0.1f, Screen.width / Mathf.Max(1f, Screen.height)));
            _camera.fieldOfView = _baseVerticalFieldOfViewDegrees;
            _camera.allowHDR = false;
            _camera.allowMSAA = true;
            _camera.nearClipPlane = 0.01f;
            _camera.farClipPlane = 100f;

            EnsureOpaqueFloor();
            ApplyOpaqueBackdrop();
        }

        public void SetCharacterShowcaseControlEnabled(bool enabled)
        {
            CharacterShowcaseControlEnabled = enabled;
            if (!enabled)
            {
                EndShowcaseDrag(preserveInertia: false);
                _targetShowcaseYaw = _showcaseYaw;
                _showcaseYawVelocity = 0f;
                _inertialYawVelocity = 0f;
                _targetShowcasePitch = _showcasePitch;
                _showcasePitchVelocity = 0f;
            }
        }

        public Bounds Frame(GameObject avatar)
        {
            if (avatar == null) throw new ArgumentNullException(nameof(avatar));

            var renderers = avatar.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0) throw new InvalidOperationException("The avatar contains no renderers.");
            var bounds = renderers[0].bounds;
            for (var index = 1; index < renderers.Length; index += 1) bounds.Encapsulate(renderers[index].bounds);

            ActivateFraming(avatar.transform, bounds);
            return bounds;
        }

        internal AvatarFramingState CaptureFraming()
        {
            return new AvatarFramingState(
                _hasFramedBounds,
                _framedBounds,
                _camera != null ? _camera.transform.position : Vector3.zero,
                _camera != null ? _camera.transform.rotation : Quaternion.identity,
                _camera != null ? _camera.lensShift : Vector2.zero,
                CharacterShowcaseControlEnabled,
                _showcaseAvatar,
                _showcaseAvatar != null ? _showcaseAvatar.position : Vector3.zero,
                _showcaseAvatar != null ? _showcaseAvatar.rotation : Quaternion.identity,
                _showcaseBasePosition,
                _showcaseBaseRotation,
                _framingTarget,
                _fixedCameraPosition,
                _fixedCameraRotation,
                _fixedLensShift,
                _showcaseYaw,
                _targetShowcaseYaw,
                _showcaseYawVelocity,
                _inertialYawVelocity,
                _showcasePitch,
                _targetShowcasePitch,
                _showcasePitchVelocity,
                _camera != null ? _camera.fieldOfView : _baseVerticalFieldOfViewDegrees,
                ReferenceWindowSize,
                _floor != null && _floor.activeSelf,
                _floor != null ? _floor.transform.position : Vector3.zero,
                _floor != null ? _floor.transform.localScale : Vector3.one);
        }

        internal void RestoreFraming(AvatarFramingState state)
        {
            EndShowcaseDrag(preserveInertia: false);
            ReferenceWindowSize = state.ReferenceWindowSize;
            _hasFramedBounds = state.HasBounds;
            _framedBounds = state.Bounds;
            CharacterShowcaseControlEnabled = state.CharacterShowcaseControlEnabled;
            _showcaseAvatar = state.ShowcaseAvatar;
            _showcaseBasePosition = state.ShowcaseBasePosition;
            _showcaseBaseRotation = state.ShowcaseBaseRotation;
            _framingTarget = state.FramingTarget;
            _fixedCameraPosition = state.FixedCameraPosition;
            _fixedCameraRotation = state.FixedCameraRotation;
            _fixedLensShift = state.FixedLensShift;
            _showcaseYaw = state.ShowcaseYaw;
            _targetShowcaseYaw = state.TargetShowcaseYaw;
            _showcaseYawVelocity = state.ShowcaseYawVelocity;
            _inertialYawVelocity = state.InertialYawVelocity;
            _showcasePitch = state.ShowcasePitch;
            _targetShowcasePitch = state.TargetShowcasePitch;
            _showcasePitchVelocity = state.ShowcasePitchVelocity;
            if (_showcaseAvatar != null)
            {
                _showcaseAvatar.SetPositionAndRotation(state.ShowcasePosition, state.ShowcaseRotation);
            }
            if (_camera != null)
            {
                _camera.transform.SetPositionAndRotation(state.CameraPosition, state.CameraRotation);
                _camera.lensShift = state.CameraLensShift;
                _camera.fieldOfView = state.CameraFieldOfView;
            }
            if (_floor != null)
            {
                _floor.SetActive(state.FloorActive);
                _floor.transform.position = state.FloorPosition;
                _floor.transform.localScale = state.FloorScale;
            }
            _lastScreenSize = new Vector2Int(Screen.width, Screen.height);
        }

        internal void ActivateFraming(Transform avatar, Bounds bounds)
        {
            if (avatar == null) throw new ArgumentNullException(nameof(avatar));
            var worldOffsetToOrigin = -avatar.position;
            bounds.center += worldOffsetToOrigin;
            _showcaseAvatar = avatar;
            _showcaseBasePosition = Vector3.zero;
            _showcaseBaseRotation = avatar.rotation;
            avatar.SetPositionAndRotation(_showcaseBasePosition, _showcaseBaseRotation);
            _framedBounds = bounds;
            _hasFramedBounds = true;
            ApplyFraming(bounds, resetAvatar: true);
            if (_floor != null)
            {
                _floor.SetActive(true);
                _floor.transform.position = new Vector3(0f, bounds.min.y - 0.006f, 0f);
                _floor.transform.localScale = Vector3.one * Mathf.Max(0.8f, bounds.size.y * 0.7f);
            }
        }

        internal void ClearFraming()
        {
            _hasFramedBounds = false;
            _showcaseAvatar = null;
            EndShowcaseDrag(preserveInertia: false);
            if (_floor != null) _floor.SetActive(false);
        }

        internal static void ConfigurePhysicalProjection(
            Camera camera,
            float aspect,
            float viewportCenterX = 0.5f)
        {
            if (camera == null) throw new ArgumentNullException(nameof(camera));
            aspect = Mathf.Max(0.1f, aspect);
            camera.aspect = aspect;
            camera.usePhysicalProperties = true;
            camera.gateFit = Camera.GateFitMode.None;
            camera.sensorSize = new Vector2(PhysicalSensorHeightMillimeters * aspect, PhysicalSensorHeightMillimeters);
            camera.lensShift = new Vector2(0.5f - Mathf.Clamp01(viewportCenterX), 0f);
        }

        public void Capture(string path)
        {
            var fullPath = Path.GetFullPath(path);
            var directory = Path.GetDirectoryName(fullPath);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            ScreenCapture.CaptureScreenshot(fullPath);
        }

        private void Update()
        {
            if (!_hasFramedBounds || _camera == null || _showcaseAvatar == null)
            {
                EndShowcaseDrag(preserveInertia: false);
                return;
            }

            if (CharacterShowcaseControlEnabled) ReadShowcaseInput();
            AdvanceShowcaseMotion(Time.unscaledDeltaTime);
        }

        private void LateUpdate()
        {
            if (!_hasFramedBounds || _camera == null) return;
            var screenSize = new Vector2Int(Screen.width, Screen.height);
            if (screenSize != _lastScreenSize)
            {
                if (_desktopWindow != null) ApplyDesktopProjection();
                else ApplyFixedCompositionAndCameraPose();
                _lastScreenSize = screenSize;
            }
        }

        private void ReadShowcaseInput()
        {
            var mousePosition = new Vector2(Input.mousePosition.x, Input.mousePosition.y);
            if (_isDragging)
            {
                if (!Input.GetMouseButton(0))
                {
                    EndShowcaseDrag(preserveInertia: true);
                }
                else
                {
                    var delta = mousePosition - _previousPointerPosition;
                    _previousPointerPosition = mousePosition;
                    ApplyRotationDelta(-delta.x * RotationDegreesPerPixel, Time.unscaledDeltaTime);
                    ApplyPitchDelta(GetPitchDeltaFromPointerDelta(delta.y));
                }
            }
            else if (Input.GetMouseButtonDown(0)) BeginShowcaseDrag(mousePosition);
        }

        private void ApplyFraming(Bounds bounds, bool resetAvatar)
        {
            _framingTarget = new Vector3(0f, bounds.center.y + bounds.size.y * 0.015f, 0f);
            var halfHeight = Mathf.Max(bounds.extents.y, 0.5f);
            var distance = halfHeight /
                Mathf.Tan(_baseVerticalFieldOfViewDegrees * 0.5f * Mathf.Deg2Rad) *
                Mathf.Max(1f, framingDistancePadding);
            _fixedCameraPosition = _framingTarget + Vector3.forward * distance;
            _fixedCameraRotation = Quaternion.LookRotation(
                _framingTarget - _fixedCameraPosition,
                Vector3.up);
            if (resetAvatar)
            {
                _showcaseYaw = 0f;
                _targetShowcaseYaw = 0f;
                _showcaseYawVelocity = 0f;
                _inertialYawVelocity = 0f;
                _filteredDragVelocity = 0f;
                _showcasePitch = 0f;
                _targetShowcasePitch = 0f;
                _showcasePitchVelocity = 0f;
                ApplyShowcaseRotation();
            }
            ApplyFixedCompositionAndCameraPose();
            EndShowcaseDrag(preserveInertia: false);
            _lastScreenSize = new Vector2Int(Screen.width, Screen.height);
        }

        private void ApplyFixedCompositionAndCameraPose()
        {
            if (_desktopWindow != null)
            {
                ApplyDesktopProjection();
                ApplyShowcaseCameraPose();
                return;
            }
            var screenHeight = Mathf.Max(1f, Screen.height);
            var aspect = Mathf.Max(0.1f, Screen.width / screenHeight);
            ConfigurePhysicalProjection(_camera, aspect);
            ApplyShowcaseCameraPose();
            _camera.fieldOfView = GetFieldOfViewForMagnification(
                _baseVerticalFieldOfViewDegrees,
                InitialZoomMagnification);
            var projectedBounds = GetViewportBounds(_camera, _framedBounds);
            var viewportDelta = new Vector2(1f - RightViewportMargin - projectedBounds.xMax, BottomViewportMargin - projectedBounds.yMin);
            _camera.lensShift = -viewportDelta;
            _fixedLensShift = _camera.lensShift;
        }

        private void ApplyDesktopProjection()
        {
            // The HWND covers one display. Only the camera composition changes during pan/zoom.
            ConfigurePhysicalProjection(_camera, Screen.width / Mathf.Max(1f, Screen.height));
            _camera.fieldOfView = _baseVerticalFieldOfViewDegrees;
            ApplyShowcaseCameraPose();
            var baseBounds = GetViewportBounds(_camera, _framedBounds);
            // Stop only at the camera's valid 1-degree FOV, not at a full-body
            // or screen-width fit. This also keeps a reverse scroll responsive.
            var minimumFovMagnification = Mathf.Tan(_baseVerticalFieldOfViewDegrees * .5f * Mathf.Deg2Rad)
                / Mathf.Tan(.5f * Mathf.Deg2Rad);
            _desktopHeight = Mathf.Min(_desktopHeight,
                Mathf.Max(0.05f, baseBounds.height * minimumFovMagnification));
            var magnification = _desktopHeight / Mathf.Max(0.01f, baseBounds.height);
            _camera.fieldOfView = Mathf.Max(1f,
                GetFieldOfViewForMagnification(_baseVerticalFieldOfViewDegrees, magnification));
            var projected = GetViewportBounds(_camera, _framedBounds);
            _camera.lensShift = -(new Vector2(_desktopCenter.x - projected.center.x,
                _desktopCenter.y - projected.center.y));
            _fixedLensShift = _camera.lensShift;
        }

        internal static float GetFieldOfViewForMagnification(float baseFieldOfViewDegrees, float magnification)
        {
            var baseHalfAngle = Mathf.Clamp(baseFieldOfViewDegrees, 1f, 179f) * 0.5f * Mathf.Deg2Rad;
            var safeMagnification = Mathf.Max(0.0001f, magnification);
            return Mathf.Atan(Mathf.Tan(baseHalfAngle) / safeMagnification) * 2f * Mathf.Rad2Deg;
        }

        internal static Rect GetViewportBounds(Camera camera, Bounds bounds)
        {
            if (camera == null) throw new ArgumentNullException(nameof(camera));
            var minimum = new Vector2(float.PositiveInfinity, float.PositiveInfinity);
            var maximum = new Vector2(float.NegativeInfinity, float.NegativeInfinity);
            for (var x = -1; x <= 1; x += 2)
            for (var y = -1; y <= 1; y += 2)
            for (var z = -1; z <= 1; z += 2)
            {
                var world = bounds.center + Vector3.Scale(
                    bounds.extents,
                    new Vector3(x, y, z));
                var viewport = camera.WorldToViewportPoint(world);
                minimum = Vector2.Min(minimum, viewport);
                maximum = Vector2.Max(maximum, viewport);
            }
            return Rect.MinMaxRect(minimum.x, minimum.y, maximum.x, maximum.y);
        }

        private float InitialZoomMagnification => Mathf.Clamp(
            initialZoomMagnification,
            MinimumZoomMagnification,
            MaximumZoomMagnification);

        private float RightViewportMargin => Mathf.Clamp01(rightViewportMargin);
        private float BottomViewportMargin => Mathf.Clamp01(bottomViewportMargin);

        internal void BeginShowcaseDragForTests()
        {
            if (!_hasFramedBounds || _showcaseAvatar == null) return;
            _isDragging = true;
            _filteredDragVelocity = 0f;
            _inertialYawVelocity = 0f;
        }

        internal void ApplyRotationDelta(float yawDegrees, float deltaTime)
        {
            if (!_hasFramedBounds || _showcaseAvatar == null) return;
            deltaTime = Mathf.Max(0.0001f, deltaTime);
            _targetShowcaseYaw += yawDegrees;
            var instantaneousVelocity = Mathf.Clamp(
                yawDegrees / deltaTime,
                -MaximumRotationSpeedDegreesPerSecond,
                MaximumRotationSpeedDegreesPerSecond);
            var response = 1f - Mathf.Exp(-DragVelocityResponse * deltaTime);
            _filteredDragVelocity = Mathf.Lerp(_filteredDragVelocity, instantaneousVelocity, response);
        }

        internal void ReleaseShowcaseDragForTests()
        {
            EndShowcaseDrag(preserveInertia: true);
        }

        internal void ApplyPitchDelta(float pitchDegrees)
        {
            if (!_hasFramedBounds || _camera == null) return;
            _targetShowcasePitch = Mathf.Clamp(
                _targetShowcasePitch + pitchDegrees,
                MinimumShowcasePitchDegrees,
                MaximumShowcasePitchDegrees);
        }

        internal static float GetPitchDeltaFromPointerDelta(float pointerDeltaY)
        {
            return -pointerDeltaY * VerticalRotationDegreesPerPixel;
        }

        internal void AdvanceShowcaseMotion(float deltaTime)
        {
            if (!_hasFramedBounds || _camera == null || _showcaseAvatar == null || deltaTime <= 0f) return;

            if (!_isDragging && Mathf.Abs(_inertialYawVelocity) > 0f)
            {
                var decay = Mathf.Exp(-InertiaDamping * deltaTime);
                _targetShowcaseYaw +=
                    _inertialYawVelocity * (1f - decay) / InertiaDamping;
                _inertialYawVelocity *= decay;
                if (Mathf.Abs(_inertialYawVelocity) < InertiaStopSpeedDegreesPerSecond)
                {
                    _inertialYawVelocity = 0f;
                }
            }

            _showcaseYaw = Mathf.SmoothDamp(
                _showcaseYaw,
                _targetShowcaseYaw,
                ref _showcaseYawVelocity,
                RotationSmoothTimeSeconds,
                MaximumRotationSpeedDegreesPerSecond,
                deltaTime);
            _showcasePitch = Mathf.SmoothDamp(
                _showcasePitch,
                _targetShowcasePitch,
                ref _showcasePitchVelocity,
                VerticalRotationSmoothTimeSeconds,
                Mathf.Infinity,
                deltaTime);
            ApplyShowcaseRotation();
            ApplyShowcaseCameraPose();
        }

        private void ApplyShowcaseRotation()
        {
            if (_showcaseAvatar == null) return;
            var rotation = Quaternion.AngleAxis(_showcaseYaw, Vector3.up);
            _showcaseAvatar.SetPositionAndRotation(
                _showcaseBasePosition,
                rotation * _showcaseBaseRotation);
        }

        private void ApplyShowcaseCameraPose()
        {
            if (_camera == null) return;
            var baseOffset = _fixedCameraPosition - _framingTarget;
            var pitchedOffset = Quaternion.AngleAxis(-_showcasePitch, Vector3.right) * baseOffset;
            var cameraPosition = _framingTarget + pitchedOffset;
            var cameraRotation = Quaternion.LookRotation(
                _framingTarget - cameraPosition,
                Vector3.up);
            _camera.transform.SetPositionAndRotation(cameraPosition, cameraRotation);
        }

        private void BeginShowcaseDrag(Vector2 mousePosition)
        {
            _isDragging = true;
            _previousPointerPosition = mousePosition;
            _filteredDragVelocity = 0f;
            _inertialYawVelocity = 0f;
        }

        private void EndShowcaseDrag(bool preserveInertia)
        {
            if (preserveInertia && _isDragging)
            {
                _inertialYawVelocity = Mathf.Clamp(
                    _filteredDragVelocity * InertiaReleaseVelocityScale,
                    -MaximumInertiaSpeedDegreesPerSecond,
                    MaximumInertiaSpeedDegreesPerSecond);
            }
            else if (!preserveInertia)
            {
                _inertialYawVelocity = 0f;
            }
            _isDragging = false;
            _filteredDragVelocity = 0f;
        }

        private void ApplyOpaqueBackdrop()
        {
            if (_transparent) return;
            if (_camera != null) _camera.backgroundColor = GetBackgroundColor();
            if (_floorMaterial != null) _floorMaterial.color = GetFloorColor();
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
            _floorMaterial = new Material(shader) { color = GetFloorColor() };
            _floor.GetComponent<Renderer>().sharedMaterial = _floorMaterial;
            _floor.SetActive(false);
        }

        private static Color GetBackgroundColor() => new Color(0.91f, 0.915f, 0.96f, 1f);

        private static Color GetFloorColor() => new Color(0.78f, 0.79f, 0.86f);

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
                Vector2 cameraLensShift,
                bool characterShowcaseControlEnabled,
                Transform showcaseAvatar,
                Vector3 showcasePosition,
                Quaternion showcaseRotation,
                Vector3 showcaseBasePosition,
                Quaternion showcaseBaseRotation,
                Vector3 framingTarget,
                Vector3 fixedCameraPosition,
                Quaternion fixedCameraRotation,
                Vector2 fixedLensShift,
                float showcaseYaw,
                float targetShowcaseYaw,
                float showcaseYawVelocity,
                float inertialYawVelocity,
                float showcasePitch,
                float targetShowcasePitch,
                float showcasePitchVelocity,
                float cameraFieldOfView,
                Vector2 referenceWindowSize,
                bool floorActive,
                Vector3 floorPosition,
                Vector3 floorScale)
            {
                HasBounds = hasBounds;
                Bounds = bounds;
                CameraPosition = cameraPosition;
                CameraRotation = cameraRotation;
                CameraLensShift = cameraLensShift;
                CharacterShowcaseControlEnabled = characterShowcaseControlEnabled;
                ShowcaseAvatar = showcaseAvatar;
                ShowcasePosition = showcasePosition;
                ShowcaseRotation = showcaseRotation;
                ShowcaseBasePosition = showcaseBasePosition;
                ShowcaseBaseRotation = showcaseBaseRotation;
                FramingTarget = framingTarget;
                FixedCameraPosition = fixedCameraPosition;
                FixedCameraRotation = fixedCameraRotation;
                FixedLensShift = fixedLensShift;
                ShowcaseYaw = showcaseYaw;
                TargetShowcaseYaw = targetShowcaseYaw;
                ShowcaseYawVelocity = showcaseYawVelocity;
                InertialYawVelocity = inertialYawVelocity;
                ShowcasePitch = showcasePitch;
                TargetShowcasePitch = targetShowcasePitch;
                ShowcasePitchVelocity = showcasePitchVelocity;
                CameraFieldOfView = cameraFieldOfView;
                ReferenceWindowSize = referenceWindowSize;
                FloorActive = floorActive;
                FloorPosition = floorPosition;
                FloorScale = floorScale;
            }

            public bool HasBounds { get; }
            public Bounds Bounds { get; }
            public Vector3 CameraPosition { get; }
            public Quaternion CameraRotation { get; }
            public Vector2 CameraLensShift { get; }
            public bool CharacterShowcaseControlEnabled { get; }
            public Transform ShowcaseAvatar { get; }
            public Vector3 ShowcasePosition { get; }
            public Quaternion ShowcaseRotation { get; }
            public Vector3 ShowcaseBasePosition { get; }
            public Quaternion ShowcaseBaseRotation { get; }
            public Vector3 FramingTarget { get; }
            public Vector3 FixedCameraPosition { get; }
            public Quaternion FixedCameraRotation { get; }
            public Vector2 FixedLensShift { get; }
            public float ShowcaseYaw { get; }
            public float TargetShowcaseYaw { get; }
            public float ShowcaseYawVelocity { get; }
            public float InertialYawVelocity { get; }
            public float ShowcasePitch { get; }
            public float TargetShowcasePitch { get; }
            public float ShowcasePitchVelocity { get; }
            public float CameraFieldOfView { get; }
            public Vector2 ReferenceWindowSize { get; }
            public bool FloorActive { get; }
            public Vector3 FloorPosition { get; }
            public Vector3 FloorScale { get; }
        }
    }
}
