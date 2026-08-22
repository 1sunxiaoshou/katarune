using System;
using System.Collections;
using System.Runtime.InteropServices;
using Kirurobo;
using UnityEngine;
using UnityEngine.UIElements;

namespace Katarune.Avatar
{
    public sealed class AvatarWindow : MonoBehaviour
    {
        private const int VirtualKeyF1 = 0x70;
        private UniWindowController _window;
        private bool _hudVisible;
        private bool _hudPointerInteractionActive;
        private bool _f1WasDown;
        private bool _windowEventsSubscribed;
        private VisualElement _hudRoot;
        private IAvatarPointerPositionSource _pointerSource;

        public event Action HudToggleRequested;

        public bool IsReady => _window != null && _window.windowSize.sqrMagnitude > 0f;

        internal void BindHud(
            VisualElement hudRoot,
            IAvatarPointerPositionSource pointerSource)
        {
            _hudRoot = hudRoot ?? throw new ArgumentNullException(nameof(hudRoot));
            _pointerSource = pointerSource ?? throw new ArgumentNullException(nameof(pointerSource));
            ApplyInteractionMode();
        }

        public void SetHudVisible(bool visible)
        {
            _hudVisible = visible;
            if (!visible) _hudPointerInteractionActive = false;
            ApplyInteractionMode();
        }

        internal void SetHudPointerInteractionActive(bool active)
        {
            _hudPointerInteractionActive = active;
            ApplyInteractionMode();
        }

        private IEnumerator Start()
        {
            // Unity's Run In Background setting keeps the desktop avatar updating
            // while another application has focus. Native topmost state is applied
            // separately after UniWindowController has attached the player window.
            Application.runInBackground = true;

            _window = gameObject.AddComponent<UniWindowController>();
            _window.OnMonitorChanged += HandleMonitorChanged;
            _windowEventsSubscribed = true;
            _window.currentCamera = Camera.main;
            _window.forceWindowed = true;
            _window.transparentType = UniWindowController.TransparentType.Alpha;
            _window.autoSwitchCameraBackground = true;
            _window.isTransparent = true;
            _window.monitorToFit = 0;
            _window.shouldFitMonitor = true;
            _window.hitTestType = UniWindowController.HitTestType.None;
            _window.isHitTestEnabled = false;
            ApplyInteractionMode();

            const int maximumWaitFrames = 300;
            for (var frame = 0; frame < maximumWaitFrames; frame += 1)
            {
                if (IsReady)
                {
                    _window.shouldFitMonitor = true;
                    EnsureTopmost();
                    ApplyInteractionMode();

                    // Window fitting can update native styles after attachment. Reapply
                    // once on the following frame, then rely on lifecycle events rather
                    // than continuously changing z-order or stealing foreground focus.
                    yield return null;
                    EnsureTopmost();
                    Debug.Log(
                        $"KATARUNE_TRANSPARENT_WINDOW_READY mode=uniwinc-alpha size={_window.windowSize} topmost={_window.isTopmost}");
                    yield break;
                }

                yield return null;
            }

            Debug.LogError("KATARUNE_TRANSPARENT_WINDOW_FAILED reason=window-attachment-timeout");
        }

        private void OnApplicationFocus(bool hasFocus)
        {
            if (!IsReady) return;
            EnsureTopmost();
        }

        private void OnDestroy()
        {
            if (!_windowEventsSubscribed || _window == null) return;
            _window.OnMonitorChanged -= HandleMonitorChanged;
            _windowEventsSubscribed = false;
        }

        private void Update()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            var f1Down = (GetAsyncKeyState(VirtualKeyF1) & 0x8000) != 0;
            if (f1Down && !_f1WasDown) HudToggleRequested?.Invoke();
            _f1WasDown = f1Down;
#endif
            RefreshHudHitTest();
        }

        private void ApplyInteractionMode()
        {
            if (_window == null) return;
            _window.hitTestType = UniWindowController.HitTestType.None;
            _window.isHitTestEnabled = false;
            if (!_hudVisible || _hudPointerInteractionActive)
            {
                SetClickThrough(!_hudPointerInteractionActive);
                return;
            }

            RefreshHudHitTest();
        }

        private void RefreshHudHitTest()
        {
            if (_window == null) return;
            if (!_hudVisible)
            {
                SetClickThrough(true);
                return;
            }
            if (_hudPointerInteractionActive)
            {
                SetClickThrough(false);
                return;
            }

            var panel = _hudRoot?.panel;
            if (panel == null
                || _pointerSource == null
                || !_pointerSource.TryGetClientPosition(out var clientPosition))
            {
                SetClickThrough(true);
                return;
            }

            var panelPosition = RuntimePanelUtils.ScreenToPanel(panel, clientPosition);
            var picked = panel.Pick(panelPosition);
            SetClickThrough(!IsInteractivePick(picked, _hudRoot));
        }

        private void SetClickThrough(bool clickThrough)
        {
            if (_window.isClickThrough == clickThrough) return;
            _window.isClickThrough = clickThrough;
        }

        internal static bool IsInteractivePick(VisualElement picked, VisualElement root)
        {
            if (picked == null || root == null) return false;
            for (var current = picked; current != null; current = current.parent)
            {
                if (current is Button button)
                {
                    return button.enabledInHierarchy
                        && button.resolvedStyle.display != DisplayStyle.None
                        && button.resolvedStyle.visibility == Visibility.Visible;
                }
                if (current == root) break;
            }
            return false;
        }

        private void HandleMonitorChanged()
        {
            EnsureTopmost();
        }

        private bool EnsureTopmost()
        {
            if (_window == null) return false;

            _window.isTopmost = true;
            if (_window.isTopmost) return true;

            Debug.LogWarning("KATARUNE_TOPMOST_FAILED reason=native-window-not-ready");
            return false;
        }

#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int virtualKey);
#endif
    }
}
