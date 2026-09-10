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
        private const float ZoomExponentPerScrollStep = 0.16f;
        private const float ZoomSmoothTimeSeconds = 0.14f;
        private const float CompositionPanSmoothTimeSeconds = 0.08f;
        private const float MinimumCompositionViewportCoordinate = 0.08f;
        private const float MaximumCompositionViewportCoordinate = 0.92f;
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
        private Func<Vector2, bool> _manualInputBlocker;
        private Transform _showcaseAvatar;
        private Vector3 _showcaseBasePosition;
        private Quaternion _showcaseBaseRotation;
        private Vector3 _framingTarget;
        private Vector3 _fixedCameraPosition;
        private Quaternion _fixedCameraRotation;
        private Vector2 _fixedLensShift;
        private Vector2 _compositionOffsetViewport;
        private Vector2 _targetCompositionOffsetViewport;
        private Vector2 _compositionOffsetVelocity;
        private float _showcaseYaw;
        private float _targetShowcaseYaw;
        private float _showcaseYawVelocity;
        private float _inertialYawVelocity;
        private float _filteredDragVelocity;
        private float _showcasePitch;
        private float _targetShowcasePitch;
        private float _showcasePitchVelocity;
        private float _zoomMagnification = 1f;
        private float _targetZoomMagnification = 1f;
        private float _zoomMagnificationVelocity;
        private bool _isDragging;
        private bool _isCompositionPanning;
        private Vector2 _previousPointerPosition;
        private bool _transparent;
        private float _baseVerticalFieldOfViewDegrees;

        public bool CharacterShowcaseControlEnabled { get; private set; }

        public void Configure(bool transparent)
        {
            _transparent = transparent;
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

        internal void SetManualInputBlocker(Func<Vector2, bool> inputBlocker)
        {
            _manualInputBlocker = inputBlocker;
        }

        public void SetCharacterShowcaseControlEnabled(bool enabled)
        {
            CharacterShowcaseControlEnabled = enabled;
            if (!enabled)
            {
                EndShowcaseDrag(preserveInertia: false);
                EndCompositionPan();
                _targetShowcaseYaw = _showcaseYaw;
                _showcaseYawVelocity = 0f;
                _inertialYawVelocity = 0f;
                _targetShowcasePitch = _showcasePitch;
                _showcasePitchVelocity = 0f;
                _targetZoomMagnification = _zoomMagnification;
                _zoomMagnificationVelocity = 0f;
                _targetCompositionOffsetViewport = _compositionOffsetViewport;
                _compositionOffsetVelocity = Vector2.zero;
            }
        }

        public void ResetCharacterShowcaseView()
        {
            if (_hasFramedBounds && _camera != null) ApplyFraming(_framedBounds, resetAvatar: true);
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
                _compositionOffsetViewport,
                _targetCompositionOffsetViewport,
                _compositionOffsetVelocity,
                _showcaseYaw,
                _targetShowcaseYaw,
                _showcaseYawVelocity,
                _inertialYawVelocity,
                _showcasePitch,
                _targetShowcasePitch,
                _showcasePitchVelocity,
                _zoomMagnification,
                _targetZoomMagnification,
                _zoomMagnificationVelocity,
                _camera != null ? _camera.fieldOfView : _baseVerticalFieldOfViewDegrees,
                _floor != null && _floor.activeSelf,
                _floor != null ? _floor.transform.position : Vector3.zero,
                _floor != null ? _floor.transform.localScale : Vector3.one);
        }

        internal void RestoreFraming(AvatarFramingState state)
        {
            EndShowcaseDrag(preserveInertia: false);
            EndCompositionPan();
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
            _compositionOffsetViewport = state.CompositionOffsetViewport;
            _targetCompositionOffsetViewport = state.TargetCompositionOffsetViewport;
            _compositionOffsetVelocity = state.CompositionOffsetVelocity;
            _showcaseYaw = state.ShowcaseYaw;
            _targetShowcaseYaw = state.TargetShowcaseYaw;
            _showcaseYawVelocity = state.ShowcaseYawVelocity;
            _inertialYawVelocity = state.InertialYawVelocity;
            _showcasePitch = state.ShowcasePitch;
            _targetShowcasePitch = state.TargetShowcasePitch;
            _showcasePitchVelocity = state.ShowcasePitchVelocity;
            _zoomMagnification = state.ZoomMagnification;
            _targetZoomMagnification = state.TargetZoomMagnification;
            _zoomMagnificationVelocity = state.ZoomMagnificationVelocity;
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
            EndCompositionPan();
            if (_floor != null) _floor.SetActive(false);
        }

        internal static void ConfigurePhysicalProjection(
            Camera camera,
            float aspect,
            float viewportCenterX = 0.5f)
        {
            if (camera == null) throw new ArgumentNullException(nameof(camera));
            aspect = Mathf.Max(0.1f, aspect);
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
                EndCompositionPan();
                return;
            }

            if (CharacterShowcaseControlEnabled) ReadShowcaseInput();
            AdvanceShowcaseMotion(Time.unscaledDeltaTime);
        }

        private void LateUpdate()
        {
            if (!_hasFramedBounds || _camera == null) return;
            var screenSize = new Vector2Int(Screen.width, Screen.height);
            if (screenSize == _lastScreenSize) return;
            ApplyFixedCompositionAndCameraPose();
            _lastScreenSize = screenSize;
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
            else if (_isCompositionPanning)
            {
                if (!Input.GetMouseButton(2))
                {
                    EndCompositionPan();
                }
                else
                {
                    var delta = mousePosition - _previousPointerPosition;
                    _previousPointerPosition = mousePosition;
                    ApplyCompositionPanDelta(delta, new Vector2(Screen.width, Screen.height));
                }
            }
            else if (Input.GetMouseButtonDown(0))
            {
                BeginShowcaseDrag(mousePosition);
            }
            else if (Input.GetMouseButtonDown(2))
            {
                BeginCompositionPan(mousePosition);
            }

            var scroll = Input.mouseScrollDelta.y;
            if (Mathf.Abs(scroll) > 0.0001f && !IsManualInputBlocked(mousePosition))
            {
                ApplyZoomSteps(scroll);
            }
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
            _zoomMagnification = InitialZoomMagnification;
            _targetZoomMagnification = InitialZoomMagnification;
            _zoomMagnificationVelocity = 0f;
            _compositionOffsetViewport = Vector2.zero;
            _targetCompositionOffsetViewport = Vector2.zero;
            _compositionOffsetVelocity = Vector2.zero;
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
            EndCompositionPan();
            _lastScreenSize = new Vector2Int(Screen.width, Screen.height);
        }

        private void ApplyFixedCompositionAndCameraPose()
        {
            var screenHeight = Mathf.Max(1f, Screen.height);
            var aspect = Mathf.Max(0.1f, Screen.width / screenHeight);
            ConfigurePhysicalProjection(_camera, aspect);
            ApplyShowcaseCameraPose();
            _camera.fieldOfView = GetFieldOfViewForMagnification(
                _baseVerticalFieldOfViewDegrees,
                InitialZoomMagnification);
            var projectedBounds = GetViewportBounds(_camera, _framedBounds);
            var viewportDelta = new Vector2(
                1f - RightViewportMargin - projectedBounds.xMax,
                BottomViewportMargin - projectedBounds.yMin);
            _camera.lensShift = -viewportDelta;
            _fixedLensShift = _camera.lensShift;
            _compositionOffsetViewport = ClampCompositionOffset(_compositionOffsetViewport);
            _targetCompositionOffsetViewport = ClampCompositionOffset(_targetCompositionOffsetViewport);
            ApplyProjection();
        }

        private void ApplyProjection()
        {
            _camera.fieldOfView = GetFieldOfViewForMagnification(
                _baseVerticalFieldOfViewDegrees,
                _zoomMagnification);
            _camera.lensShift = _fixedLensShift - _compositionOffsetViewport;
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

        internal void ApplyZoomSteps(float scrollSteps)
        {
            if (!_hasFramedBounds || _camera == null) return;
            _targetZoomMagnification = Mathf.Clamp(
                _targetZoomMagnification * Mathf.Exp(scrollSteps * ZoomExponentPerScrollStep),
                MinimumZoomMagnification,
                MaximumZoomMagnification);
        }

        internal void ApplyCompositionPanDelta(Vector2 pointerDelta, Vector2 viewportSize)
        {
            if (!_hasFramedBounds || _camera == null) return;
            var safeViewportSize = new Vector2(
                Mathf.Max(1f, viewportSize.x),
                Mathf.Max(1f, viewportSize.y));
            var viewportDelta = new Vector2(
                pointerDelta.x / safeViewportSize.x,
                pointerDelta.y / safeViewportSize.y);
            _targetCompositionOffsetViewport = ClampCompositionOffset(
                _targetCompositionOffsetViewport + viewportDelta);
        }

        private Vector2 ClampCompositionOffset(Vector2 offset)
        {
            var baseViewportCenter = new Vector2(
                0.5f - _fixedLensShift.x,
                0.5f - _fixedLensShift.y);
            var desiredViewportCenter = baseViewportCenter + offset;
            var clampedViewportCenter = new Vector2(
                Mathf.Clamp(
                    desiredViewportCenter.x,
                    MinimumCompositionViewportCoordinate,
                    MaximumCompositionViewportCoordinate),
                Mathf.Clamp(
                    desiredViewportCenter.y,
                    MinimumCompositionViewportCoordinate,
                    MaximumCompositionViewportCoordinate));
            return clampedViewportCenter - baseViewportCenter;
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
            _zoomMagnification = Mathf.SmoothDamp(
                _zoomMagnification,
                _targetZoomMagnification,
                ref _zoomMagnificationVelocity,
                ZoomSmoothTimeSeconds,
                Mathf.Infinity,
                deltaTime);
            _compositionOffsetViewport = Vector2.SmoothDamp(
                _compositionOffsetViewport,
                _targetCompositionOffsetViewport,
                ref _compositionOffsetVelocity,
                CompositionPanSmoothTimeSeconds,
                Mathf.Infinity,
                deltaTime);
            ApplyShowcaseRotation();
            ApplyShowcaseCameraPose();
            ApplyProjection();
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
            if (IsManualInputBlocked(mousePosition)) return;
            _isDragging = true;
            _previousPointerPosition = mousePosition;
            _filteredDragVelocity = 0f;
            _inertialYawVelocity = 0f;
        }

        private bool IsManualInputBlocked(Vector2 mousePosition)
        {
            return _manualInputBlocker?.Invoke(mousePosition) ?? false;
        }

        private void BeginCompositionPan(Vector2 mousePosition)
        {
            if (IsManualInputBlocked(mousePosition)) return;
            _isCompositionPanning = true;
            _previousPointerPosition = mousePosition;
            _compositionOffsetVelocity = Vector2.zero;
        }

        private void EndCompositionPan()
        {
            _isCompositionPanning = false;
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
                Vector2 compositionOffsetViewport,
                Vector2 targetCompositionOffsetViewport,
                Vector2 compositionOffsetVelocity,
                float showcaseYaw,
                float targetShowcaseYaw,
                float showcaseYawVelocity,
                float inertialYawVelocity,
                float showcasePitch,
                float targetShowcasePitch,
                float showcasePitchVelocity,
                float zoomMagnification,
                float targetZoomMagnification,
                float zoomMagnificationVelocity,
                float cameraFieldOfView,
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
                CompositionOffsetViewport = compositionOffsetViewport;
                TargetCompositionOffsetViewport = targetCompositionOffsetViewport;
                CompositionOffsetVelocity = compositionOffsetVelocity;
                ShowcaseYaw = showcaseYaw;
                TargetShowcaseYaw = targetShowcaseYaw;
                ShowcaseYawVelocity = showcaseYawVelocity;
                InertialYawVelocity = inertialYawVelocity;
                ShowcasePitch = showcasePitch;
                TargetShowcasePitch = targetShowcasePitch;
                ShowcasePitchVelocity = showcasePitchVelocity;
                ZoomMagnification = zoomMagnification;
                TargetZoomMagnification = targetZoomMagnification;
                ZoomMagnificationVelocity = zoomMagnificationVelocity;
                CameraFieldOfView = cameraFieldOfView;
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
            public Vector2 CompositionOffsetViewport { get; }
            public Vector2 TargetCompositionOffsetViewport { get; }
            public Vector2 CompositionOffsetVelocity { get; }
            public float ShowcaseYaw { get; }
            public float TargetShowcaseYaw { get; }
            public float ShowcaseYawVelocity { get; }
            public float InertialYawVelocity { get; }
            public float ShowcasePitch { get; }
            public float TargetShowcasePitch { get; }
            public float ShowcasePitchVelocity { get; }
            public float ZoomMagnification { get; }
            public float TargetZoomMagnification { get; }
            public float ZoomMagnificationVelocity { get; }
            public float CameraFieldOfView { get; }
            public bool FloorActive { get; }
            public Vector3 FloorPosition { get; }
            public Vector3 FloorScale { get; }
        }
    }
}
