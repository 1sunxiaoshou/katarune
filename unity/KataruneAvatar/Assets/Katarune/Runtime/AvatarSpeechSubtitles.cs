using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using UnityEngine;

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
        internal static class Layout
        {
            internal static readonly string[] FontFamilies={ "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", "Arial" };
            internal static int FontSize(float scale) => Mathf.RoundToInt(18f*scale);
            internal static float HorizontalPadding(float scale) => 16f*scale;
            internal static float VerticalPadding(float scale) => 10f*scale;
            internal static float Radius(float scale) => 14f*scale;
            internal static float MaxWidth(float width,float scale,bool wide) => Mathf.Max(1f,Mathf.Min((wide?960f:480f)*scale,width*(wide?.8f:.6f)));
            internal static float BottomMargin(float height,float scale) => Mathf.Max(24f*scale,height*.045f);
        }
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
            private int _covered;
            private int _page = -1;
            private bool _pageEnded;
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
                    var end = offset + consumed;
                    while (end > start && char.IsWhiteSpace(_text[end - 1])) end--;
                    if (page.Length > 0) _pages.Add((start, end, page));
                    offset += consumed;
                }
            }
            public string TextAt(float position, AvatarSpeechSegment[] segments, float duration)
            {
                if (_pages.Count == 0) return "";
                if (!ReferenceEquals(segments, _segments))
                {
                    _segments = segments;
                    _covered = Timeline.AlignedLength(_text, segments);
                }
                float Start(int index) => _covered > _pages[index].start
                    ? Timeline.TimeAt(_pages[index].start, false, _segments)
                    : duration > 0 ? duration * _pages[index].start / _text.Length
                    : float.PositiveInfinity;
                float End(int index) => _covered >= _pages[index].end
                    ? Timeline.TimeAt(_pages[index].end, true, _segments)
                    : duration > 0 ? duration * _pages[index].end / _text.Length
                    : float.PositiveInfinity;
                if (_page < 0 && _covered > 0 && position < Start(0)) return "";
                // Advance at the next page's start and clear at this page's end.
                // An ended page never makes an earlier page current again.
                var page = Math.Max(0, _page);
                while (page + 1 < _pages.Count && position >= Start(page + 1)) page++;
                if (page != _page) { _page = page; _pageEnded = false; }
                if (position >= End(page)) _pageEnded = true;
                return _pageEnded ? "" : _pages[page].text;
            }
        }

        public sealed class Timeline
        {
            private readonly StreamingTimeline _timeline;
            private readonly AvatarSpeechSegment[] _segments;
            private readonly float _duration;

            public Timeline(string text, AvatarSpeechSegment[] segments, float duration)
            {
                if (duration <= 0 || !float.IsFinite(duration)) return;
                _timeline = new StreamingTimeline(text);
                _segments = segments;
                _duration = duration;
            }

            internal static int AlignedLength(string text, AvatarSpeechSegment[] segments)
            {
                if (segments == null || segments.Length == 0) return 0;
                var joined = new StringBuilder();
                foreach (var segment in segments)
                {
                    if (segment == null || string.IsNullOrEmpty(segment.text)) return 0;
                    joined.Append(segment.text);
                }
                var prefix = joined.ToString();
                return text.StartsWith(prefix, StringComparison.Ordinal) ? prefix.Length : 0;
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

            public string TextAt(float position) => _timeline?.TextAt(position, _segments, _duration) ?? "";
        }
    }
}
