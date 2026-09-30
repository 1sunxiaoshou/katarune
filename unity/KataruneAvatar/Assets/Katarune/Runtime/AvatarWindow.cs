using System;
using System.Runtime.InteropServices;
using Kirurobo;
using UnityEngine;

namespace Katarune.Avatar
{
    [RequireComponent(typeof(UniWindowController))]
    public sealed class AvatarWindow : MonoBehaviour
    {
        [Serializable] public class Rectangle { public int x, y, width, height; }
        [Serializable] private class Layout { public string requestId; public Rectangle rect; public float yaw, pitch, x, y, height; public bool adjusting, applyGeometry; }
        [Serializable] private class InputZones { public Rectangle[] rects; }
        [Serializable] private class Report { public string type = "window-state", requestId, layoutId; public Rectangle rect; public float yaw, pitch, x, y, height; public bool adjusting, moving, restored, userChanged; }
        public event Action<string> StateChanged;
        private UniWindowController _controller;
        private AvatarSceneRig _rig;
        private IntPtr _handle;
        private bool _adjusting, _dragging, _rotating, _policyRestored;
        private Rectangle[] _inputZones = Array.Empty<Rectangle>();
        private Point _grab;
        private string _lastReport;
        private string _layoutId = "";
        private bool _userChanged;
        private float _reportedYaw, _reportedPitch;
        private float _nextReport, _nextPolicyCheck;
        private void Awake()
        {
            _controller = GetComponent<UniWindowController>();
            if (!AvatarCommandLine.Parse(Environment.GetCommandLineArgs()).TransparentWindow) { _controller.enabled = false; enabled = false; return; }
            _controller.forceWindowed = false;
            _controller.shouldFitMonitor = false;
            _controller.isHitTestEnabled = false;
            _controller.hitTestType = UniWindowController.HitTestType.None;
            _controller.isClickThrough = true;
            _controller.OnStateChanged += OnWindowChanged;
        }
        private void Start()
        {
            _rig = FindFirstObjectByType<AvatarSceneRig>();
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            using var process = System.Diagnostics.Process.GetCurrentProcess();
            EnumWindows((candidate, _) => {
                GetWindowThreadProcessId(candidate, out var id);
                var name = new System.Text.StringBuilder(64); GetClassName(candidate, name, 64);
                if (id != process.Id || name.ToString() != "UnityWndClass") return true;
                _handle = candidate; return false;
            }, IntPtr.Zero);
            if (_handle != IntPtr.Zero) {
                ShowWindow(_handle, 0);
                var style = GetWindowLongPtr(_handle, -20).ToInt64();
                SetWindowLongPtr(_handle, -20, new IntPtr((style | 0x80) & ~0x40000));
                RestoreTopmost();
            }
#endif
        }
        private void OnWindowChanged(UniWindowController.WindowStateEventType change)
        {
            RestoreTopmost();
            // A topmost transition can reorder this HWND without clearing its
            // WS_EX_TOPMOST bit. Ask Electron to restore capsule/panel order.
            if (((int)change & 16) != 0) _policyRestored = true;
        }
        private void RestoreTopmost()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (_handle == IntPtr.Zero) return;
            var style = GetWindowLongPtr(_handle, -20).ToInt64();
            if ((style & 0x80) == 0 || (style & 0x40000) != 0) {
                SetWindowLongPtr(_handle, -20, new IntPtr((style | 0x80) & ~0x40000));
                _policyRestored = true;
            }
            if ((style & 8) == 0 || _policyRestored) {
                SetWindowPos(_handle, new IntPtr(-1), 0, 0, 0, 0, 1 | 2 | 16 | 32);
                _policyRestored = true;
            }
#endif
        }
        public void ApplyLayout(string json)
        {
            var layout = JsonUtility.FromJson<Layout>(json);
            if (layout == null) return;
            if (layout.applyGeometry && (layout.rect == null || layout.rect.width <= 0 || layout.rect.height <= 0)) return;
            _layoutId = layout.requestId;
            _dragging = _rotating = _userChanged = false;
            _adjusting = layout.adjusting;
            _controller.isClickThrough = true;
            _rig?.SetCharacterShowcaseControlEnabled(_adjusting);
            // A mode-only request leaves the native rectangle and live pose intact.
            if (layout.applyGeometry) {
                _rig?.SetDesktopPose(layout.yaw, layout.pitch);
                _rig?.SetDesktopPlacement(layout.x, layout.y, layout.height);
            }
            _reportedYaw = _rig?.DesktopYaw ?? 0;
            _reportedPitch = _rig?.DesktopPitch ?? 4;
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (layout.applyGeometry) {
                var r = layout.rect;
                ShowWindow(_handle, 4);
                var actual = ReadRect();
                if (actual.x != r.x || actual.y != r.y || actual.width != r.width || actual.height != r.height)
                    SetWindowPos(_handle, new IntPtr(-1), r.x, r.y, r.width, r.height, 16 | 32);
            }
#endif
            Emit(layout.requestId, false);
        }
        public void ApplyInputZones(string json)
        {
            var zones = JsonUtility.FromJson<InputZones>(json);
            _inputZones = zones?.rects ?? Array.Empty<Rectangle>();
            RefreshClickThrough();
        }
        internal static bool IsInControlArea(int cursorX, int cursorY, Rectangle control, Rectangle[] inputZones)
        {
            if (control == null || control.width <= 0 || control.height <= 0) return false;
            foreach (var zone in inputZones ?? Array.Empty<Rectangle>())
                if (zone != null && cursorX >= zone.x && cursorX < zone.x + zone.width &&
                    cursorY >= zone.y && cursorY < zone.y + zone.height) return false;
            return cursorX >= control.x && cursorX < control.x + control.width &&
                cursorY >= control.y && cursorY < control.y + control.height;
        }
        private Rectangle ControlRect()
        {
            var window = ReadRect();
            var area = _rig != null ? _rig.DesktopControlBounds : Rect.zero;
            return new Rectangle {
                x = window.x + Mathf.RoundToInt(area.xMin * window.width),
                y = window.y + Mathf.RoundToInt((1f - area.yMax) * window.height),
                width = Mathf.RoundToInt(area.width * window.width),
                height = Mathf.RoundToInt(area.height * window.height),
            };
        }
        private void RefreshClickThrough()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (_controller == null || _handle == IntPtr.Zero) return;
            var capturing = _dragging || _rotating;
            var interactive = false;
            if (_adjusting && !capturing && GetCursorPos(out var cursor))
                interactive = IsInControlArea(cursor.x, cursor.y, ControlRect(), _inputZones);
            var clickThrough = !_adjusting || (!capturing && !interactive);
            if (_controller.isClickThrough != clickThrough) _controller.isClickThrough = clickThrough;
#endif
        }
        private void Update()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (_handle == IntPtr.Zero) return;
            if (Time.unscaledTime >= _nextPolicyCheck) { _nextPolicyCheck = Time.unscaledTime + 1f; RestoreTopmost(); }
            if (_rotating && (GetAsyncKeyState(1) & 0x8000) == 0) _rotating = false;
            if (_dragging && (GetAsyncKeyState(4) & 0x8000) == 0) _dragging = false;
            RefreshClickThrough();
            if (_adjusting) {
                if (Input.GetKeyDown(KeyCode.Escape)) { _adjusting = false; _dragging = _rotating = false; _controller.isClickThrough = true; _rig?.SetCharacterShowcaseControlEnabled(false); }
                if (Input.GetMouseButtonDown(0) && !_controller.isClickThrough) _rotating = true;
                if (Input.GetMouseButtonDown(2) && !_controller.isClickThrough) { _dragging = true; GetCursorPos(out _grab); }
                if (_dragging) {
                    _userChanged = true;
                    GetCursorPos(out var cursor);
                    _rig?.MoveDesktopByPixels(cursor.x - _grab.x, cursor.y - _grab.y);
                    _grab = cursor;
                }
                var scroll = Input.mouseScrollDelta.y;
                if (scroll != 0 && !_controller.isClickThrough) {
                    _userChanged = true;
                    _rig?.ZoomDesktop(scroll);
                }
            }
            if (Time.unscaledTime >= _nextReport) { _nextReport = Time.unscaledTime + .1f; Emit("", _dragging || _rotating); }
