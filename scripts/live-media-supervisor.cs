using System;
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
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint size);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string file, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string directory, ref Startup startup, out ProcessInfo process);
    [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
    static string Quote(string value) {
        var b = new StringBuilder("\""); int slashes=0;
        foreach(char c in value) { if(c=='\\') { slashes++; continue; } if(c=='\"') { b.Append('\\',slashes*2+1); b.Append(c); } else { b.Append('\\',slashes); b.Append(c); } slashes=0; }
        b.Append('\\',slashes*2); return b.Append('"').ToString();
    }
    static IntPtr Launch(IntPtr job, string file, string[] args, bool mediaOutput) {
        var command = new StringBuilder(Quote(file)); foreach(var arg in args) command.Append(' ').Append(Quote(arg));
        // stdout is reserved for FFmpeg's binary preview; server diagnostics use stderr.
        var startup = new Startup { Size=Marshal.SizeOf(typeof(Startup)), Flags=0x100, Input=GetStdHandle(-10), Output=GetStdHandle(mediaOutput ? -11 : -12), Error=GetStdHandle(-12) };
        ProcessInfo child;
        if(!CreateProcess(file,command,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,null,ref startup,out child)) throw new InvalidOperationException("media spawn failed");
        if(!AssignProcessToJobObject(job,child.Process)) { TerminateProcess(child.Process,1); CloseHandle(child.Process); CloseHandle(child.Thread); throw new InvalidOperationException("media job assignment failed"); }
        ResumeThread(child.Thread); CloseHandle(child.Thread); return child.Process;
    }
    static int Main(string[] args) {
        if(args.Length<4) return 2;
        IntPtr job=CreateJobObject(IntPtr.Zero,null), server=IntPtr.Zero, encoder=IntPtr.Zero;
        try {
            if(job==IntPtr.Zero) return 3;
            var limits=new ExtendedLimits(); limits.Basic.Flags=0x2000;
            if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimits)))) return 3;
            server=Launch(job,args[0],new[]{args[1]},false);
            var encoderArgs=new string[args.Length-3]; Array.Copy(args,3,encoderArgs,0,encoderArgs.Length);
            // RTMP listener starts before the encoder opens its publisher.
            Thread.Sleep(350); encoder=Launch(job,args[2],encoderArgs,true);
            Console.Error.WriteLine("supervisor=ready"); Console.Error.Flush();
            var done=new ManualResetEvent(false);
            new Thread(()=> { try { var input=Console.OpenStandardInput(); while(input.ReadByte()>=0) {} } catch {} done.Set(); }) { IsBackground=true }.Start();
            while(!done.WaitOne(100)) if(WaitForSingleObject(server,0)==0 || WaitForSingleObject(encoder,0)==0) return 4;
            return 0;
        } catch { Console.Error.WriteLine("media supervisor failed"); return 5; }
        finally { if(job!=IntPtr.Zero) CloseHandle(job); if(server!=IntPtr.Zero) CloseHandle(server); if(encoder!=IntPtr.Zero) CloseHandle(encoder); }
    }
}
