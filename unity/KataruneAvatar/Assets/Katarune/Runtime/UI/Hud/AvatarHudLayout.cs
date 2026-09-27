using System;
using System.Runtime.InteropServices;
using UnityEngine;

namespace Katarune.Avatar
{
    internal static class AvatarHudLayout
    {
        internal static float Scale(float dpi, float preference, float width, float height) =>
            Mathf.Clamp(Mathf.Min(Mathf.Max(96f, dpi) / 96f * preference, width / 360f, height / 280f), 0.5f, 3f);

        internal static Rect PlacePanel(Rect dock, Vector2 screen)
        {
            const float gap = 32f, inset = 12f;
            var width = Mathf.Min(360f, screen.x - inset * 2);
            var height = Mathf.Min(480f, screen.y - inset * 2);
            var above = dock.yMin - gap - inset;
            var below = screen.y - dock.yMax - gap - inset;
            var x = Mathf.Clamp(dock.xMin, inset, screen.x - width - inset);
            float y;
            if (Mathf.Max(above, below) < 200 && screen.x - dock.xMax - gap - inset >= width)
            {
                x = dock.xMax + gap;
                y = Mathf.Clamp(dock.yMin, inset, screen.y - height - inset);
            }
            else if (Mathf.Max(above, below) < 200 && dock.xMin - gap - inset >= width)
            {
                x = dock.xMin - gap - width;
                y = Mathf.Clamp(dock.yMin, inset, screen.y - height - inset);
            }
            else
            {
                var up = above >= below;
                height = Mathf.Max(1, Mathf.Min(height, up ? above : below));
                y = up ? dock.yMin - gap - height : dock.yMax + gap;
            }
            return new Rect(x, y, width, height);
        }

        internal static void GetDisplay(out float dpi, out Rect workArea)
        {
            dpi = 96;
            workArea = new Rect(0, 0, Screen.width, Screen.height);
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            using var process = System.Diagnostics.Process.GetCurrentProcess();
            var window = process.MainWindowHandle;
            if (window == IntPtr.Zero) return;
            var windowDpi = GetDpiForWindow(window);
            if (windowDpi > 0) dpi = windowDpi;
            var info = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
            if (!GetMonitorInfo(MonitorFromWindow(window, 2), ref info)) return;
            var first = new Point { X = info.Work.Left, Y = info.Work.Top };
            var last = new Point { X = info.Work.Right, Y = info.Work.Bottom };
            if (!ScreenToClient(window, ref first) || !ScreenToClient(window, ref last)) return;
            var clipped = Rect.MinMaxRect(Mathf.Max(0, first.X), Mathf.Max(0, first.Y),
                Mathf.Min(Screen.width, last.X), Mathf.Min(Screen.height, last.Y));
            if (clipped.width > 0 && clipped.height > 0) workArea = clipped;
#endif
        }

        [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
        [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)] private struct MonitorInfo { public int Size; public NativeRect Monitor, Work; public uint Flags; }
        [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
        [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
        [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
        [DllImport("user32.dll")] private static extern bool ScreenToClient(IntPtr window, ref Point point);
    }
}
