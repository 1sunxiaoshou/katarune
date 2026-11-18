using System;
using UnityEngine;
using UnityEngine.UIElements;

namespace Katarune.Avatar
{
    internal sealed class AvatarLiveDanmaku : IDisposable
    {
        private const int MaxMessages = 4;
        private static readonly int DanmakuTexture = Shader.PropertyToID("_DanmakuTex");
        private static readonly int DanmakuRect = Shader.PropertyToID("_DanmakuRect");
        private const string CoolNickname = "#A8F0F2";
        private const string WarmNickname = "#E3C2FF";
        private static readonly Color MessageColor = new Color(.95f, .96f, 1f);

        [Serializable]
        private sealed class Message
        {
            public string name = "";
            public string text = "";
        }

        [Serializable]
        private sealed class Update
        {
            public Message[] messages = Array.Empty<Message>();
        }

        private readonly Label[] _rows = new Label[MaxMessages];
        private RenderTexture _texture;
        private PanelSettings _panel;
        private GameObject _documentObject;
        internal bool Visible { get; private set; }

        internal void Initialize(int width, int height, Font font, ThemeStyleSheet theme, Material compositor)
        {
            var portrait = width < height;
            var fontSize = Mathf.RoundToInt(Mathf.Min(width, height) * .022f);
            var rowHeight = Mathf.CeilToInt(fontSize * 1.55f);
            var rowPadding = Mathf.RoundToInt(fontSize * .16f);
            var padding = Mathf.CeilToInt(fontSize * .67f);
            var textureWidth = Mathf.RoundToInt(width * (portrait ? .47f : .226f));
            const int bottomPaddingPixel = 1;
            var edgeMargin = Mathf.RoundToInt(width * .022f);
            var left = width - textureWidth - edgeMargin;
            var bottom = edgeMargin - bottomPaddingPixel;
            var extension = Mathf.Max(0, Mathf.RoundToInt(height * (portrait ? .15f : .11f)) - bottom);
            var textureHeight = rowHeight * MaxMessages + 2 * padding + extension + 2;
            var subtitleClearance = portrait ? Mathf.Max(0, Mathf.RoundToInt(height * .10f) - edgeMargin) : 0;
            var bounds = new Vector4(left / (float)width, bottom / (float)height,
                textureWidth / (float)width, textureHeight / (float)height);
            _texture = new RenderTexture(textureWidth, textureHeight, 0, RenderTextureFormat.ARGB32)
            {
                filterMode = FilterMode.Bilinear,
                wrapMode = TextureWrapMode.Clamp,
            };
            _texture.Create();
            compositor.SetTexture(DanmakuTexture, _texture);
            compositor.SetVector(DanmakuRect, bounds);

            _panel = ScriptableObject.CreateInstance<PanelSettings>();
            _panel.targetTexture = _texture;
            _panel.themeStyleSheet = theme;
            _panel.clearColor = true;
            _panel.colorClearValue = Color.clear;
            _panel.scaleMode = PanelScaleMode.ConstantPixelSize;
            _documentObject = new GameObject("Live Danmaku");
            var document = _documentObject.AddComponent<UIDocument>();
            document.panelSettings = _panel;
            var root = document.rootVisualElement;
            root.style.width = textureWidth;
            root.style.height = textureHeight;
            root.style.justifyContent = Justify.FlexEnd;
            root.style.overflow = Overflow.Hidden;

            var panel = new VisualElement { pickingMode = PickingMode.Ignore };
            panel.style.backgroundColor = new Color(.055f, .075f, .135f, .72f);
            panel.style.paddingLeft = padding;
            panel.style.paddingRight = padding;
            panel.style.paddingTop = padding;
            panel.style.paddingBottom = padding + subtitleClearance;
            panel.style.marginBottom = bottomPaddingPixel;
            panel.style.height = textureHeight - bottomPaddingPixel - 1;
            panel.style.flexShrink = 0;
            var radius = Mathf.RoundToInt(fontSize * .5f);
            panel.style.borderTopLeftRadius = radius;
            panel.style.borderTopRightRadius = radius;
            panel.style.borderBottomLeftRadius = radius;
            panel.style.borderBottomRightRadius = radius;
            root.Add(panel);

            var viewport = new VisualElement { pickingMode = PickingMode.Ignore };
            viewport.style.flexGrow = 1;
            viewport.style.minHeight = 0;
            viewport.style.overflow = Overflow.Hidden;
            viewport.style.justifyContent = Justify.FlexEnd;
            panel.Add(viewport);

            for (var index = 0; index < _rows.Length; index++)
            {
                var row = new Label
                {
                    enableRichText = true,
                    parseEscapeSequences = false,
                    pickingMode = PickingMode.Ignore,
                };
                row.style.unityFontDefinition = FontDefinition.FromFont(font);
                row.style.fontSize = fontSize;
                row.style.color = MessageColor;
                row.style.unityTextAlign = TextAnchor.UpperLeft;
                row.style.whiteSpace = WhiteSpace.Normal;
                row.style.minHeight = rowHeight;
                row.style.paddingTop = rowPadding;
                row.style.paddingBottom = rowPadding;
                row.style.flexShrink = 0;
                row.style.display = DisplayStyle.None;

                viewport.Add(row);
                _rows[index] = row;
            }
        }

        private static string LiteralText(string value)
        {
            // Keep angle brackets visible without letting viewer text end the noparse span.
            return "<noparse>" + value.Replace("<", "<\u200B") + "</noparse>";
        }

        internal void SetMessages(string json)
        {
            if (string.IsNullOrEmpty(json) || json.Length > 8192) return;
            var messages = JsonUtility.FromJson<Update>(json)?.messages;
            if (messages == null || messages.Length > MaxMessages) return;
            var count = 0;
            foreach (var message in messages)
            {
                if (message == null || string.IsNullOrWhiteSpace(message.name) ||
                    string.IsNullOrWhiteSpace(message.text) || message.name.Length > 24 || message.text.Length > 160) continue;
                var color = count % 2 == 0 ? CoolNickname : WarmNickname;
                var row = _rows[count++];
                row.text = $"<color={color}>{LiteralText(message.name + "：")}</color>{LiteralText(message.text)}";
                row.style.display = DisplayStyle.Flex;
            }
            for (var index = count; index < _rows.Length; index++)
            {
                _rows[index].style.display = DisplayStyle.None;
            }
            Visible = count > 0;
        }

        public void Dispose()
        {
            if (_documentObject != null)
            {
                _documentObject.SetActive(false);
                UnityEngine.Object.Destroy(_documentObject);
            }
            if (_panel != null) UnityEngine.Object.Destroy(_panel);
            if (_texture == null) return;
            _texture.Release();
            UnityEngine.Object.Destroy(_texture);
        }
    }
}
