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
        [Serializable] private class Layout { public string requestId; public Rectangle rect; public float yaw, pitch; public bool adjusting, applyGeometry; }
        [Serializable] private class Report { public string type = "window-state", requestId, layoutId; public Rectangle rect; public float yaw, pitch; public bool adjusting, moving, restored, userChanged; }
        public event Action<string> StateChanged;
        private UniWindowController _controller;
        private AvatarSceneRig _rig;
        private IntPtr _handle;
        private bool _adjusting, _dragging, _policyRestored;
        private Point _grab;
        private Rectangle _start;
        private Rectangle _zoomGeometry;
        private double _zoomHeight, _zoomAspect, _zoomCenterX, _zoomCenterY;
        private string _lastReport;
        private string _layoutId = "";
        private bool _userChanged;
        private float _reportedYaw, _reportedPitch;
        private float _nextReport, _nextPolicyCheck;
        private void Awake()
        {
            _controller = GetComponent<UniWindowController>();
            if (!AvatarCommandLine.Parse(Environment.GetCommandLineArgs()).TransparentWindow) { _controller.enabled = false; enabled = false; return; }
            _controller.forceWindowed = true;
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
        private void OnWindowChanged(UniWindowController.WindowStateEventType _) => RestoreTopmost();
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
            _dragging = _userChanged = false;
            _adjusting = layout.adjusting;
            _controller.isClickThrough = !_adjusting;
            _rig?.SetCharacterShowcaseControlEnabled(_adjusting);
            // A mode-only request leaves the native rectangle and live pose intact.
            if (layout.applyGeometry) _rig?.SetDesktopPose(layout.yaw, layout.pitch);
            _reportedYaw = _rig?.DesktopYaw ?? 0;
            _reportedPitch = _rig?.DesktopPitch ?? 4;
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (layout.applyGeometry) {
                var r = layout.rect;
                SetWindowPos(_handle, new IntPtr(-1), r.x, r.y, r.width, r.height, 16 | 32);
                ShowWindow(_handle, 4);
                SynchronizeZoom(ReadRect(), true);
            }
#endif
            Emit(layout.requestId, false);
        }
        private void Update()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (_handle == IntPtr.Zero) return;
            if (Time.unscaledTime >= _nextPolicyCheck) { _nextPolicyCheck = Time.unscaledTime + 1f; RestoreTopmost(); }
            if (_adjusting) {
                if (Input.GetKeyDown(KeyCode.Escape)) { _adjusting = false; _controller.isClickThrough = true; _rig?.SetCharacterShowcaseControlEnabled(false); }
                if (Input.GetMouseButtonDown(2)) { _dragging = true; GetCursorPos(out _grab); _start = ReadRect(); }
                if (_dragging) {
                    _userChanged = true;
                    GetCursorPos(out var cursor);
                    SetWindowPos(_handle, IntPtr.Zero, _start.x + cursor.x - _grab.x, _start.y + cursor.y - _grab.y, 0, 0, 1 | 4 | 16);
                    if ((GetAsyncKeyState(4) & 0x8000) == 0) _dragging = false;
                }
                var scroll = Input.mouseScrollDelta.y;
                if (scroll != 0) {
                    _userChanged = true;
                    SynchronizeZoom(ReadRect());
                    var minimumHeight = Math.Max(180d, 100d / _zoomAspect);
                    var height = Math.Max(minimumHeight, Math.Min(4000d, _zoomHeight * Math.Pow(1.08d, scroll)));
                    var h = (int)Math.Round(height, MidpointRounding.AwayFromZero);
                    var w = (int)Math.Round(height * _zoomAspect, MidpointRounding.AwayFromZero);
                    var target = new Rectangle {
                        x = (int)Math.Round(_zoomCenterX - w / 2d, MidpointRounding.AwayFromZero),
                        y = (int)Math.Round(_zoomCenterY - h / 2d, MidpointRounding.AwayFromZero),
                        width = w, height = h,
                    };
                    if (SetWindowPos(_handle, IntPtr.Zero, target.x, target.y, target.width, target.height, 4 | 16)) {
                        _zoomHeight = height;
                        _zoomGeometry = target;
                        if (_dragging) {
                            _start = target;
                            GetCursorPos(out _grab);
                        }
                    }
                }
            }
            if (Time.unscaledTime >= _nextReport) { _nextReport = Time.unscaledTime + .1f; Emit("", _dragging || Input.GetMouseButton(0)); }
#endif
        }
        private void SynchronizeZoom(Rectangle actual, bool reset = false)
        {
            if (!reset && _zoomGeometry != null && actual.width == _zoomGeometry.width && actual.height == _zoomGeometry.height) {
                // Moving changes the anchor, but must not round away the accumulated zoom.
                _zoomCenterX += actual.x - _zoomGeometry.x;
                _zoomCenterY += actual.y - _zoomGeometry.y;
            } else {
                // Layout requests and native/DPI size changes establish a new size basis.
                _zoomHeight = actual.height;
                _zoomAspect = (double)actual.width / actual.height;
                _zoomCenterX = actual.x + actual.width / 2d;
                _zoomCenterY = actual.y + actual.height / 2d;
            }
            _zoomGeometry = actual;
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
            var json = JsonUtility.ToJson(new Report { requestId=requestId ?? "", layoutId=_layoutId, userChanged=changed, rect=ReadRect(), yaw=yaw, pitch=pitch, adjusting=_adjusting, moving=moving, restored=_policyRestored });
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
