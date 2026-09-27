using UnityEngine.UIElements;

namespace Katarune.Avatar
{
    internal sealed class AvatarHudTransition
    {
        private readonly VisualElement _element;
        private IVisualElementScheduledItem _pending;

        internal AvatarHudTransition(VisualElement element) => _element = element;

        internal void Show()
        {
            _pending?.Pause();
            var wasHidden = !_element.ClassListContains("is-visible");
            if (wasHidden) _element.AddToClassList("is-entering");
            _element.AddToClassList("is-visible");
            _element.SetEnabled(true);
            _pending = _element.schedule.Execute(() => _element.RemoveFromClassList("is-entering")).StartingIn(20);
        }

        internal void Hide(bool immediate = false)
        {
            _pending?.Pause();
            _element.SetEnabled(false);
            _element.AddToClassList("is-entering");
            if (immediate) _element.RemoveFromClassList("is-visible");
            // The More panel uses the same 100 ms exit as the Electron popover.
            else _pending = _element.schedule.Execute(() => _element.RemoveFromClassList("is-visible")).StartingIn(100);
        }
    }
}
