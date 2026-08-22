using System;
using UnityEngine;
using UnityEngine.UIElements;

namespace Katarune.Avatar
{
    public enum AvatarRadialMenuDirection
    {
        Up,
        Right,
        Down,
        Left,
        DownRight,
        DownLeft,
        UpRight,
        UpLeft,
    }

    [UxmlElement]
    public partial class AvatarRadialMenu : VisualElement
    {
        private const float PrimaryItemSize = 52f;
        private const float SecondaryItemSize = 46f;
        private const int PrimaryCapacity = 5;
        private const int SecondaryCapacity = 6;

        private float _primaryRadius = 112f;
        private float _secondaryRadius = 184f;
        private float _sideSweepAngle = 180f;
        private float _cornerSweepAngle = 90f;
        private float _edgePadding = 16f;
        private AvatarRadialMenuDirection _defaultDirection = AvatarRadialMenuDirection.Up;
        private VisualElement _panelRoot;
        private bool _layoutInitialized;

        [UxmlAttribute]
        public float primaryRadius
        {
            get => _primaryRadius;
            set => SetLayoutValue(ref _primaryRadius, value, 1f);
        }

        [UxmlAttribute]
        public float secondaryRadius
        {
            get => _secondaryRadius;
            set => SetLayoutValue(ref _secondaryRadius, value, 1f);
        }

        [UxmlAttribute]
        public float sideSweepAngle
        {
            get => _sideSweepAngle;
            set => SetLayoutValue(ref _sideSweepAngle, value, 1f, 360f);
        }

        [UxmlAttribute]
        public float cornerSweepAngle
        {
            get => _cornerSweepAngle;
            set => SetLayoutValue(ref _cornerSweepAngle, value, 1f, 180f);
        }

        [UxmlAttribute]
        public float edgePadding
        {
            get => _edgePadding;
            set => SetLayoutValue(ref _edgePadding, value, 0f);
        }

        [UxmlAttribute]
        public AvatarRadialMenuDirection defaultDirection
        {
            get => _defaultDirection;
            set
            {
                if (_defaultDirection == value) return;
                _defaultDirection = value;
                _layoutInitialized = false;
                RefreshPlacement();
            }
        }

        public AvatarRadialMenuDirection Direction { get; private set; } = AvatarRadialMenuDirection.Up;

        public event Action<AvatarRadialMenuDirection> DirectionChanged;

        public AvatarRadialMenu()
        {
            pickingMode = PickingMode.Ignore;
            usageHints = UsageHints.DynamicTransform;
            RegisterCallback<AttachToPanelEvent>(OnAttachToPanel);
            RegisterCallback<DetachFromPanelEvent>(OnDetachFromPanel);
            RegisterCallback<GeometryChangedEvent>(_ => RefreshPlacement());
        }

        public void RefreshLayout()
        {
            LayoutGroup(this.Q<VisualElement>("primaryMenu"), true);
            this.Query<VisualElement>(className: "secondary-menu")
                .ForEach(group => LayoutGroup(group, false));
            _layoutInitialized = true;
        }

        public void RefreshPlacement()
        {
            if (panel == null) return;
            var bounds = panel.visualTree.worldBound;
            if (bounds.width < 1f || bounds.height < 1f || worldBound.width < 1f) return;
            UpdatePlacement(worldBound, bounds);
        }

        public void UpdatePlacement(Rect anchorBounds, Rect screenBounds)
        {
            var direction = ResolveDirection(
                anchorBounds,
                screenBounds,
                RequiredEdgeExtent,
                _defaultDirection);
            var directionChanged = Direction != direction;
            if (directionChanged)
            {
                Direction = direction;
                DirectionChanged?.Invoke(direction);
            }
            if (!_layoutInitialized || directionChanged) RefreshLayout();
        }

        internal float RequiredEdgeExtent =>
            Mathf.Max(_primaryRadius + PrimaryItemSize * 0.5f, _secondaryRadius + SecondaryItemSize * 0.5f)
            + _edgePadding;

