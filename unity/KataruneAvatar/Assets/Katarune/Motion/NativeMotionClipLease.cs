using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace Katarune.Avatar
{
    // Candidate loads and the currently displayed model can share the same bundle.
    // Key by content because imported resources have opaque, extensionless paths.
    internal sealed class NativeMotionClipLease : IDisposable
    {
        private sealed class Entry
        {
            internal int References;
            internal Task Loading;
            internal AssetBundle Bundle;
            internal AnimationClip Clip;
            internal bool FootIK;
        }
        private static readonly Dictionary<string, Entry> Entries = new(StringComparer.Ordinal);
        private readonly string _key;
        private Entry _entry;
        public AnimationClip Clip => _entry.Clip;
        public bool FootIK => _entry.FootIK;
        private NativeMotionClipLease(string key, Entry entry) { _key = key; _entry = entry; }

        public static async Task<NativeMotionClipLease> LoadAsync(string path, CancellationToken token)
        {
            var payload = await Task.Run(() => {
                token.ThrowIfCancellationRequested();
                using var stream = File.OpenRead(path);
                if (stream.Length < 8 || stream.Length > 128 * 1024 * 1024) throw new InvalidDataException("原生动画大小无效。");
                var bytes = new byte[checked((int)stream.Length)];
                using var reader = new BinaryReader(stream);
                var read = 0;
                while (read < bytes.Length) { token.ThrowIfCancellationRequested(); var count = reader.Read(bytes, read, bytes.Length-read); if(count==0) throw new EndOfStreamException(); read+=count; }
                using var sha = SHA256.Create();
                return (bytes, key: BitConverter.ToString(sha.ComputeHash(bytes)));
            }, token);
            token.ThrowIfCancellationRequested();
            if (!Entries.TryGetValue(payload.key, out var entry))
            {
                entry = new Entry(); Entries.Add(payload.key, entry);
                entry.Loading = LoadBundle(entry, payload.bytes);
            }
            entry.References++;
            var lease = new NativeMotionClipLease(payload.key, entry);
            try { await entry.Loading; token.ThrowIfCancellationRequested(); return lease; }
            catch { lease.Dispose(); throw; }
        }

        private static async Task LoadBundle(Entry entry, byte[] bytes)
        {
            var request = AssetBundle.LoadFromMemoryAsync(bytes);
            await Awaitable.FromAsyncOperation(request);
            entry.Bundle = request.assetBundle;
            if (entry.Bundle == null || entry.Bundle.isStreamedSceneAssetBundle) throw new InvalidDataException("无法加载原生动画包。");
            var loading = entry.Bundle.LoadAssetAsync<AvatarMotionLibrary>(AvatarMotionPacks.LibraryAssetName);
            await Awaitable.FromAsyncOperation(loading);
            var library = loading.asset as AvatarMotionLibrary;
            entry.Clip = AvatarMotionPacks.ValidatePackageClip(library);
            entry.FootIK = library.ApplyFootIK;
        }

        public void Dispose()
        {
            if (_entry == null) return;
            var entry = _entry; _entry = null;
            if (--entry.References != 0) return;
            Entries.Remove(_key);
            if (entry.Bundle != null) entry.Bundle.Unload(true);
        }
    }
}
