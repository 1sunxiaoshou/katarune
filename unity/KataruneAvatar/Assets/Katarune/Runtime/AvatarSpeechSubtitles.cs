using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Katarune.Avatar
{
    [Serializable]
    public sealed class AvatarSpeechSegment
    {
        public string text;
        public float startSeconds;
        public float endSeconds;
    }

    public static class AvatarSpeechSubtitles
    {
        internal const int MaxPageLength = 32;
        private const string Closing = "。！？!?….，,；;：:、”’\"）)]」』】";
        private static bool IsWord(char ch) => ch <= 127 && (char.IsLetterOrDigit(ch) || ch == '\'' || ch == '-');

        internal static string ReadPage(string text, bool complete, out int consumed, out bool ready)
        {
            var start = 0;
            while (start < text.Length && char.IsWhiteSpace(text[start])) start++;
            consumed = start;
            ready = complete;
            if (start == text.Length) return "";
            var elements = StringInfo.ParseCombiningCharacters(text);
            var count = 0;
            var soft = 0;
            var space = 0;
            var end = text.Length;
            var previousSpace = false;
            foreach (var offset in elements)
            {
                if (offset < start) continue;
                var ch = text[offset];
                var whitespace = char.IsWhiteSpace(ch);
                if (!whitespace || !previousSpace) count++;
                previousSpace = whitespace;
                var decimalPoint = ch == '.' && offset > start && offset + 1 < text.Length
                    && char.IsDigit(text[offset - 1]) && char.IsDigit(text[offset + 1]);
                if (ch == '\n' || ch == '\r' || "。！？!?…".IndexOf(ch) >= 0
                    || (ch == '.' && !decimalPoint && (offset + 1 == text.Length || !IsWord(text[offset + 1]))))
                {
                    end = ch == '\n' || ch == '\r' ? offset : offset + 1;
                    break;
                }
                if (count > MaxPageLength)
                {
                    end = soft > start ? soft : space > start ? space : offset;
                    break;
                }
                if ("，,；;：:、".IndexOf(ch) >= 0 && count >= MaxPageLength / 3) soft = offset + 1;
                if (whitespace) space = offset;
            }
            if (end > start && end < text.Length && IsWord(text[end - 1]) && IsWord(text[end]))
                while (end < text.Length && IsWord(text[end])) end++;
            while (end < text.Length)
            {
                var suffix = end;
                while (suffix < text.Length && char.IsWhiteSpace(text[suffix])) suffix++;
                if (suffix == text.Length || Closing.IndexOf(text[suffix]) < 0) break;
                end = suffix + 1;
            }
            ready = complete || end < text.Length;
            if (!ready && end == text.Length && !char.IsPunctuation(text[end - 1]))
                end = Math.Max(start, elements[elements.Length - 1]);
            consumed = end;
            var display = Regex.Replace(text.Substring(start, end - start), @"\s+", " ").Trim();
            display = Regex.Replace(display, @" +([。！？!?….,，；;：:、”’）)\]」』】])", "$1");
            return Regex.Replace(display, @"([“‘（(\[「『【]) +", "$1");
        }

        public static string TextAt(string text, AvatarSpeechSegment[] segments, float position, float duration)
            => new Timeline(text, segments, duration).TextAt(position);

        public sealed class StreamingTimeline
        {
            private readonly string _text;
            private readonly List<(int start, int end, string text)> _pages = new();
            private AvatarSpeechSegment[] _segments;
            private int _covered, _page;
            private float _pageStarted;
            public StreamingTimeline(string text)
            {
                _text = text ?? "";
                var offset = 0;
                while (offset < _text.Length)
                {
                    var page = ReadPage(_text.Substring(offset), true, out var consumed, out _);
                    if (consumed <= 0) break;
                    var start = offset;
                    while (start < offset + consumed && char.IsWhiteSpace(_text[start])) start++;
                    if (page.Length > 0) _pages.Add((start, offset + consumed, page));
                    offset += consumed;
                }
            }
            public string TextAt(float position, AvatarSpeechSegment[] segments, float duration)
            {
                if (_pages.Count == 0) return "";
                if (!ReferenceEquals(segments, _segments))
                {
                    _segments = segments;
                    var prefix = new StringBuilder();
                    if (segments != null) foreach (var segment in segments) prefix.Append(segment?.text);
                    var value = prefix.ToString();
                    _covered = _text.StartsWith(value, StringComparison.Ordinal)
                        && Timeline.ValidAlignment(value, segments, float.MaxValue) ? value.Length : 0;
                }
                float Start(int index) => _covered > _pages[index].start
                    ? Timeline.TimeAt(_pages[index].start, false, _segments)
                    : duration > 0 ? duration * _pages[index].start / _text.Length
                    : _pageStarted + new StringInfo(_pages[_page].text).LengthInTextElements / 9f + 1f;
                if (_page == 0 && _covered > 0 && position < Timeline.TimeAt(_pages[0].start, false, _segments)) return "";
                while (_page + 1 < _pages.Count && position >= Start(_page + 1))
                {
                    _pageStarted = Start(_page + 1); _page++;
                }
                if (duration > 0 && position >= duration) return "";
                if (_page + 1 < _pages.Count && _covered >= _pages[_page].end)
                {
                    var end = Timeline.TimeAt(_pages[_page].end, true, _segments);
                    if (_covered > _pages[_page + 1].start && Start(_page + 1) - end > .8f && position >= end) return "";
                }
                return _pages[_page].text;
            }
        }

        public sealed class Timeline
        {
            private readonly List<(float start, float end, string text)> _pages = new();

            public Timeline(string text, AvatarSpeechSegment[] segments, float duration)
            {
                text ??= "";
                if (duration <= 0 || !float.IsFinite(duration)) return;
                var aligned = ValidAlignment(text, segments, duration);
                var offset = 0;
                while (offset < text.Length)
                {
                    var page = ReadPage(text.Substring(offset), true, out var consumed, out _);
                    if (consumed <= 0) break;
                    var start = offset;
                    var end = offset + consumed;
                    while (start < end && char.IsWhiteSpace(text[start])) start++;
                    while (end > start && char.IsWhiteSpace(text[end - 1])) end--;
                    if (page.Length > 0)
                    {
                        var begin = aligned ? TimeAt(start, false, segments) : duration * start / text.Length;
                        var finish = aligned ? TimeAt(end, true, segments) : duration * end / text.Length;
                        _pages.Add((begin, finish, page));
                    }
                    offset += consumed;
                }
                for (var i = 0; i + 1 < _pages.Count; i++)
                {
                    var page = _pages[i];
                    var next = _pages[i + 1].start;
                    if (next - page.end <= .8f) _pages[i] = (page.start, next, page.text);
                }
            }

            internal static bool ValidAlignment(string text, AvatarSpeechSegment[] segments, float duration)
            {
                if (segments == null || segments.Length == 0) return false;
                var joined = new StringBuilder();
                var previous = 0f;
                foreach (var segment in segments)
                {
                    if (segment == null || string.IsNullOrEmpty(segment.text)
                        || !float.IsFinite(segment.startSeconds) || !float.IsFinite(segment.endSeconds)
                        || segment.startSeconds < previous || segment.endSeconds <= segment.startSeconds
                        || segment.endSeconds > duration + .05f) return false;
                    joined.Append(segment.text);
                    previous = segment.endSeconds;
                }
                return joined.ToString() == text;
            }

            internal static float TimeAt(int offset, bool end, AvatarSpeechSegment[] segments)
            {
                var cursor = 0;
                foreach (var segment in segments)
                {
                    var next = cursor + segment.text.Length;
                    if (offset < next || (end && offset == next))
                    {
                        var contentEnd = next;
                        while (contentEnd > cursor && char.IsWhiteSpace(segment.text[contentEnd - cursor - 1])) contentEnd--;
                        if (end && offset >= contentEnd) return segment.endSeconds;
                        return segment.startSeconds + (segment.endSeconds - segment.startSeconds)
                            * (offset - cursor) / Math.Max(1, contentEnd - cursor);
                    }
                    cursor = next;
                }
                return segments[segments.Length - 1].endSeconds;
            }

            public string TextAt(float position)
            {
                foreach (var page in _pages)
                {
                    if (position < page.start) return "";
                    if (position < page.end) return page.text;
                }
                return "";
            }
        }
    }
}
