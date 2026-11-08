using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

// Native fault fixture: no accounts, models, user files or real media inputs.
internal static class LiveMediaProcess {
    static void Box(Stream output, string name) {
        output.Write(new byte[]{0,0,0,8},0,4);
        var bytes=System.Text.Encoding.ASCII.GetBytes(name); output.Write(bytes,0,4);
    }
    static int Main(string[] args) {
        var mode=Environment.GetEnvironmentVariable("KATARUNE_MEDIA_TEST_MODE") ?? "normal";
        if(args.Length==1 && args[0].EndsWith(".yml")) {
            if(mode=="server-exit") return 17;
            if(mode=="server-hang") { Thread.Sleep(Timeout.Infinite); return 0; }
            if(mode=="server-delay") Thread.Sleep(2000);
            var info=new ProcessStartInfo(Environment.GetEnvironmentVariable("KATARUNE_MEDIA_TEST_SERVER"),"\""+args[0]+"\"") {
                UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true
            };
            using(var child=Process.Start(info)) {
                child.OutputDataReceived+=(sender,eventArgs)=> { if(eventArgs.Data!=null) Console.WriteLine(eventArgs.Data); };
                child.ErrorDataReceived+=(sender,eventArgs)=> { if(eventArgs.Data!=null) Console.Error.WriteLine(eventArgs.Data); };
                child.BeginOutputReadLine(); child.BeginErrorReadLine(); child.WaitForExit(); return child.ExitCode;
            }
        }
        // Hardware preflight succeeds without exercising the machine's GPU.
        if(Array.IndexOf(args,"-frames:v")>=0) return 0;
        if(mode=="encoder-exit") return 23;
        if(mode!="preview-only") {
            Console.Error.WriteLine("frame=180\nout_time_us=3000000\nprogress=continue"); Console.Error.Flush();
        }
        if(mode=="delayed-preview") Thread.Sleep(600);
        if(mode!="progress-only") {
            var output=Console.OpenStandardOutput();
            foreach(var name in new[]{"ftyp","moov","moof","mdat"}) Box(output,name);
            output.Flush();
        }
        if(mode=="encoder-runtime-exit") { Thread.Sleep(600); return 23; }
        Thread.Sleep(Timeout.Infinite); return 0;
    }
}
