using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using UnityEngine;

namespace Katarune.Avatar
{
    internal interface IAvatarPointerPositionSource
    {
        bool TryGetClientPosition(out Vector2 position);
    }

    internal static class AvatarPointerPositionSource
    {
        public static IAvatarPointerPositionSource CreateDefault()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            return new WindowsAvatarPointerPositionSource();
#else
            return new UnityAvatarPointerPositionSource();
#endif
        }
    }

    internal sealed class UnityAvatarPointerPositionSource : IAvatarPointerPositionSource
    {
        public bool TryGetClientPosition(out Vector2 position)
        {
            var mousePosition = Input.mousePosition;
            position = new Vector2(mousePosition.x, Screen.height - mousePosition.y);
            return true;
        }
    }

#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
    internal sealed class WindowsAvatarPointerPositionSource : IAvatarPointerPositionSource
    {
        private IntPtr _windowHandle;

        public bool TryGetClientPosition(out Vector2 position)
        {
            position = default;
            if (!TryResolveWindowHandle() || !GetCursorPos(out var point)) return false;
            if (!ScreenToClient(_windowHandle, ref point)) return false;
            position = new Vector2(point.X, point.Y);
            return true;
        }

        private bool TryResolveWindowHandle()
        {
            if (_windowHandle != IntPtr.Zero && IsWindow(_windowHandle)) return true;
            using var process = Process.GetCurrentProcess();
            process.Refresh();
            _windowHandle = process.MainWindowHandle;
            return _windowHandle != IntPtr.Zero;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct NativePoint
        {
            public int X;
            public int Y;
        }

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetCursorPos(out NativePoint point);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool ScreenToClient(IntPtr windowHandle, ref NativePoint point);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool IsWindow(IntPtr windowHandle);
    }
#endif
}