#endif
        }
        internal static Vector2 PointerPosition()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            var window = FindFirstObjectByType<AvatarWindow>();
            if (window != null && window._handle != IntPtr.Zero && GetCursorPos(out var point)) {
                var r = window.ReadRect();
                return new Vector2((point.x-r.x)*(float)Screen.width/r.width, Screen.height-(point.y-r.y)*(float)Screen.height/r.height);
            }
#endif
            return Input.mousePosition;
        }
        private Rectangle ReadRect()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            GetWindowRect(_handle, out var r);
            return new Rectangle { x=r.left, y=r.top, width=r.right-r.left, height=r.bottom-r.top };
#else
            return new Rectangle { width=Screen.width, height=Screen.height };
#endif
        }
        private void Emit(string requestId, bool moving)
        {
            var yaw = _rig?.DesktopYaw ?? 0;
            var pitch = _rig?.DesktopPitch ?? 4;
            // Programmatic placement never becomes a new user preference. Manual
            // rotation includes its inertial tail, which changes the target pose.
            var changed = _userChanged || (_adjusting && (yaw != _reportedYaw || pitch != _reportedPitch));
            var center = _rig?.DesktopCenter ?? new Vector2(.78f, .5f);
            var json = JsonUtility.ToJson(new Report { requestId=requestId ?? "", layoutId=_layoutId, userChanged=changed, rect=ReadRect(), yaw=yaw, pitch=pitch, x=center.x, y=center.y, height=_rig?.DesktopHeight ?? .65f, adjusting=_adjusting, moving=moving, restored=_policyRestored });
            _reportedYaw=yaw; _reportedPitch=pitch;
            _policyRestored=_userChanged=false;
            if (json == _lastReport) return; _lastReport=json; StateChanged?.Invoke(json);
        }
        private void OnApplicationFocus(bool focused) { if (focused) _policyRestored = true; }
        private void OnDestroy() { if (_controller != null) _controller.OnStateChanged -= OnWindowChanged; }
        [StructLayout(LayoutKind.Sequential)] private struct Point { public int x,y; }
        [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int left,top,right,bottom; }
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
        private delegate bool EnumWindowsCallback(IntPtr window, IntPtr parameter);
        [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr window, System.Text.StringBuilder name, int count);
        [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr(IntPtr window, int index);
        [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] private static extern IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr value);
        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
        [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
        [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
        [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out NativeRect rect);
        [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
#endif
    }
}
