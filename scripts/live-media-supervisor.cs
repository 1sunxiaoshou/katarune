using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// Standalone Windows helper. Closing its job kills all media children, even if
// Electron or this helper exits unexpectedly. No network or application data.
internal static class MediaSupervisor {
    [StructLayout(LayoutKind.Sequential)] struct Limits {
        public long ProcessTime, JobTime; public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet; public uint ActiveProcessLimit;
        public UIntPtr Affinity; public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] struct Counters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
        public Limits Basic; public Counters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
        public int Size; public string Reserved, Desktop, Title;
        public uint X,Y,Width,Height,CharsX,CharsY,Fill,Flags; public short Show,Reserved2;
        public IntPtr Reserved3, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string file, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string directory, ref Startup startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job, uint code);
    private static readonly object OutputLock = new object();
    static void Output(string line) { lock(OutputLock) { Console.Error.WriteLine(line); Console.Error.Flush(); } }
    // Fixed records only; paths and native exception messages never enter the protocol.
    static void Report(string eventName, string process, long? code = null) {
        Output("katarune-media:{\"event\":\""+eventName+"\",\"process\":\""+process+"\""+(code.HasValue ? ",\"code\":"+code.Value : "")+"}");
    }
    static bool Exited(IntPtr process) { return process!=IntPtr.Zero && WaitForSingleObject(process,0)==0; }
    static uint ExitCode(IntPtr process) { uint code; return GetExitCodeProcess(process,out code) ? code : 0xffffffff; }
    static Thread ReadLines(Stream stream, Action<string> accept) {
        var thread=new Thread(()=> {
            try {
                using(var reader=new StreamReader(stream)) {
                    var line=new StringBuilder(); bool oversized=false; int c;
                    while((c=reader.Read())>=0) {
                        if(c=='\n') { if(!oversized) accept(line.ToString().TrimEnd('\r')); line.Clear(); oversized=false; }
                        else if(line.Length<8192) line.Append((char)c); else oversized=true;
                    }
                    if(line.Length>0 && !oversized) accept(line.ToString());
                }
            } catch { /* Process shutdown closes the private log pipe. */ }
        }) { IsBackground=true };
        thread.Start(); return thread;
    }
    static string Quote(string value) {
        var b = new StringBuilder("\""); int slashes=0;
        foreach(char c in value) { if(c=='\\') { slashes++; continue; } if(c=='\"') { b.Append('\\',slashes*2+1); b.Append(c); } else { b.Append('\\',slashes); b.Append(c); } slashes=0; }
        b.Append('\\',slashes*2); return b.Append('"').ToString();
    }
    static IntPtr Launch(IntPtr job, string file, string[] args, IntPtr output, IntPtr error) {
        var command = new StringBuilder(Quote(file)); foreach(var arg in args) command.Append(' ').Append(Quote(arg));
        var startup = new Startup { Size=Marshal.SizeOf(typeof(Startup)), Flags=0x100, Input=GetStdHandle(-10), Output=output, Error=error };
        ProcessInfo child;
        if(!CreateProcess(file,command,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,null,ref startup,out child)) throw new Win32Exception(Marshal.GetLastWin32Error());
        if(!AssignProcessToJobObject(job,child.Process)) { var code=Marshal.GetLastWin32Error(); TerminateProcess(child.Process,1); WaitForSingleObject(child.Process,0xffffffff); CloseHandle(child.Process); CloseHandle(child.Thread); throw new Win32Exception(code); }
        if(ResumeThread(child.Thread)==0xffffffff) { var code=Marshal.GetLastWin32Error(); TerminateProcess(child.Process,1); WaitForSingleObject(child.Process,0xffffffff); CloseHandle(child.Process); CloseHandle(child.Thread); throw new Win32Exception(code); }
        CloseHandle(child.Thread); return child.Process;
    }
    static int Main(string[] args) {
        if(args.Length<4) return 2;
        IntPtr job=CreateJobObject(IntPtr.Zero,null), server=IntPtr.Zero, encoder=IntPtr.Zero;
        var done=new ManualResetEvent(false); var ready=new ManualResetEvent(false);
        string launching="supervisor"; Thread serverReader=null, encoderReader=null;
        AnonymousPipeServerStream serverLog=null, encoderLog=null;
        try {
            if(job==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            var limits=new ExtendedLimits(); limits.Basic.Flags=0x2000;
            if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimits)))) throw new Win32Exception(Marshal.GetLastWin32Error());
            // Observe control EOF even while the service is still starting.
            new Thread(()=> { try { var input=Console.OpenStandardInput(); while(input.ReadByte()>=0) {} } catch {} done.Set(); }) { IsBackground=true }.Start();
            serverLog=new AnonymousPipeServerStream(PipeDirection.In,HandleInheritability.Inheritable);
            launching="server";
            var logHandle=serverLog.ClientSafePipeHandle.DangerousGetHandle();
            server=Launch(job,args[0],new[]{args[1]},logHandle,logHandle);
            serverLog.DisposeLocalCopyOfClientHandle();
            serverReader=ReadLines(serverLog,line=> {
                // MediaMTX 1.21.3 emits this only after its own bind succeeds.
                if(line.Contains("[RTMP] started with listener on ") && line.EndsWith(" (TCP/RTMP)")) ready.Set();
            });
            var deadline=Stopwatch.StartNew();
            while(!ready.WaitOne(25)) {
                if(done.WaitOne(0)) return 0;
                if(Exited(server)) { Report("exited","server",ExitCode(server)); return 4; }
                if(deadline.ElapsedMilliseconds>=10000) { Report("timeout","server"); return 4; }
            }
            if(done.WaitOne(0)) return 0;
            if(Exited(server)) { Report("exited","server",ExitCode(server)); return 4; }
            Report("ready","server");
            var encoderArgs=new string[args.Length-3]; Array.Copy(args,3,encoderArgs,0,encoderArgs.Length);
            encoderLog=new AnonymousPipeServerStream(PipeDirection.In,HandleInheritability.Inheritable);
            launching="encoder";
            encoder=Launch(job,args[2],encoderArgs,GetStdHandle(-11),encoderLog.ClientSafePipeHandle.DangerousGetHandle());
            encoderLog.DisposeLocalCopyOfClientHandle();
            encoderReader=ReadLines(encoderLog,Output);
            Report("started","encoder");
            while(!done.WaitOne(25)) {
                if(Exited(server)) { Report("exited","server",ExitCode(server)); return 4; }
                if(Exited(encoder)) { Report("exited","encoder",ExitCode(encoder)); return 4; }
            }
            return 0;
        } catch(Win32Exception error) { Report("launch-failed",launching,error.NativeErrorCode); return 5; }
        catch { Report("launch-failed",launching); return 5; }
        finally {
            // Keep process handles until termination completes. Returning means the
            // owned children have exited, rather than merely receiving a kill.
            if(job!=IntPtr.Zero) { TerminateJobObject(job,1); CloseHandle(job); }
            if(server!=IntPtr.Zero) { WaitForSingleObject(server,0xffffffff); CloseHandle(server); }
            if(encoder!=IntPtr.Zero) { WaitForSingleObject(encoder,0xffffffff); CloseHandle(encoder); }
            if(serverReader!=null) serverReader.Join(1000);
            if(encoderReader!=null) encoderReader.Join(1000);
            if(serverLog!=null) serverLog.Dispose();
            if(encoderLog!=null) encoderLog.Dispose();
        }
    }
}
