using System;
using UnityEngine;
using UnityEngine.UIElements;

namespace Katarune.Avatar
{
    internal sealed class AvatarHudDragManipulator : PointerManipulator
    {
        private const float DragThreshold = 5f;
        private const float EdgeInset = 12f;

        private readonly VisualElement _movingElement;
        private readonly VisualElement _boundsElement;
        private readonly Action _clicked;
        private readonly Action<bool> _interactionStateChanged;
        private readonly Action<Rect, Rect> _positionChanged;
        private Vector2 _translation;
        private Vector2 _pointerStart;
        private Vector2 _translationStart;
        private int _pointerId = -1;
        private bool _active;
        private bool _dragging;

        internal bool IsActive => _active;
        internal void RefreshBounds() { if (!_active) ApplyTranslation(_translation); }

        public AvatarHudDragManipulator(
            VisualElement movingElement,
            VisualElement boundsElement,
            Action clicked,
            Action<bool> interactionStateChanged,
            Action<Rect, Rect> positionChanged)
        {
            _movingElement = movingElement ?? throw new ArgumentNullException(nameof(movingElement));
            _boundsElement = boundsElement ?? throw new ArgumentNullException(nameof(boundsElement));
            _clicked = clicked ?? throw new ArgumentNullException(nameof(clicked));
            _interactionStateChanged = interactionStateChanged;
            _positionChanged = positionChanged;
            activators.Add(new ManipulatorActivationFilter { button = MouseButton.LeftMouse });
        }

        protected override void RegisterCallbacksOnTarget()
        {
            target.RegisterCallback<PointerDownEvent>(OnPointerDown);
            target.RegisterCallback<PointerMoveEvent>(OnPointerMove);
            target.RegisterCallback<PointerUpEvent>(OnPointerUp);
            target.RegisterCallback<PointerCaptureOutEvent>(OnPointerCaptureOut);
            _boundsElement.RegisterCallback<GeometryChangedEvent>(OnBoundsChanged);
        }

        protected override void UnregisterCallbacksFromTarget()
        {
            target.UnregisterCallback<PointerDownEvent>(OnPointerDown);
            target.UnregisterCallback<PointerMoveEvent>(OnPointerMove);
            target.UnregisterCallback<PointerUpEvent>(OnPointerUp);
            target.UnregisterCallback<PointerCaptureOutEvent>(OnPointerCaptureOut);
            _boundsElement.UnregisterCallback<GeometryChangedEvent>(OnBoundsChanged);
        }

        private void OnPointerDown(PointerDownEvent evt)
        {
            if (_active || !CanStartManipulation(evt)) return;
            _active = true;
            _dragging = false;
            _pointerId = evt.pointerId;
            _pointerStart = evt.position;
            _translationStart = _translation;
            target.AddToClassList("is-pointer-active");
            target.CapturePointer(_pointerId);
            _interactionStateChanged?.Invoke(true);
            evt.StopImmediatePropagation();
        }

        private void OnPointerMove(PointerMoveEvent evt)
        {
            if (!_active || evt.pointerId != _pointerId || !target.HasPointerCapture(_pointerId)) return;
            UpdatePointerPosition(evt.position);
            evt.StopImmediatePropagation();
        }

        internal void UpdatePointerPosition(Vector2 pointerPosition)
        {
            if (!_active) return;
            var delta = pointerPosition - _pointerStart;
            if (!_dragging && delta.sqrMagnitude < DragThreshold * DragThreshold) return;
            if (!_dragging)
            {
                _dragging = true;
                _movingElement.AddToClassList("is-dragging");
            }
            ApplyTranslation(_translationStart + delta);
        }

        private void OnPointerUp(PointerUpEvent evt)
        {
            if (!_active || evt.pointerId != _pointerId || !CanStopManipulation(evt)) return;
            UpdatePointerPosition(evt.position);
            var shouldClick = !_dragging;
            if (target.HasPointerCapture(_pointerId)) target.ReleasePointer(_pointerId);
            FinishInteraction();
            evt.StopImmediatePropagation();
            if (shouldClick) _clicked();
        }

        private void OnPointerCaptureOut(PointerCaptureOutEvent evt)
        {
            if (!_active || evt.pointerId != _pointerId) return;
            FinishInteraction();
        }

        private void OnBoundsChanged(GeometryChangedEvent _)
        {
            if (!_active) ApplyTranslation(_translation);
        }

        private void ApplyTranslation(Vector2 requested)
        {
            var movingBounds = _movingElement.worldBound;
            var bounds = _boundsElement.worldBound;
            var previousTranslation = _translation;
            var delta = requested - previousTranslation;
            var candidate = new Rect(movingBounds.position + delta, movingBounds.size);

            if (candidate.width + EdgeInset * 2f <= bounds.width)
            {
                if (candidate.xMin < bounds.xMin + EdgeInset)
                    requested.x += bounds.xMin + EdgeInset - candidate.xMin;
                if (candidate.xMax > bounds.xMax - EdgeInset)
                    requested.x -= candidate.xMax - bounds.xMax + EdgeInset;
            }
            if (candidate.height + EdgeInset * 2f <= bounds.height)
            {
                if (candidate.yMin < bounds.yMin + EdgeInset)
                    requested.y += bounds.yMin + EdgeInset - candidate.yMin;
                if (candidate.yMax > bounds.yMax - EdgeInset)
                    requested.y -= candidate.yMax - bounds.yMax + EdgeInset;
            }

            _translation = requested;
            _movingElement.style.translate = new Translate(requested.x, requested.y);
            delta = requested - previousTranslation;
            candidate = new Rect(movingBounds.position + delta, movingBounds.size);
            _positionChanged?.Invoke(candidate, bounds);
        }

        private void FinishInteraction()
        {
            if (!_active) return;
            _active = false;
            _dragging = false;
            _pointerId = -1;
            target.RemoveFromClassList("is-pointer-active");
            _movingElement.RemoveFromClassList("is-dragging");
            _interactionStateChanged?.Invoke(false);
        }
    }
}
