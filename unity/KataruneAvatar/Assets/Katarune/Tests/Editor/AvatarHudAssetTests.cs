using System.Collections.Generic;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using UnityEngine.UIElements;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarHudAssetTests
    {
        [Test]
        public void WindowHitTestOnlyAcceptsEnabledButtonHierarchy()
        {
            var root = new VisualElement();
            var decoration = new VisualElement();
            var button = new Button();
            var icon = new VisualElement();
            root.Add(decoration);
            root.Add(button);
            button.Add(icon);

            Assert.That(AvatarWindow.IsInteractivePick(decoration, root), Is.False);
            Assert.That(AvatarWindow.IsInteractivePick(icon, root), Is.True);

            button.SetEnabled(false);
            Assert.That(AvatarWindow.IsInteractivePick(icon, root), Is.False);
            Assert.That(AvatarWindow.IsInteractivePick(null, root), Is.False);
        }

        private const string HudPath = "Assets/Katarune/Runtime/UI/Hud";

        [Test]
        public void ControlIconsKeepTheirSharedCanvasAfterVectorImport()
        {
            foreach (var name in new[] { "chevrons-right", "message-circle-more", "mic", "mic-off", "ellipsis" })
            {
                var icon = AssetDatabase.LoadAssetAtPath<VectorImage>($"{HudPath}/Icons/{name}.svg");
                Assert.That(icon, Is.Not.Null, name);
                Assert.That(icon.width, Is.EqualTo(24).Within(0.01), name);
                Assert.That(icon.height, Is.EqualTo(24).Within(0.01), name);
            }
        }

        [Test]
        public void HudAssetsContainEveryRequiredControlAndRuntimeResource()
        {
            var tree = AssetDatabase.LoadAssetAtPath<VisualTreeAsset>(HudPath + "/AvatarHud.uxml");
            var panel = AssetDatabase.LoadAssetAtPath<PanelSettings>(HudPath + "/AvatarHudPanelSettings.asset");
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Katarune/Resources/AvatarHud.prefab");
            Assert.That(tree, Is.Not.Null);
            Assert.That(panel, Is.Not.Null);
            Assert.That(panel.scaleMode, Is.EqualTo(PanelScaleMode.ConstantPixelSize));
            Assert.That(panel.referenceResolution, Is.EqualTo(new Vector2Int(1920, 1080)));
            Assert.That(prefab, Is.Not.Null);
            Assert.That(prefab.GetComponent<UIDocument>(), Is.Not.Null);
            Assert.That(prefab.GetComponent<AvatarHudController>(), Is.Not.Null);

            var root = tree.Instantiate();
            foreach (var name in RequiredButtons)
            {
                Assert.That(root.Q<Button>(name), Is.Not.Null, name);
            }
            Assert.That(root.Q<AvatarHudTooltipElement>("hudTooltip"), Is.Not.Null);
            Assert.That(root.Q<AvatarHudIconButton>("centralMenuButton"), Is.Not.Null);
            Assert.That(root.Q<ScrollView>("hudPanelScroll"), Is.Not.Null);
            Assert.That(root.Q<DropdownField>("uiScaleField"), Is.Not.Null);
            foreach (var name in new[] { "gazeTrackingToggle", "showcaseControlToggle", "softOutlineToggle" })
                Assert.That(root.Q<Toggle>(name), Is.Not.Null);
            Assert.That(root.Q<Label>("modelNameLabel"), Is.Not.Null);
            Assert.That(root.Q<Label>("actionLabel"), Is.Not.Null);
            Assert.That(root.Q<Label>("noticeLabel"), Is.Not.Null);
            root.Query<AvatarHudIconButton>().ForEach(button =>
            {
                Assert.That(button.text, Is.Null.Or.Empty, button.name);
                Assert.That(button.tooltip, Is.Not.Empty, button.name);
            });
        }

        [Test]
        public void HudFontsAndIconsImportAsNativeUiToolkitAssets()
        {
            Assert.That(
                AssetDatabase.LoadAssetAtPath<Font>(HudPath + "/Fonts/NotoSansSC-Regular.ttf"),
                Is.Not.Null);
            foreach (var icon in RequiredIcons)
            {
                Assert.That(
                    AssetDatabase.LoadAssetAtPath<VectorImage>($"{HudPath}/Icons/{icon}.svg"),
                    Is.Not.Null,
                    icon);
            }
        }

        [TestCase(360, 280)]
        [TestCase(800, 600)]
        [TestCase(1280, 720)]
        [TestCase(1920, 1080)]
        [TestCase(3440, 1440)]
        public void PanelStaysInsideViewportAtEveryEdge(float width, float height)
        {
            foreach (var x in new[] { 12f, (width - 264) / 2, width - 276 })
            foreach (var y in new[] { 12f, (height - 104) / 2, height - 116 })
            {
                var dock = new Rect(x, y, 264, 104);
                var panel = AvatarHudLayout.PlacePanel(dock, new Vector2(width, height));
                Assert.That(panel.xMin, Is.GreaterThanOrEqualTo(12));
                Assert.That(panel.yMin, Is.GreaterThanOrEqualTo(12));
                Assert.That(panel.xMax, Is.LessThanOrEqualTo(width - 12));
                Assert.That(panel.yMax, Is.LessThanOrEqualTo(height - 12));
                Assert.That(panel.Overlaps(dock), Is.False);
            }
        }

        [TestCase(96, 1920, 1080, 1)]
        [TestCase(144, 1920, 1080, 1.5f)]
        [TestCase(192, 3840, 2160, 2)]
        [TestCase(192, 800, 600, 2)]
        public void HudScaleTracksDpiIndependentlyOfResolution(float dpi, float width, float height, float expected)
        {
            Assert.That(AvatarHudLayout.Scale(dpi, 1, width, height), Is.EqualTo(expected).Within(0.01));
        }

        private static readonly IReadOnlyList<string> RequiredButtons = new[]
        {
            "centralMenuButton",
            "modelCategoryButton", "affectCategoryButton", "actionCategoryButton",
            "moreCategoryButton",
            "selectModelButton", "reloadModelButton", "unloadModelButton",
            "neutralAffectButton", "happyAffectButton", "relaxedAffectButton",
            "sadAffectButton", "angryAffectButton", "surprisedAffectButton",
            "openChatButton", "voiceToggleButton", "compactVoiceButton", "quickMoreButton", "closePanelButton", "cancelActionButton",
            "resetBehaviorButton", "shortcutsCategoryButton",
        };

        private static readonly IReadOnlyList<string> RequiredIcons = new[]
        {
            "model", "affect", "action", "eye", "showcase-turntable", "more",
            "neutral", "happy", "relaxed", "sad", "angry", "surprised",
            "folder-open", "refresh-cw", "trash-2",
            "hand", "message-circle-more", "party-popper", "wind", "circle-stop",
            "circle-dashed", "panel-top", "rotate-ccw",
        };
    }
}
