param([int]$X, [int]$Y, [long]$WindowHandle, [int]$OwnerProcessId)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DesktopClick {
 [StructLayout(LayoutKind.Sequential)] public struct Point { public int x, y; }
 [StructLayout(LayoutKind.Sequential)] struct Mouse { public int dx,dy; public uint data,flags,time; public UIntPtr extra; }
 [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public Mouse mouse; }
 [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
 [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window,uint flags);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
 [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,Input[] inputs,int size);
 public static void Move(int x,int y) { SetThreadDpiAwarenessContext(new IntPtr(-4)); if(!SetCursorPos(x,y))throw new Exception("Unable to position test pointer"); }
 public static long[] Probe(int x,int y) {
  var hit=GetAncestor(WindowFromPoint(new Point{x=x,y=y}),2); uint pid;GetWindowThreadProcessId(hit,out pid);
  return new[]{hit.ToInt64(),(long)pid};
 }
 public static void Click() {
  var inputs=new[]{new Input{mouse=new Mouse{flags=2}},new Input{mouse=new Mouse{flags=4}}};
  if(SendInput(2,inputs,Marshal.SizeOf(typeof(Input)))!=2)throw new Exception("Native click failed: "+Marshal.GetLastWin32Error());
 }
}
'@
[DesktopClick]::Move($X,$Y)
Start-Sleep -Milliseconds 100
$probe = [DesktopClick]::Probe($X,$Y)
$hitProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($probe[1])"
$owned = $probe[0] -eq $WindowHandle -or $probe[1] -eq $OwnerProcessId -or $hitProcess.ParentProcessId -eq $OwnerProcessId
if ($owned) { [DesktopClick]::Click() }
[PSCustomObject]@{ clicked=$owned; hitHandle=$probe[0]; hitProcessId=$probe[1] } | ConvertTo-Json -Compress
