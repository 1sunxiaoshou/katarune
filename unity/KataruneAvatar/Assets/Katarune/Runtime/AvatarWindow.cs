using System;
using System.Runtime.InteropServices;
using Kirurobo;
using UnityEngine;
using UnityEngine.UIElements;

namespace Katarune.Avatar
{
    [RequireComponent(typeof(UniWindowController))]
    public sealed class AvatarWindow : MonoBehaviour
    {
        private const int VirtualKeyF1 = 0x70;
        private UniWindowController _window;
        private bool _hudVisible;
        private bool _hudPointerInteractionActive;
        private bool _characterShowcaseInteractionActive;
        private bool _f1WasDown;
        private VisualElement _hudRoot;
        private IAvatarPointerPositionSource _pointerSource;

        public event Action HudToggleRequested;

        private void Awake()
        {
            _window = GetComponent<UniWindowController>();
            if (_window == null)
            {
                Debug.LogError("KATARUNE_TRANSPARENT_WINDOW_FAILED reason=scene-controller-missing");
                enabled = false;
                return;
            }

            if (!AvatarCommandLine.Parse(Environment.GetCommandLineArgs()).TransparentWindow)
            {
                _window.isTransparent = false;
                _window.enabled = false;
                enabled = false;
                return;
            }

            ApplyInteractionMode();
        }

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

        internal void SetCharacterShowcaseInteractionActive(bool active)
        {
            _characterShowcaseInteractionActive = active;
            ApplyInteractionMode();
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
            if (_characterShowcaseInteractionActive)
            {
                SetClickThrough(false);
                return;
            }
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
            if (_characterShowcaseInteractionActive)
            {
                SetClickThrough(false);
                return;
            }
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

#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int virtualKey);
#endif
    }
}
