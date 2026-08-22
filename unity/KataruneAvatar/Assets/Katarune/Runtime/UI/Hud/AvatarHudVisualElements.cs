using UnityEngine;
using UnityEngine.UIElements;

namespace Katarune.Avatar
{
    [UxmlElement]
    public partial class AvatarHudIconButton : Button
    {
        private readonly VisualElement _icon;
        private string _iconClass;

        [UxmlAttribute]
        public string iconClass
        {
            get => _iconClass;
            set
            {
                if (_iconClass == value) return;
                if (!string.IsNullOrWhiteSpace(_iconClass)) _icon.RemoveFromClassList(_iconClass);
                _iconClass = value;
                if (!string.IsNullOrWhiteSpace(_iconClass)) _icon.AddToClassList(_iconClass);
            }
        }

        public AvatarHudIconButton()
        {
            usageHints = UsageHints.DynamicTransform | UsageHints.DynamicColor;
            _icon = new VisualElement { pickingMode = PickingMode.Ignore };
            _icon.AddToClassList("radial-icon");
            Add(_icon);
        }
    }

    [UxmlElement]
    public partial class AvatarHudTooltipElement : VisualElement
    {
        private const string VisibleClass = "is-visible";
        private readonly Label _label;
        private VisualElement _anchor;

        public AvatarHudTooltipElement()
        {
            pickingMode = PickingMode.Ignore;
            usageHints = UsageHints.DynamicTransform | UsageHints.DynamicColor;

            _label = new Label { pickingMode = PickingMode.Ignore };
            _label.AddToClassList("hud-tooltip__label");
            hierarchy.Add(_label);
        }

        internal void AttachTo(VisualElement element, string text)
        {
            if (element == null || string.IsNullOrWhiteSpace(text)) return;
            element.AddManipulator(new AvatarHudTooltipManipulator(this, text));
        }

        internal void Show(VisualElement anchor, string text)
        {
            if (anchor == null || !anchor.enabledInHierarchy || string.IsNullOrWhiteSpace(text)) return;
            _anchor = anchor;
            _label.text = text;
            BringToFront();
            AddToClassList(VisibleClass);
            schedule.Execute(PositionAboveAnchor).StartingIn(0);
        }

        internal void Hide(VisualElement anchor = null)
        {
            if (anchor != null && anchor != _anchor) return;
            _anchor = null;
            RemoveFromClassList(VisibleClass);
        }

        private void PositionAboveAnchor()
        {
            if (_anchor?.panel == null || parent == null) return;

            var parentBounds = parent.worldBound;
            var anchorBounds = _anchor.worldBound;
            var width = resolvedStyle.width;
            var height = resolvedStyle.height;
            if (float.IsNaN(width) || float.IsNaN(height) || width < 1f || height < 1f) return;

            const float edgeInset = 8f;
            const float anchorOffset = 8f;
            var left = anchorBounds.center.x - parentBounds.xMin - width * 0.5f;
            var top = anchorBounds.yMin - parentBounds.yMin - height - anchorOffset;
            left = Mathf.Clamp(left, edgeInset, Mathf.Max(edgeInset, parentBounds.width - width - edgeInset));
            top = Mathf.Max(edgeInset, top);
            style.left = left;
            style.top = top;
        }
    }

    [UxmlElement]
    public partial class AvatarHudStarElement : VisualElement
    {
        public AvatarHudStarElement()
        {
            pickingMode = PickingMode.Ignore;
            usageHints = UsageHints.DynamicTransform | UsageHints.DynamicColor;
            generateVisualContent += Draw;
        }

        private void Draw(MeshGenerationContext context)
        {
            var width = contentRect.width;
            var height = contentRect.height;
            if (width < 1f || height < 1f) return;

            var painter = context.painter2D;
            var center = new Vector2(width * 0.5f, height * 0.5f);
            var longRadius = Mathf.Min(width, height) * 0.46f;
            var shortRadius = longRadius * 0.22f;
            painter.fillColor = resolvedStyle.color;
            painter.BeginPath();
            painter.MoveTo(center + new Vector2(0f, -longRadius));
            painter.LineTo(center + new Vector2(shortRadius, -shortRadius));
            painter.LineTo(center + new Vector2(longRadius, 0f));
            painter.LineTo(center + new Vector2(shortRadius, shortRadius));
            painter.LineTo(center + new Vector2(0f, longRadius));
            painter.LineTo(center + new Vector2(-shortRadius, shortRadius));
            painter.LineTo(center + new Vector2(-longRadius, 0f));
            painter.LineTo(center + new Vector2(-shortRadius, -shortRadius));
            painter.ClosePath();
            painter.Fill();
        }
    }
}
