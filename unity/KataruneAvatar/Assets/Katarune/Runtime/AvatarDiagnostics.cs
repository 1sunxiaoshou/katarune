using System;
using System.Collections.Concurrent;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using UnityEngine;

namespace Katarune.Avatar
{
    // Engine callbacks may run on any thread. No Unity calls, file writes or
    // Debug.Log in Capture. A separate timer drains the bounded safe projection.
    internal static class AvatarDiagnostics
    {
        private static readonly ConcurrentQueue<string> Pending = new();
        private static readonly string Instance = Guid.NewGuid().ToString();
        private static readonly Regex Frame = new(@"Assets/Katarune/[A-Za-z0-9_./-]+\.cs:\d+", RegexOptions.Compiled);
        private static Timer _timer;
        private static int _count, _dropped, _draining;
        private static long _sequence;
        private static string _fallback;
        internal static Func<string, bool> Sender;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        internal static void Initialize()
        {
            _fallback = Environment.GetEnvironmentVariable("KATARUNE_DIAGNOSTICS_FALLBACK");
            Application.logMessageReceivedThreaded -= Capture;
            Application.logMessageReceivedThreaded += Capture;
            _timer?.Dispose();
            _timer = new Timer(_ => Drain(), null, 1000, 1000);
            Application.quitting -= Shutdown;
            Application.quitting += Shutdown;
        }

        private static void Shutdown() { Application.logMessageReceivedThreaded -= Capture; _timer?.Dispose(); Drain(); Sender = null; }

        private static void Capture(string message, string stack, LogType type)
        {
            if (type != LogType.Exception && type != LogType.Error && type != LogType.Assert) return;
            if (Interlocked.Increment(ref _count) > 128) { Interlocked.Decrement(ref _count); Interlocked.Increment(ref _dropped); return; }
            // Exception messages, asset names, object names and absolute paths are excluded.
            var name = new[] { "NullReferenceException", "InvalidOperationException", "ArgumentException", "IOException" }
                .FirstOrDefault(candidate => message != null && message.StartsWith(candidate + ":", StringComparison.Ordinal)) ?? "Error";
            var frames = Frame.Matches((stack ?? "").Substring(0, Math.Min(stack?.Length ?? 0, 16384)).Replace('\\', '/'))
                .Cast<Match>().Select(match => match.Value).Where(value => value.Length <= 160 && !value.Contains("..")).Take(12);
            var json = "{\"type\":\"diagnostic\",\"processInstanceId\":\"" + Instance + "\",\"sequence\":" + Interlocked.Increment(ref _sequence)
                + ",\"timestamp\":\"" + DateTime.UtcNow.ToString("O") + "\",\"dropped\":" + Interlocked.Exchange(ref _dropped, 0)
                + ",\"error\":{\"name\":\"" + name + "\",\"frames\":[" + string.Join(",", frames.Select(frame => "\"" + frame + "\""))
                + "],\"messageRedacted\":true}}";
            Pending.Enqueue(json);
        }

        private static void Drain()
        {
            if (Interlocked.Exchange(ref _draining, 1) != 0) return;
            try
            {
                for (var i = 0; i < 16 && Pending.TryDequeue(out var json); i++)
                {
                    Interlocked.Decrement(ref _count);
                    try
                    {
                        if (Sender?.Invoke(json) == true) continue;
                        if (string.IsNullOrEmpty(_fallback)) continue;
                        Directory.CreateDirectory(Path.GetDirectoryName(_fallback));
                        if (File.Exists(_fallback) && new FileInfo(_fallback).Length > 512 * 1024)
                        {
                            File.Delete(_fallback + ".old"); File.Move(_fallback, _fallback + ".old");
                        }
                        File.AppendAllText(_fallback, json + "\n");
                    }
                    catch { Interlocked.Increment(ref _dropped); }
                }
            }
            finally { Volatile.Write(ref _draining, 0); }
        }
    }
}
