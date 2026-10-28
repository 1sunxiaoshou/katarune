using System;
using System.Collections;
using System.Collections.Concurrent;
using System.IO;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarDiagnosticsTests
    {
        [UnityTest] public IEnumerator ThreadedErrorsUseSafeTransportAndDisconnectedFallback()
        {
            var directory = Path.Combine(Path.GetTempPath(), "katarune-diagnostics-" + Guid.NewGuid().ToString("N"));
            var path = Path.Combine(directory, "fallback.jsonl");
            var previous = Environment.GetEnvironmentVariable("KATARUNE_DIAGNOSTICS_FALLBACK");
            var messages = new ConcurrentQueue<string>();
            try
            {
                Environment.SetEnvironmentVariable("KATARUNE_DIAGNOSTICS_FALLBACK", path);
                AvatarDiagnostics.Initialize();
                AvatarDiagnostics.Sender = json => { messages.Enqueue(json); return true; };
                LogAssert.Expect(LogType.Error, "private-response-fixture");
                var worker = Task.Run(() => Debug.LogError("private-response-fixture"));
                var deadline = Time.realtimeSinceStartup + 5;
                while ((!worker.IsCompleted || messages.IsEmpty) && Time.realtimeSinceStartup < deadline) yield return null;
                Assert.That(messages.TryDequeue(out var message), Is.True);
                Assert.That(message, Does.Contain("\"type\":\"diagnostic\""));
                Assert.That(message, Does.Not.Contain("private-response-fixture"));
                Assert.That(message, Does.Not.Contain(directory));
                AvatarDiagnostics.Sender = null;
                LogAssert.Expect(LogType.Error, "private-fallback-fixture");
                Debug.LogError("private-fallback-fixture");
                deadline = Time.realtimeSinceStartup + 5;
                while (!File.Exists(path) && Time.realtimeSinceStartup < deadline) yield return null;
                Assert.That(File.Exists(path), Is.True);
                // The writer appends asynchronously; wait for its complete line.
                while (new FileInfo(path).Length == 0 && Time.realtimeSinceStartup < deadline) yield return null;
                var fallback = File.ReadAllText(path);
                Assert.That(fallback, Does.Contain("messageRedacted"));
                Assert.That(fallback, Does.Not.Contain("private-fallback-fixture"));
                Assert.That(fallback, Does.Not.Contain(directory));
            }
            finally
            {
                AvatarDiagnostics.Sender = null;
                Environment.SetEnvironmentVariable("KATARUNE_DIAGNOSTICS_FALLBACK", previous);
                AvatarDiagnostics.Initialize();
                if (Directory.Exists(directory)) Directory.Delete(directory, true);
            }
        }
    }
}
