using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Networking;

namespace Katarune.Avatar
{
    // Native decoding is shared by import validation, music playback and file-based speech.
    public static class AvatarAudioClipLoader
    {
        public static UnityWebRequest CreateRequest(string path)
        {
            AudioType type;
            try
            {
                if (!Path.IsPathFullyQualified(path)) throw new InvalidDataException("音频文件路径无效。");
                using var file = File.OpenRead(path);
                if (file.Length <= 0 || file.Length > 128L * 1024 * 1024) throw new InvalidDataException("音频文件大小不符合限制。");
                var header = new byte[12]; var count = file.Read(header, 0, header.Length);
                // Managed assets have UUID filenames. These are native decoder hints, not format validation.
                type = Hint(header, count);
            }
            catch (InvalidDataException) { throw; }
            catch (UnauthorizedAccessException) { throw new InvalidDataException("音频无法读取，请检查文件权限。"); }
            catch (IOException) { throw new InvalidDataException("音频文件不可用，请重新导入。"); }
            var request = UnityWebRequestMultimedia.GetAudioClip(new Uri(path).AbsoluteUri, type);
            request.timeout = 30;
            // Keep compressed music compressed in memory; the native audio source owns playback decoding.
            ((DownloadHandlerAudioClip)request.downloadHandler).compressed = true;
            return request;
        }

        private static AudioType Hint(byte[] header, int count)
        {
            var signature = Encoding.ASCII.GetString(header, 0, count);
            if (count >= 12 && signature.StartsWith("RIFF", StringComparison.Ordinal) && signature.Substring(8, 4) == "WAVE") return AudioType.WAV;
            if (signature.StartsWith("OggS", StringComparison.Ordinal)) return AudioType.OGGVORBIS;
            if (count >= 12 && signature.StartsWith("FORM", StringComparison.Ordinal)
                && (signature.Substring(8, 4) == "AIFF" || signature.Substring(8, 4) == "AIFC")) return AudioType.AIFF;
            if (signature.StartsWith("ID3", StringComparison.Ordinal)
                || (count >= 4 && header[0] == 0xFF && (header[1] & 0xE0) == 0xE0
                    && (header[1] & 6) != 0 && ((header[1] >> 3) & 3) != 1
                    && (header[2] >> 4) is > 0 and < 15 && ((header[2] >> 2) & 3) != 3)) return AudioType.MPEG;
            return AudioType.UNKNOWN;
        }

        public static AudioClip GetDecodedClip(UnityWebRequest request)
        {
            if (request.result != UnityWebRequest.Result.Success) throw new InvalidDataException("音频无法解码，请使用当前播放器支持的文件。");
            var clip = DownloadHandlerAudioClip.GetContent(request);
            if (clip == null || clip.samples <= 0 || clip.frequency <= 0 || clip.channels <= 0
                || !float.IsFinite(clip.length) || clip.length <= 0f || clip.loadState == AudioDataLoadState.Failed)
            {
                Release(clip);
                throw new InvalidDataException("音频没有有效的可播放数据。");
            }
            return clip;
        }

        public static async Task<AudioClip> LoadAsync(string path, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            using var request = CreateRequest(path);
            var operation = request.SendWebRequest();
            try
            {
                while (!operation.isDone) { cancellationToken.ThrowIfCancellationRequested(); await Task.Yield(); }
                cancellationToken.ThrowIfCancellationRequested();
                return GetDecodedClip(request);
            }
            catch (OperationCanceledException) { request.Abort(); throw; }
        }

        public static void Release(AudioClip clip)
        {
            if (clip == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(clip);
            else UnityEngine.Object.DestroyImmediate(clip);
        }
    }
}
