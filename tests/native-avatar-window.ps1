param([int]$AvatarProcessId = 0)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class AvatarWindowProbe {
 public delegate bool WindowCallback(IntPtr window, IntPtr parameter);
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int x,y,right,bottom; }
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] public static extern bool EnumWindows(WindowCallback callback,IntPtr parameter);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window,out uint processId);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr window,StringBuilder name,int count);
 [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr window,int index);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window,out Rect rect);
 [DllImport("user32.dll")] public static extern int GetSystemMetrics(int metric);
 public static IntPtr Find(int processId) {
  IntPtr result=IntPtr.Zero;
  EnumWindows((window,_)=> { uint owner; GetWindowThreadProcessId(window,out owner);
   var name=new StringBuilder(64); GetClassName(window,name,64);
   if(owner==processId && name.ToString()=="UnityWndClass") { result=window; return false; } return true;
  },IntPtr.Zero);
  return result;
 }
}
'@
[AvatarWindowProbe]::SetThreadDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null
if ($AvatarProcessId -eq 0) {
    @{ x=0; y=0; width=[AvatarWindowProbe]::GetSystemMetrics(0); height=[AvatarWindowProbe]::GetSystemMetrics(1) } | ConvertTo-Json -Compress
    exit
}
$handle = [AvatarWindowProbe]::Find($AvatarProcessId)
if ($handle -eq [IntPtr]::Zero) { throw 'Owned Unity window was not found' }
$style = [AvatarWindowProbe]::GetWindowLongPtr($handle, -20).ToInt64()
$rect = [AvatarWindowProbe+Rect]::new()
[AvatarWindowProbe]::GetWindowRect($handle, [ref]$rect) | Out-Null
@{ topmost=($style -band 8) -ne 0; toolWindow=($style -band 0x80) -ne 0;
   appWindow=($style -band 0x40000) -ne 0;
   clickThrough=($style -band 0x20) -ne 0;
   x=$rect.x; y=$rect.y; width=$rect.right-$rect.x; height=$rect.bottom-$rect.y } | ConvertTo-Json -Compress
