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
        public void HudAssetsContainEveryRequiredControlAndRuntimeResource()
        {
            var tree = AssetDatabase.LoadAssetAtPath<VisualTreeAsset>(HudPath + "/AvatarHud.uxml");
            var panel = AssetDatabase.LoadAssetAtPath<PanelSettings>(HudPath + "/AvatarHudPanelSettings.asset");
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Katarune/Resources/AvatarHud.prefab");
            Assert.That(tree, Is.Not.Null);
            Assert.That(panel, Is.Not.Null);
            Assert.That(panel.scaleMode, Is.EqualTo(PanelScaleMode.ScaleWithScreenSize));
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
            var radialMenu = root.Q<AvatarRadialMenu>("radialStage");
            Assert.That(radialMenu, Is.Not.Null);
            Assert.That(radialMenu.primaryRadius, Is.EqualTo(112f));
            Assert.That(radialMenu.secondaryRadius, Is.EqualTo(184f));
            Assert.That(radialMenu.sideSweepAngle, Is.EqualTo(180f));
            Assert.That(radialMenu.cornerSweepAngle, Is.EqualTo(90f));
            Assert.That(radialMenu.edgePadding, Is.EqualTo(16f));
            Assert.That(root.Q<AvatarHudStarElement>(className: "central-star-art"), Is.Not.Null);
            Assert.That(root.Q<VisualElement>("portraitFrame"), Is.Not.Null);
            Assert.That(root.Q<VisualElement>("statusHud").ClassListContains("is-status-hidden"), Is.True);
            Assert.That(root.Q<VisualElement>("behaviorCapsule"), Is.Not.Null);
            Assert.That(root.Q<Label>("modelNameLabel"), Is.Not.Null);
            Assert.That(root.Q<VisualElement>("affectStatusIcon"), Is.Not.Null);
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

        [TestCase(40f, 40f, AvatarRadialMenuDirection.DownRight)]
        [TestCase(1880f, 40f, AvatarRadialMenuDirection.DownLeft)]
        [TestCase(40f, 1040f, AvatarRadialMenuDirection.UpRight)]
        [TestCase(1880f, 1040f, AvatarRadialMenuDirection.UpLeft)]
        [TestCase(40f, 540f, AvatarRadialMenuDirection.Right)]
        [TestCase(1880f, 540f, AvatarRadialMenuDirection.Left)]
        [TestCase(960f, 40f, AvatarRadialMenuDirection.Down)]
        [TestCase(960f, 540f, AvatarRadialMenuDirection.Up)]
        [TestCase(960f, 1040f, AvatarRadialMenuDirection.Up)]
        public void RadialMenuFacesIntoAvailableScreenSpace(
            float centerX,
            float centerY,
            AvatarRadialMenuDirection expected)
        {
            var anchor = new Rect(centerX - 37f, centerY - 37f, 74f, 74f);
            var screen = new Rect(0f, 0f, 1920f, 1080f);
            Assert.That(
                AvatarRadialMenu.ResolveDirection(anchor, screen, 223f),
                Is.EqualTo(expected));
        }

        [Test]
        public void RadialMenuCentersShortGroupsWithinTheAvailableArc()
        {
            var first = AvatarRadialMenu.CalculateItemOffset(
                AvatarRadialMenuDirection.Up,
                184f,
                180f,
                0,
                3,
                6);
            var middle = AvatarRadialMenu.CalculateItemOffset(
                AvatarRadialMenuDirection.Up,
                184f,
                180f,
                1,
                3,
                6);
            var last = AvatarRadialMenu.CalculateItemOffset(
                AvatarRadialMenuDirection.Up,
                184f,
                180f,
                2,
                3,
                6);

            Assert.That(first.x, Is.EqualTo(-last.x).Within(0.01f));
            Assert.That(first.y, Is.EqualTo(last.y).Within(0.01f));
            Assert.That(middle.x, Is.EqualTo(0f).Within(0.01f));
            Assert.That(middle.y, Is.EqualTo(-184f).Within(0.01f));
        }

        [Test]
        public void CornerLayoutKeepsEveryItemInsideTheSelectedQuadrant()
        {
            for (var index = 0; index < 5; index++)
            {
                var offset = AvatarRadialMenu.CalculateItemOffset(
                    AvatarRadialMenuDirection.DownRight,
                    112f,
                    90f,
                    index,
                    5,
                    5);
                Assert.That(offset.x, Is.GreaterThanOrEqualTo(-0.01f));
                Assert.That(offset.y, Is.GreaterThanOrEqualTo(-0.01f));
            }
        }

        [TestCase(40f, 40f, 1280f, 720f)]
        [TestCase(1240f, 40f, 1280f, 720f)]
        [TestCase(40f, 680f, 1280f, 720f)]
        [TestCase(1240f, 680f, 1280f, 720f)]
        [TestCase(40f, 360f, 1280f, 720f)]
        [TestCase(1240f, 360f, 1280f, 720f)]
        [TestCase(640f, 40f, 1280f, 720f)]
        [TestCase(640f, 680f, 1280f, 720f)]
        [TestCase(3400f, 720f, 3440f, 1440f)]
        public void RadialMenuKeepsOuterRingInsideTheScreen(
            float centerX,
            float centerY,
            float screenWidth,
            float screenHeight)
        {
            const float buttonHalfSize = 23f;
            const float edgePadding = 16f;
            var anchor = new Rect(centerX - 37f, centerY - 37f, 74f, 74f);
            var screen = new Rect(0f, 0f, screenWidth, screenHeight);
            var direction = AvatarRadialMenu.ResolveDirection(anchor, screen, 223f);

            for (var index = 0; index < 6; index++)
            {
                var sweep = direction is AvatarRadialMenuDirection.DownRight
                    or AvatarRadialMenuDirection.DownLeft
                    or AvatarRadialMenuDirection.UpRight
                    or AvatarRadialMenuDirection.UpLeft
                    ? 90f
                    : 180f;
                var offset = AvatarRadialMenu.CalculateItemOffset(
                    direction,
                    184f,
                    sweep,
                    index,
                    6,
                    6);
                var itemBounds = new Rect(
                    centerX + offset.x - buttonHalfSize,
                    centerY + offset.y - buttonHalfSize,
                    buttonHalfSize * 2f,
                    buttonHalfSize * 2f);
                Assert.That(itemBounds.xMin, Is.GreaterThanOrEqualTo(edgePadding - 0.01f));
                Assert.That(itemBounds.yMin, Is.GreaterThanOrEqualTo(edgePadding - 0.01f));
                Assert.That(itemBounds.xMax, Is.LessThanOrEqualTo(screenWidth - edgePadding + 0.01f));
                Assert.That(itemBounds.yMax, Is.LessThanOrEqualTo(screenHeight - edgePadding + 0.01f));
            }
        }

        private static readonly IReadOnlyList<string> RequiredButtons = new[]
        {
            "centralMenuButton",
            "modelCategoryButton", "affectCategoryButton", "actionCategoryButton",
            "moreCategoryButton",
            "selectModelButton", "reloadModelButton", "unloadModelButton",
            "neutralAffectButton", "happyAffectButton", "relaxedAffectButton",
            "sadAffectButton", "angryAffectButton", "surprisedAffectButton",
            "greetWaveButton", "explainButton", "celebrateButton", "coughButton", "cancelActionButton",
            "lightDesktopButton", "darkDesktopButton", "softOutlineButton", "statusHudButton", "resetBehaviorButton",
        };

        private static readonly IReadOnlyList<string> RequiredIcons = new[]
        {
            "model", "affect", "action", "more",
            "neutral", "happy", "relaxed", "sad", "angry", "surprised",
            "folder-open", "refresh-cw", "trash-2",
            "hand", "message-circle-more", "party-popper", "wind", "circle-stop",
            "sun", "moon", "circle-dashed", "panel-top", "rotate-ccw",
        };
    }
}
