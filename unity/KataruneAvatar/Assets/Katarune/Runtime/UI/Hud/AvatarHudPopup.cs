using UnityEngine.UIElements;

namespace Katarune.Avatar
{
    internal static class AvatarHudPopup
    {
        internal static void InstallTheme(VisualElement documentRoot)
        {
            var panelRoot = documentRoot.panel?.visualTree;
            if (panelRoot == null) return;
            for (var i = 0; i < documentRoot.styleSheets.count; i++)
            {
                var sheet = documentRoot.styleSheets[i];
                if (sheet.name == "AvatarHudTheme" && !panelRoot.styleSheets.Contains(sheet))
                    panelRoot.styleSheets.Add(sheet);
            }
        }

        internal static bool IsOwnedMenu(VisualElement element, VisualElement hudRoot)
        {
            if (!element.ClassListContains(GenericDropdownMenu.ussClassName)) return false;
            var content = element.Q<ScrollView>(className: GenericDropdownMenu.containerInnerUssClassName)?.contentContainer;
            return content?.userData is GenericDropdownMenu menu && menu.targetElement != null
                && hudRoot.Contains(menu.targetElement) && menu.targetElement.enabledInHierarchy;
        }

        internal static void Close(VisualElement hudRoot)
        {
            var menu = hudRoot?.panel?.visualTree.Q(className: GenericDropdownMenu.ussClassName);
            if (menu == null || !IsOwnedMenu(menu, hudRoot)) return;
            var content = menu.Q<ScrollView>(className: GenericDropdownMenu.containerInnerUssClassName)?.contentContainer;
            using var cancel = NavigationCancelEvent.GetPooled();
            content?.SendEvent(cancel);
        }
    }
}
