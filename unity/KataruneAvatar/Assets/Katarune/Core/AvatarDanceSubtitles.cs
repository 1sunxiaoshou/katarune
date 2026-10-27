using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace Katarune.Avatar
{
    // A plain-text SRT timeline. End times are exclusive so gaps never retain an ended lyric.
    public sealed class AvatarDanceSubtitles
    {
        public const int MaxBytes = 1024 * 1024;
        private static readonly Regex Timestamp = new(
            @"^([0-9]{2}):([0-9]{2}):([0-9]{2}),([0-9]{3}) +--> +([0-9]{2}):([0-9]{2}):([0-9]{2}),([0-9]{3})$",
            RegexOptions.CultureInvariant);
        private static readonly Regex Index = new(@"^[1-9][0-9]*$", RegexOptions.CultureInvariant);
        private readonly Cue[] _cues;
        private readonly struct Cue
        {
            internal readonly float Start, End;
            internal readonly string Text;
            internal Cue(float start, float end, string text) { Start = start; End = end; Text = text; }
        }
        private AvatarDanceSubtitles(Cue[] cues) => _cues = cues;
        public int Count => _cues.Length;
        public float EndSeconds => _cues[^1].End;

        public static AvatarDanceSubtitles Read(string path)
        {
            if (string.IsNullOrWhiteSpace(path)) throw new InvalidDataException("舞蹈字幕缺少资源。");
            try
            {
                var size = new FileInfo(path).Length;
                if (size <= 0 || size > MaxBytes) throw new InvalidDataException("舞蹈字幕超过大小限制或为空。");
                var bytes = File.ReadAllBytes(path);
                if (bytes.Length > MaxBytes) throw new InvalidDataException("舞蹈字幕超过大小限制。");
                return Parse(new UTF8Encoding(false, true).GetString(bytes));
            }
            catch (InvalidDataException) { throw; }
            catch (DecoderFallbackException) { throw new InvalidDataException("舞蹈字幕需要有效的 UTF-8 文本。"); }
            catch (UnauthorizedAccessException) { throw new InvalidDataException("舞蹈字幕无法读取，请检查文件权限。"); }
            catch (IOException) { throw new InvalidDataException("舞蹈字幕文件不可用，请重新导入。"); }
        }

        public static AvatarDanceSubtitles Parse(string source)
        {
            if (string.IsNullOrEmpty(source) || Encoding.UTF8.GetByteCount(source) > MaxBytes)
                throw new InvalidDataException("舞蹈字幕超过大小限制或为空。");
            if (source[0] == '\uFEFF') source = source.Substring(1);
            source = source.Replace("\r\n", "\n").Replace('\r', '\n');
            foreach (var ch in source)
                if (char.IsControl(ch) && ch != '\n') throw new InvalidDataException("舞蹈字幕包含无效控制字符。");
            var lines = source.Split('\n');
            var cues = new List<Cue>();
            var cursor = 0; var previousIndex = 0; var previousEnd = 0f;
            while (cursor < lines.Length)
            {
                while (cursor < lines.Length && string.IsNullOrWhiteSpace(lines[cursor])) cursor++;
                if (cursor == lines.Length) break;
                var number = lines[cursor++].Trim();
                if (!Index.IsMatch(number) || !int.TryParse(number, NumberStyles.None, CultureInfo.InvariantCulture, out var index)
                    || index <= previousIndex || (cues.Count == 0 && index != 1) || cursor >= lines.Length)
                    throw new InvalidDataException("舞蹈字幕编号无效，须从 1 开始并严格递增。");
                var timing = Timestamp.Match(lines[cursor++].Trim());
                if (!timing.Success) throw new InvalidDataException("舞蹈字幕时间格式无效。");
                var start = Seconds(timing, 1); var end = Seconds(timing, 5);
                if (end <= start || end > 3600f || start < previousEnd)
                    throw new InvalidDataException("舞蹈字幕时间须递增、互不重叠且不超过一小时。");
                var textStart = cursor;
                while (cursor < lines.Length && !string.IsNullOrWhiteSpace(lines[cursor])) cursor++;
                var text = string.Join("\n", lines, textStart, cursor - textStart).Trim();
                if (text.Length == 0 || CodePoints(text) > 1000 || cues.Count >= 4096)
                    throw new InvalidDataException("舞蹈字幕文本或条目数量不符合限制。");
                cues.Add(new Cue(start, end, text)); previousIndex = index; previousEnd = end;
            }
            if (cues.Count == 0) throw new InvalidDataException("舞蹈字幕没有有效条目。");
            return new AvatarDanceSubtitles(cues.ToArray());
        }

        private static float Seconds(Match timing, int offset)
        {
            int Part(int n) => int.Parse(timing.Groups[offset + n].Value, CultureInfo.InvariantCulture);
            var hours = Part(0); var minutes = Part(1); var seconds = Part(2);
            if (minutes > 59 || seconds > 59) throw new InvalidDataException("舞蹈字幕时间数值无效。");
            return hours * 3600 + minutes * 60 + seconds + Part(3) / 1000f;
        }
        private static int CodePoints(string text)
        {
            var count = 0;
            for (var i = 0; i < text.Length; i++, count++)
            {
                if (!char.IsSurrogate(text[i])) continue;
                if (!char.IsHighSurrogate(text[i]) || i + 1 >= text.Length || !char.IsLowSurrogate(text[++i]))
                    throw new InvalidDataException("舞蹈字幕包含无效文本。");
            }
            return count;
        }

        public void ValidateDuration(float duration)
        {
            if (!float.IsFinite(duration) || duration <= 0f || EndSeconds > duration + .05f)
                throw new InvalidDataException("舞蹈字幕超出动作时长。");
        }
        public string TextAt(float position)
        {
            if (!float.IsFinite(position) || position < 0f) return "";
            var low = 0; var high = _cues.Length - 1; var candidate = -1;
            while (low <= high)
            {
                var middle = low + (high - low) / 2;
                if (_cues[middle].Start <= position) { candidate = middle; low = middle + 1; }
                else high = middle - 1;
            }
            return candidate >= 0 && position < _cues[candidate].End ? _cues[candidate].Text : "";
        }
    }
}
