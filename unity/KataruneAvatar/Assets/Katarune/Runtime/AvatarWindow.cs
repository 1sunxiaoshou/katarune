using System;
using System.Collections;
using System.Runtime.InteropServices;
using Kirurobo;
using UnityEngine;

namespace Katarune.Avatar
{
    public sealed class AvatarWindow : MonoBehaviour
    {
        private const int VirtualKeyF1 = 0x70;
        private UniWindowController _window;
        private bool _debugUiVisible;
        private bool _f1WasDown;

        public event Action DebugUiToggleRequested;

        public bool IsReady => _window != null && _window.windowSize.sqrMagnitude > 0f;

        public void SetDebugUiVisible(bool visible)
        {
            _debugUiVisible = visible;
            ApplyInteractionMode();
        }

        private IEnumerator Start()
        {
            _window = gameObject.AddComponent<UniWindowController>();
            _window.currentCamera = Camera.main;
            _window.forceWindowed = true;
            _window.transparentType = UniWindowController.TransparentType.Alpha;
            _window.autoSwitchCameraBackground = true;
            _window.isTransparent = true;
            _window.isTopmost = true;
            _window.monitorToFit = 0;
            _window.shouldFitMonitor = true;
            ApplyInteractionMode();

            const int maximumWaitFrames = 300;
            for (var frame = 0; frame < maximumWaitFrames; frame += 1)
            {
                if (IsReady)
                {
                    _window.shouldFitMonitor = true;
                    ApplyInteractionMode();
                    Debug.Log($"KATARUNE_TRANSPARENT_WINDOW_READY mode=uniwinc-alpha size={_window.windowSize}");
                    yield break;
                }

                yield return null;
            }

            Debug.LogError("KATARUNE_TRANSPARENT_WINDOW_FAILED reason=window-attachment-timeout");
        }

        private void Update()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            var f1Down = (GetAsyncKeyState(VirtualKeyF1) & 0x8000) != 0;
            if (f1Down && !_f1WasDown) DebugUiToggleRequested?.Invoke();
            _f1WasDown = f1Down;
#endif
        }

        private void ApplyInteractionMode()
        {
            if (_window == null) return;
            if (_debugUiVisible)
            {
                _window.hitTestType = UniWindowController.HitTestType.Opacity;
                _window.opacityThreshold = 0.04f;
                _window.isHitTestEnabled = true;
                _window.isClickThrough = false;
            }
            else
            {
                _window.isHitTestEnabled = false;
                _window.isClickThrough = true;
            }
        }

#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int virtualKey);
#endif
    }
}