        internal static AvatarRadialMenuDirection ResolveDirection(
            Rect anchorBounds,
            Rect screenBounds,
            float requiredExtent,
            AvatarRadialMenuDirection defaultDirection = AvatarRadialMenuDirection.Up)
        {
            var center = anchorBounds.center;
            var leftSpace = center.x - screenBounds.xMin;
            var rightSpace = screenBounds.xMax - center.x;
            var topSpace = center.y - screenBounds.yMin;
            var bottomSpace = screenBounds.yMax - center.y;

            var nearLeft = leftSpace < requiredExtent;
            var nearRight = rightSpace < requiredExtent;
            var nearTop = topSpace < requiredExtent;
            var nearBottom = bottomSpace < requiredExtent;

            if (nearLeft && nearRight)
            {
                nearLeft = leftSpace <= rightSpace;
                nearRight = !nearLeft;
            }
            if (nearTop && nearBottom)
            {
                nearTop = topSpace <= bottomSpace;
                nearBottom = !nearTop;
            }

            if (nearLeft && nearTop) return AvatarRadialMenuDirection.DownRight;
            if (nearRight && nearTop) return AvatarRadialMenuDirection.DownLeft;
            if (nearLeft && nearBottom) return AvatarRadialMenuDirection.UpRight;
            if (nearRight && nearBottom) return AvatarRadialMenuDirection.UpLeft;
            if (nearLeft) return AvatarRadialMenuDirection.Right;
            if (nearRight) return AvatarRadialMenuDirection.Left;
            if (nearTop) return AvatarRadialMenuDirection.Down;
            if (nearBottom) return AvatarRadialMenuDirection.Up;
            return defaultDirection;
        }

        internal static Vector2 CalculateItemOffset(
            AvatarRadialMenuDirection direction,
            float radius,
            float sweepAngle,
            int itemIndex,
            int itemCount,
            int capacity)
        {
            if (itemCount <= 0 || itemIndex < 0 || itemIndex >= itemCount)
                throw new ArgumentOutOfRangeException(nameof(itemIndex));
            if (capacity < itemCount || capacity < 1)
                throw new ArgumentOutOfRangeException(nameof(capacity));

            var centerAngle = GetCenterAngle(direction);
            var step = capacity == 1 ? 0f : sweepAngle / (capacity - 1);
            var usedSweep = step * (itemCount - 1);
            var angle = centerAngle - usedSweep * 0.5f + step * itemIndex;
            var radians = angle * Mathf.Deg2Rad;
            return new Vector2(Mathf.Cos(radians), Mathf.Sin(radians)) * radius;
        }

        private void LayoutGroup(VisualElement group, bool primary)
        {
            if (group == null) return;
            var count = group.childCount;
            if (count == 0) return;

            var radius = primary ? _primaryRadius : _secondaryRadius;
            var size = primary ? PrimaryItemSize : SecondaryItemSize;
            var capacity = primary ? PrimaryCapacity : SecondaryCapacity;
            capacity = Mathf.Max(capacity, count);
            var sweep = IsCorner(Direction) ? _cornerSweepAngle : _sideSweepAngle;
            var anchorCenter = new Vector2(contentRect.width * 0.5f, contentRect.height * 0.5f);
            if (anchorCenter.x < 1f || anchorCenter.y < 1f) anchorCenter = new Vector2(37f, 37f);

            for (var index = 0; index < count; index++)
            {
                var item = group.ElementAt(index);
                var offset = CalculateItemOffset(Direction, radius, sweep, index, count, capacity);
                item.style.left = anchorCenter.x + offset.x - size * 0.5f;
                item.style.top = anchorCenter.y + offset.y - size * 0.5f;
            }
        }

        private void OnAttachToPanel(AttachToPanelEvent _)
        {
            _panelRoot = panel?.visualTree;
            _panelRoot?.RegisterCallback<GeometryChangedEvent>(OnPanelGeometryChanged);
            schedule.Execute(RefreshPlacement).StartingIn(0);
        }

        private void OnDetachFromPanel(DetachFromPanelEvent _)
        {
            _panelRoot?.UnregisterCallback<GeometryChangedEvent>(OnPanelGeometryChanged);
            _panelRoot = null;
        }

        private void OnPanelGeometryChanged(GeometryChangedEvent _) => RefreshPlacement();

        private void SetLayoutValue(ref float field, float value, float minimum, float maximum = float.MaxValue)
        {
            value = Mathf.Clamp(value, minimum, maximum);
            if (Mathf.Approximately(field, value)) return;
            field = value;
            _layoutInitialized = false;
            RefreshPlacement();
        }

        private static bool IsCorner(AvatarRadialMenuDirection direction)
        {
            return direction is AvatarRadialMenuDirection.DownRight
                or AvatarRadialMenuDirection.DownLeft
                or AvatarRadialMenuDirection.UpRight
                or AvatarRadialMenuDirection.UpLeft;
        }

        private static float GetCenterAngle(AvatarRadialMenuDirection direction)
        {
            return direction switch
            {
                AvatarRadialMenuDirection.Right => 0f,
                AvatarRadialMenuDirection.DownRight => 45f,
                AvatarRadialMenuDirection.Down => 90f,
                AvatarRadialMenuDirection.DownLeft => 135f,
                AvatarRadialMenuDirection.Left => 180f,
                AvatarRadialMenuDirection.UpLeft => -135f,
                AvatarRadialMenuDirection.UpRight => -45f,
                _ => -90f,
            };
        }
    }
}
