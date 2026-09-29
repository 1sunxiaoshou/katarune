using System.Collections;
using System;
using System.Threading;
using System.Threading.Tasks;
using System.IO;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UIElements;
using Object = UnityEngine.Object;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarRuntimePlayModeTests
    {
        [UnityTest]
        public IEnumerator HudHoverFadeNeverBecomesDarkerThanItsTarget()
        {
            var go = Object.Instantiate(Resources.Load<GameObject>("AvatarHud"));
            try
            {
                var hud = go.GetComponent<AvatarHudController>();
                hud.Configure(FakeRuntimeFacade.CreateReady(), true);
                yield return new WaitForSecondsRealtime(0.25f);
                var button = hud.RootElement.Q<Button>("quickMoreButton");
                var idle = button.resolvedStyle.backgroundColor;
                var hover = new Color(245f / 255, 245f / 255, 245f / 255, 1);
                foreach (var target in new[] { hover, idle })
                {
                    button.EnableInClassList("is-selected", target.a > 0);
                    var until = Time.realtimeSinceStartup + 0.22f;
                    var intermediateFrames = 0;
                    while (Time.realtimeSinceStartup < until)
                    {
                        yield return null;
                        var color = button.resolvedStyle.backgroundColor;
                        if (color.a > 0.01f && color.a < 0.99f) intermediateFrames++;
                        var overWhite = color.r * color.a + 1 - color.a;
                        Assert.That(overWhite, Is.GreaterThanOrEqualTo(245f / 255 - 0.005f),
                            "Hover must not flash dark during RGBA interpolation.");
                    }
                    Assert.That(intermediateFrames, Is.GreaterThan(0), "Sample real transition frames, not just endpoints.");
                }
            }
            finally { Object.Destroy(go); }
        }

        [UnityTest]
        public IEnumerator HudOnlyShowsFocusForKeyboardAndShadowsNeverCaptureInput()
        {
            var go = Object.Instantiate(Resources.Load<GameObject>("AvatarHud"));
            try
            {
                var hud = go.GetComponent<AvatarHudController>();
                hud.Configure(FakeRuntimeFacade.CreateReady(), true);
                var root = hud.RootElement;
                var button = root.Q<Button>("openChatButton");
                yield return new WaitForSecondsRealtime(0.25f);
                button.Focus();
                yield return null;
                Assert.That(button.resolvedStyle.borderLeftColor.a, Is.EqualTo(0));
                using (var key = KeyDownEvent.GetPooled('\t', KeyCode.Tab, EventModifiers.None)) root.SendEvent(key);
                button.Focus();
                yield return null;
                Assert.That(button.resolvedStyle.borderLeftColor.a, Is.EqualTo(1));
                var pointer = new Event { mousePosition = button.worldBound.center, button = 0, type = EventType.MouseDown };
                using (var down = PointerDownEvent.GetPooled(pointer)) button.SendEvent(down);
                pointer.type = EventType.MouseUp;
                using (var up = PointerUpEvent.GetPooled(pointer)) button.SendEvent(up);
                yield return null;
                Assert.That(button.resolvedStyle.borderLeftColor.a, Is.EqualTo(0));
                Assert.That(button.ClassListContains("is-selected"), Is.False);
                foreach (var name in new[] { "dockShadow", "panelShadow" })
                {
                    var shadow = root.Q<AvatarHudShadow>(name);
                    Assert.That(shadow, Is.Not.Null);
                    Assert.That(shadow.pickingMode, Is.EqualTo(PickingMode.Ignore));
                    Assert.That(AvatarWindow.IsInteractivePick(shadow, root), Is.False);
                }
            }
            finally { Object.Destroy(go); }
        }

        [UnityTest]
        public IEnumerator HudSwitchThumbStaysCenteredAcrossValueAndFocusChanges()
        {
            var go = Object.Instantiate(Resources.Load<GameObject>("AvatarHud"));
            try
            {
                var hud = go.GetComponent<AvatarHudController>();
                hud.Configure(FakeRuntimeFacade.CreateReady(), true);
                yield return new WaitForSecondsRealtime(0.25f);
                Click(hud, "quickMoreButton");
                Click(hud, "moreCategoryButton");
                yield return new WaitForSecondsRealtime(0.35f);
                var toggle = hud.RootElement.Q<Toggle>("gazeTrackingToggle");
                var track = toggle.Q(className: "unity-base-field__input");
                var thumb = toggle.Q(className: "unity-toggle__checkmark");
                foreach (var value in new[] { false, true })
                {
                    toggle.value = value;
                    foreach (var focus in new[] { false, true })
                    {
                        if (focus) toggle.Focus(); else toggle.Blur();
                        yield return new WaitForSecondsRealtime(0.2f);
                        Assert.That(thumb.worldBound.center.y, Is.EqualTo(track.worldBound.center.y).Within(0.25), "Focus must not displace the thumb vertically.");
                        var inset = value ? track.worldBound.xMax - thumb.worldBound.xMax : thumb.worldBound.xMin - track.worldBound.xMin;
                        Assert.That(inset, Is.EqualTo(2).Within(0.25), "Both endpoints must retain the same inset.");
                    }
                }
            }
            finally { Object.Destroy(go); }
        }

        [UnityTest]
        public IEnumerator HudDropdownUsesSingleSelectionAndRemainsClickable()
        {
            const string key = "katarune.hud.scale";
            var hadPreference = PlayerPrefs.HasKey(key);
            var previous = PlayerPrefs.GetFloat(key, 1f);
            var go = Object.Instantiate(Resources.Load<GameObject>("AvatarHud"));
            try
            {
                var hud = go.GetComponent<AvatarHudController>();
                hud.Configure(FakeRuntimeFacade.CreateReady(), true);
                Click(hud, "quickMoreButton"); Click(hud, "moreCategoryButton");
                yield return new WaitForSecondsRealtime(0.25f);
                var field = hud.RootElement.Q<DropdownField>("uiScaleField");
                for (var index = 0; index < 3; index++)
                {
                    field.index = index;
                    Assert.That(PlayerPrefs.GetFloat(key), Is.EqualTo(new[] { 0.85f, 1f, 1.15f }[index]).Within(0.001f));
                    Assert.That(field.index, Is.EqualTo(index));
                    Assert.That(AvatarWindow.IsInteractivePick(field, hud.RootElement), Is.True);
                }
                yield return new WaitForSecondsRealtime(0.25f);
                field.Focus();
                using (var submit = NavigationSubmitEvent.GetPooled()) field.SendEvent(submit);
                yield return new WaitForSecondsRealtime(0.1f);
                var menu = hud.RootElement.panel.visualTree.Q(className: GenericDropdownMenu.ussClassName);
                Assert.That(menu, Is.Not.Null);
                var item = menu.Q(className: GenericDropdownMenu.itemUssClassName);
                var pointer = new Event { mousePosition = item.worldBound.center, button = 0, type = EventType.MouseDown };
                using (var down = PointerDownEvent.GetPooled(pointer)) item.SendEvent(down);
                pointer.type = EventType.MouseUp;
                using (var up = PointerUpEvent.GetPooled(pointer)) item.SendEvent(up);
                yield return null;
                Assert.That(field.value, Is.EqualTo("小"));
                Assert.That(menu.panel, Is.Null);
                Assert.That(PlayerPrefs.GetFloat(key), Is.EqualTo(0.85f).Within(0.001f));
                yield return new WaitForSecondsRealtime(0.25f);
                field.Focus();
                using (var submit = NavigationSubmitEvent.GetPooled()) field.SendEvent(submit);
                yield return new WaitForSecondsRealtime(0.1f);
                hud.SetVisible(false);
                Assert.That(hud.RootElement.panel.visualTree.Q(className: GenericDropdownMenu.ussClassName), Is.Null);
                hud.SetVisible(true);
                Click(hud, "quickMoreButton");
                Click(hud, "shortcutsCategoryButton");
                yield return new WaitForSecondsRealtime(0.25f);
                Assert.That(hud.RootElement.Q<VisualElement>("shortcutsMenu").resolvedStyle.display, Is.EqualTo(DisplayStyle.Flex));
            }
            finally
            {
                Object.Destroy(go);
                if (hadPreference) PlayerPrefs.SetFloat(key, previous); else PlayerPrefs.DeleteKey(key);
            }
        }

        [UnityTest]
        public IEnumerator HudTransitionsSurviveRapidReopenAndReleaseHiddenControls()
        {
            var go = Object.Instantiate(Resources.Load<GameObject>("AvatarHud"));
            try
            {
                var hud = go.GetComponent<AvatarHudController>();
                hud.Configure(FakeRuntimeFacade.CreateReady(), true);
                var panel = hud.RootElement.Q<VisualElement>("primaryMenu");
                var runs = 0;
                panel.RegisterCallback<TransitionRunEvent>(_ => runs++);
                var indicator = hud.RootElement.Q<VisualElement>("tabIndicator");
                var selectionRuns = 0;
                indicator.RegisterCallback<TransitionRunEvent>(_ => selectionRuns++);
                yield return new WaitForSecondsRealtime(0.25f);
                Click(hud, "quickMoreButton");
                yield return new WaitForSecondsRealtime(0.1f);
                Click(hud, "quickMoreButton");
                Assert.That(panel.enabledInHierarchy, Is.False);
                Click(hud, "quickMoreButton");
                yield return new WaitForSecondsRealtime(0.3f);
                Assert.That(panel.enabledInHierarchy, Is.True);
                Assert.That(panel.resolvedStyle.display, Is.EqualTo(DisplayStyle.Flex));
                Assert.That(panel.resolvedStyle.opacity, Is.EqualTo(1).Within(0.01));
                Assert.That(runs, Is.GreaterThan(0), "USS transitions must actually run.");
                Click(hud, "affectCategoryButton"); Click(hud, "moreCategoryButton");
                yield return new WaitForSecondsRealtime(0.35f);
                Assert.That(hud.RootElement.Q<VisualElement>("affectMenu").resolvedStyle.display, Is.EqualTo(DisplayStyle.None));
                Assert.That(hud.RootElement.Q<VisualElement>("moreMenu").resolvedStyle.opacity, Is.EqualTo(1).Within(0.01));
                var selectedTab = hud.RootElement.Q<Button>("moreCategoryButton");
                Assert.That(selectionRuns, Is.GreaterThan(0), "The selection background must move between tabs.");
                Assert.That(indicator.worldBound.x, Is.EqualTo(selectedTab.worldBound.x).Within(0.5));
                Assert.That(indicator.worldBound.width, Is.EqualTo(selectedTab.worldBound.width).Within(0.5));
                Assert.That(AvatarWindow.IsInteractivePick(indicator, hud.RootElement), Is.False);
                Click(hud, "closePanelButton");
                yield return new WaitForSecondsRealtime(0.25f);
                Assert.That(panel.resolvedStyle.display, Is.EqualTo(DisplayStyle.None));
                Click(hud, "centralMenuButton");
                yield return new WaitForSecondsRealtime(0.25f);
                Assert.That(hud.RootElement.Q<VisualElement>("hudDock").resolvedStyle.width, Is.EqualTo(88).Within(0.1));
                Click(hud, "quickMoreButton");
                hud.SetVisible(false);
                yield return new WaitForSecondsRealtime(0.25f);
                Assert.That(panel.enabledInHierarchy, Is.False);
            }
            finally { Object.Destroy(go); }
        }

        [UnityTest]
        public IEnumerator HudRendersCompactTabsAcrossViewportSizes()
        {
            var output = Path.GetFullPath(Path.Combine(Application.dataPath, "../../../.test-dist/hud-preview"));
            Directory.CreateDirectory(output);
            foreach (var size in new[] { new Vector3(1280, 720, 1), new Vector3(1920, 1080, 1.5f), new Vector3(800, 600, 1), new Vector3(480, 720, 1) })
            {
                var texture = new RenderTexture((int)size.x, (int)size.y, 24);
                texture.Create();
                var go = Object.Instantiate(Resources.Load<GameObject>("AvatarHud"));
                var document = go.GetComponent<UIDocument>();
                var settings = Object.Instantiate(document.panelSettings);
                settings.targetTexture = texture;
                settings.clearDepthStencil = true;
                settings.scaleMode = PanelScaleMode.ConstantPixelSize;
                settings.scale = size.z;
                document.panelSettings = settings;
                var hud = go.GetComponent<AvatarHudController>();
                try
                {
                    hud.Configure(FakeRuntimeFacade.CreateReady(), true);
                    hud.RootElement.style.backgroundColor = new Color(0.88f, 0.89f, 0.90f);
                    hud.SetVoiceState(true, "listening", null);
                    hud.RootElement.Q<Toggle>("gazeTrackingToggle").value = true;
                    hud.SetInputLevel(0.65f); hud.SetRoleLevel(0.2f);
                    yield return new WaitForSecondsRealtime(0.25f);
                    Click(hud, "quickMoreButton");
                    foreach (var tab in new[] { "model", "affect", "action", "more", "shortcuts" })
                    {
                        Click(hud, tab + "CategoryButton");
                        yield return new WaitForSecondsRealtime(0.35f);
                        hud.RefreshLayout();
                        yield return null;
                        var panel = hud.RootElement.Q<VisualElement>("primaryMenu").worldBound;
                        var bounds = hud.RootElement.Q<VisualElement>("hudBounds").worldBound;
                        Assert.That(panel.xMin, Is.GreaterThanOrEqualTo(bounds.xMin));
                        Assert.That(panel.yMin, Is.GreaterThanOrEqualTo(bounds.yMin));
                        Assert.That(panel.xMax, Is.LessThanOrEqualTo(bounds.xMax));
                        Assert.That(panel.yMax, Is.LessThanOrEqualTo(bounds.yMax));
                        yield return null;
                        SaveHudTexture(texture, Path.Combine(output, $"{size.x}-{size.y}-{tab}.png"));
                        if (tab == "more")
                        {
                            var field = hud.RootElement.Q<DropdownField>("uiScaleField");
                            field.Focus();
                            using (var submit = NavigationSubmitEvent.GetPooled()) field.SendEvent(submit);
                            yield return new WaitForSecondsRealtime(0.15f);
                            var menu = document.rootVisualElement.panel.visualTree.Q(className: GenericDropdownMenu.ussClassName);
                            Assert.That(menu, Is.Not.Null, "Native dropdown must open.");
                            Assert.That(AvatarWindow.IsInteractivePick(menu, hud.RootElement), Is.True, "Popup dismiss layer must receive clicks.");
                            var item = menu.Q(className: GenericDropdownMenu.itemUssClassName);
                            Assert.That(AvatarWindow.IsInteractivePick(item, hud.RootElement), Is.True);
                            yield return null;
                            SaveHudTexture(texture, Path.Combine(output, $"{size.x}-{size.y}-dropdown.png"));
                            AvatarHudPopup.Close(hud.RootElement);
                            yield return null;
                            Assert.That(menu.panel, Is.Null, "Esc must release the popup layer.");
                        }
                    }
                    Click(hud, "centralMenuButton");
                    yield return new WaitForSecondsRealtime(0.25f);
                    Assert.That(hud.RootElement.Q<Button>("compactVoiceButton").resolvedStyle.display, Is.EqualTo(DisplayStyle.Flex));
                    SaveHudTexture(texture, Path.Combine(output, $"{size.x}-{size.y}-compact.png"));
                }
                finally { Object.Destroy(go); Object.Destroy(settings); texture.Release(); Object.Destroy(texture); }
                yield return null;
            }
        }

        private static void SaveHudTexture(RenderTexture texture, string path)
        {
            var previous = RenderTexture.active;
            var image = new Texture2D(texture.width, texture.height, TextureFormat.RGBA32, false);
            try
            {
                RenderTexture.active = texture;
                image.ReadPixels(new Rect(0, 0, texture.width, texture.height), 0, 0);
                image.Apply(); File.WriteAllBytes(path, image.EncodeToPNG());
            }
            finally { RenderTexture.active = previous; Object.Destroy(image); }
        }

        [UnityTest]
        public IEnumerator HudListsAndPlaysAnActionWithoutAnEnumOrUxmlEntry()
        {
            var gameObject = Object.Instantiate(Resources.Load<GameObject>("AvatarHud"));
            try
            {
                var runtime = FakeRuntimeFacade.CreateReady();
                var hud = gameObject.GetComponent<AvatarHudController>();
                hud.Configure(runtime, true);
                yield return null;
                var custom = hud.RootElement.Q<Button>("action-custom.salute");
                Assert.That(custom, Is.Not.Null);
                Assert.That(custom.style.display.value, Is.EqualTo(DisplayStyle.Flex));
                Click(hud, "quickMoreButton");
                Click(hud, "actionCategoryButton");
                Click(hud, "action-custom.salute");
                Assert.That(runtime.LastActionId, Is.EqualTo("custom.salute"));
                Assert.That(hud.RootElement.Q<Label>("actionLabel").text, Is.EqualTo("自定义敬礼中"));
                Assert.That(hud.RootElement.Q<Button>("cancelActionButton").enabledSelf, Is.True);
                Click(hud, "cancelActionButton");
                Assert.That(runtime.Snapshot.Motion.CurrentActionId, Is.Null);
            }
            finally { Object.Destroy(gameObject); }
            yield return null;
        }

        [UnityTest]
        public IEnumerator BehaviorControllerAppliesFramesToBoundDriver()
        {
            var gameObject = new GameObject("Behavior Controller Test");
            var controller = gameObject.AddComponent<AvatarBehaviorController>();
            var driver = new RecordingAvatarDriver();
            controller.Bind(driver);
            controller.SetAffect(AvatarAffectPreset.Happy, 1f);

            yield return null;
            yield return null;

            Assert.That(driver.ApplyCount, Is.GreaterThan(0));
            Assert.That(driver.LastFrame.Happy, Is.GreaterThan(0f));
            Object.Destroy(gameObject);
            yield return null;
        }

        [UnityTest]
        public IEnumerator HudCanToggleWithoutLoadedModel()
        {
            var prefab = Resources.Load<GameObject>("AvatarHud");
            Assert.That(prefab, Is.Not.Null, "AvatarHud prefab was not generated.");
            var gameObject = Object.Instantiate(prefab);
            var panel = gameObject.GetComponent<AvatarHudController>();
            panel.Configure(new FakeRuntimeFacade(), false);

            panel.ToggleVisible();
            Assert.That(panel.Visible, Is.True);
            panel.ToggleVisible();
            Assert.That(panel.Visible, Is.False);

            Object.Destroy(gameObject);
            yield return null;
        }

        [UnityTest]
        public IEnumerator HudMapsControlsThroughFacadeAndKeepsDecorationsTransparent()
        {
            var prefab = Resources.Load<GameObject>("AvatarHud");
            Assert.That(prefab, Is.Not.Null);
            var gameObject = Object.Instantiate(prefab);
            var runtime = FakeRuntimeFacade.CreateReady();
            var picker = new FakeVrmFilePicker("C:/Models/Next.vrm");
            var hud = gameObject.GetComponent<AvatarHudController>();
            var showcaseControlChanges = 0;
            var lastShowcaseControlState = false;
            hud.CharacterShowcaseControlChanged += enabled =>
            {
                showcaseControlChanges += 1;
                lastShowcaseControlState = enabled;
            };
            hud.Configure(runtime, picker, true);
            yield return null;

            Assert.That(hud.RootElement.Q<VisualElement>("hudDock").ClassListContains("is-compact"), Is.False);
            Click(hud, "centralMenuButton");
            Assert.That(hud.RootElement.Q<VisualElement>("hudDock").ClassListContains("is-compact"), Is.True);
            Click(hud, "centralMenuButton");
            var chats = 0;
            bool? microphoneIntent = null;
            hud.OpenChatRequested += () => chats++;
            hud.VoiceCommand += enabled => microphoneIntent = enabled;
            Click(hud, "openChatButton");
            Assert.That(chats, Is.EqualTo(1));
            hud.SetVoiceState(true, "recording", null);
            Click(hud, "voiceToggleButton");
            Assert.That(microphoneIntent, Is.False);
            hud.SetVoiceState(false, "error", "设备已断开");
            Click(hud, "compactVoiceButton");
            Assert.That(microphoneIntent, Is.True);
            Assert.That(hud.RootElement.Q<Label>("voiceErrorLabel").text, Is.EqualTo("设备已断开"));
            Click(hud, "quickMoreButton");
            Assert.That(hud.RootElement.Q<VisualElement>("primaryMenu").ClassListContains("is-visible"), Is.True);
            Click(hud, "moreCategoryButton");
            Assert.That(runtime.LastBehavior.PointerGazeTrackingEnabled, Is.False);
            Assert.That(
                hud.RootElement.Q<Toggle>("gazeTrackingToggle").value,
                Is.False);
            Click(hud, "gazeTrackingToggle");
            Assert.That(runtime.LastBehavior.PointerGazeTrackingEnabled, Is.True);
            Assert.That(
                hud.RootElement.Q<Toggle>("gazeTrackingToggle").value,
                Is.True);
            Assert.That(hud.CharacterShowcaseControlEnabled, Is.False);
            Click(hud, "showcaseControlButton");
            Assert.That(hud.CharacterShowcaseControlEnabled, Is.True);
            Assert.That(lastShowcaseControlState, Is.True);
            Assert.That(showcaseControlChanges, Is.EqualTo(1));
            Click(hud, "showcaseControlButton");
            Assert.That(hud.CharacterShowcaseControlEnabled, Is.False);
            Assert.That(lastShowcaseControlState, Is.False);
            Assert.That(showcaseControlChanges, Is.EqualTo(2));
            Click(hud, "affectCategoryButton");
            Assert.That(hud.RootElement.Q<VisualElement>("affectMenu").ClassListContains("is-visible"), Is.True);

            Click(hud, "happyAffectButton");
            Assert.That(runtime.LastBehavior.Affect, Is.EqualTo(AvatarAffectPreset.Happy));
            Assert.That(runtime.LastBehavior.AffectIntensity, Is.EqualTo(1f));
            Assert.That(
                hud.RootElement.Q<Button>("happyAffectButton").ClassListContains("is-selected"),
                Is.True);
            Click(hud, "neutralAffectButton");
            Assert.That(runtime.LastBehavior.AffectIntensity, Is.Zero);
            Click(hud, "actionCategoryButton");
            Click(hud, "action-greet-wave");
            Assert.That(runtime.LastAction, Is.EqualTo(AvatarPresetAction.GreetWave));
            Assert.That(hud.RootElement.Q<Label>("actionLabel").text, Is.EqualTo("挥手中"));
            Click(hud, "action-right-hand-offer");
            Assert.That(runtime.LastAction, Is.EqualTo(AvatarPresetAction.RightHandOffer));
            Assert.That(hud.RootElement.Q<Label>("actionLabel").text, Is.EqualTo("右手前递中"));
            Click(hud, "action-right-hand-open");
            Assert.That(runtime.LastAction, Is.EqualTo(AvatarPresetAction.RightHandOpen));
            Click(hud, "action-right-hand-to-chest");
            Assert.That(runtime.LastAction, Is.EqualTo(AvatarPresetAction.RightHandToChest));
            Click(hud, "action-left-hand-open-twice");
            Assert.That(runtime.LastAction, Is.EqualTo(AvatarPresetAction.LeftHandOpenTwice));
            Click(hud, "moreCategoryButton");
            Click(hud, "softOutlineToggle");
            Assert.That(runtime.LastPresentation.SoftOutlineEnabled, Is.True);
            Click(hud, "resetBehaviorButton");
            Assert.That(runtime.ResetCount, Is.EqualTo(1));
            Click(hud, "modelCategoryButton");
            Click(hud, "selectModelButton");
            yield return null;
            Assert.That(picker.CurrentModelPath, Is.EqualTo("C:/Models/Current.vrm"));
            Assert.That(runtime.LastLoadPath, Is.EqualTo("C:/Models/Next.vrm"));
            Click(hud, "unloadModelButton");
            Assert.That(runtime.UnloadCount, Is.EqualTo(1));

            AssertOnlyButtonsArePickable(hud.RootElement);
            Object.Destroy(gameObject);
            yield return null;
        }

        private static void Click(AvatarHudController hud, string name)
        {
            if (hud.RootElement.Q<Toggle>(name) is Toggle toggle)
            {
                Assert.That(toggle.enabledInHierarchy, Is.True, name);
                toggle.value = !toggle.value;
                return;
            }
            var button = hud.RootElement.Q<Button>(name);
            Assert.That(button, Is.Not.Null, name);
            Assert.That(button.enabledSelf, Is.True, name);
            var invoke = typeof(Clickable).GetMethod(
                "Invoke",
                BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            Assert.That(invoke, Is.Not.Null);
            invoke.Invoke(button.clickable, new object[] { null });
        }

        private static void AssertOnlyButtonsArePickable(VisualElement element)
        {
            if (element is ScrollView) return;
            if (element.pickingMode == PickingMode.Position)
            {
                Assert.That(element, Is.InstanceOf<Button>(), $"Unexpected pickable element: {element.name}");
            }
            foreach (var child in element.Children()) AssertOnlyButtonsArePickable(child);
        }

        [UnityTest]
        public IEnumerator LocalDefaultVrmLoadsThroughRuntimeWhenPresent()
        {
            var modelPath = AvatarBootstrap.ResolveInitialModelPath(null, Application.dataPath);
            if (string.IsNullOrWhiteSpace(modelPath) || !File.Exists(modelPath))
            {
                Assert.Ignore("Place a local default-avatar.vrm to run the default model smoke test.");
            }

            var facade = CreateLocalRuntime("Local Default Model Smoke", out var gameObject);
            var load = facade.LoadAsync(modelPath);
            while (!load.IsCompleted) yield return null;

            Assert.That(load.Result.Outcome, Is.EqualTo(AvatarLoadOutcome.Loaded), load.Result.Error);
            Assert.That(facade.Snapshot.RuntimeState, Is.EqualTo(AvatarRuntimeState.Ready));
            Assert.That(facade.Snapshot.Model?.Path, Is.EqualTo(Path.GetFullPath(modelPath)));
            Assert.That(facade.Snapshot.Model?.Name, Is.EqualTo("default-avatar"));
            Assert.That(facade.Snapshot.Model?.Height, Is.GreaterThan(0f));
            if (Resources.Load<AvatarMotionLibrary>("AvatarMotionLibrary") != null)
            {
                yield return null;
                yield return null;
                Assert.That(facade.Snapshot.Motion.LibraryAvailable, Is.True);
                Assert.That(facade.Snapshot.Motion.AuthoredBaseActive, Is.True);
                Assert.That(facade.CurrentPose.HasAuthoredBodyPose, Is.True);
                Assert.That(facade.CurrentPose.ProceduralArmWeight, Is.Zero);
            }

            facade.Dispose();
            Object.Destroy(gameObject);
            yield return null;
        }

        [UnityTest]
        public IEnumerator LocalPresetMotionSmokeUsesFacadeWhitelist()
        {
            var modelPath = Environment.GetEnvironmentVariable("KATARUNE_TEST_VRM_PATH");
            if (string.IsNullOrWhiteSpace(modelPath) || !File.Exists(modelPath))
            {
                Assert.Ignore("Set KATARUNE_TEST_VRM_PATH to run the local VRM motion smoke test.");
            }

            var facade = CreateLocalRuntime("Local Motion Smoke", out var gameObject);

            var load = facade.LoadAsync(modelPath);
            while (!load.IsCompleted) yield return null;
            Assert.That(load.Result.Outcome, Is.EqualTo(AvatarLoadOutcome.Loaded), load.Result.Error);

            foreach (AvatarPresetAction action in Enum.GetValues(typeof(AvatarPresetAction)))
            {
                if (!facade.Snapshot.Capabilities.SupportsAction(action)) continue;
                Assert.That(facade.RequestAction(action).Outcome, Is.EqualTo(AvatarActionRequestOutcome.Started));
                yield return null;
                yield return null;
                Assert.That(facade.Snapshot.Motion.CurrentAction, Is.EqualTo(action));
                Assert.That(facade.CurrentPose.HasAuthoredBodyPose, Is.True);
                Assert.That(facade.CurrentPose.ProceduralBodyWeight, Is.LessThan(0.45f));
                Assert.That(facade.CurrentPose.ProceduralArmWeight, Is.Zero);
            }

            facade.CancelAction();
            yield return new WaitForSeconds(0.3f);
            Assert.That(facade.Snapshot.Motion.CurrentAction, Is.Null);

            facade.Dispose();
            Object.Destroy(gameObject);
            yield return null;
        }

        private static AvatarRuntimeFacade CreateLocalRuntime(string name, out GameObject gameObject)
        {
            gameObject = new GameObject(name) { tag = "MainCamera" };
            gameObject.AddComponent<Camera>();
            var sceneRig = gameObject.AddComponent<AvatarSceneRig>();
            sceneRig.Configure(false);
            var behavior = gameObject.AddComponent<AvatarBehaviorController>();
            var motions = gameObject.AddComponent<AvatarMotionController>();
            motions.Configure();
            behavior.SetMotionSource(motions);
            var visuals = gameObject.AddComponent<AvatarVisualController>();
            visuals.Configure();
            var session = new AvatarRuntimeSession(
                new UniVrmAvatarLoader(visuals, motions),
                sceneRig,
                behavior,
                visuals,
                motions,
                CancellationToken.None);
            return new AvatarRuntimeFacade(
                session,
                behavior,
                visuals,
                sceneRig,
                motions,
                new AvatarPresentationSettings(false));
        }

        private sealed class RecordingAvatarDriver : IAvatarDriver
        {
            public int ApplyCount { get; private set; }
            public AvatarPoseFrame LastFrame { get; private set; }

            public bool SupportsAffect(AvatarAffectPreset preset) => true;

            public void Apply(AvatarPoseFrame frame)
            {
                ApplyCount += 1;
                LastFrame = frame;
            }

            public void ResetPose()
            {
            }

            public void Dispose()
            {
            }
        }

        private sealed class FakeRuntimeFacade : IAvatarRuntimeFacade
        {
            public System.Collections.Generic.IReadOnlyList<AvatarActionInfo> AvailableActions { get; } = new[]
            {
                new AvatarActionInfo("greet-wave", "挥手"), new AvatarActionInfo("explain", "解释"),
                new AvatarActionInfo("celebrate", "庆祝"), new AvatarActionInfo("cough", "咳嗽"),
                new AvatarActionInfo("right-hand-offer", "右手前递"), new AvatarActionInfo("right-hand-open", "右手摊手"),
                new AvatarActionInfo("right-hand-to-chest", "右手放胸口"), new AvatarActionInfo("left-hand-open-twice", "左手摊手两下"),
                new AvatarActionInfo("custom.salute", "自定义敬礼"),
            };
            public string LastActionId { get; private set; }
            public AvatarActionRequestResult RequestAction(string id)
            {
                LastActionId = id;
                var preset = AvatarActionIds.ToPreset(id);
                if (preset.HasValue) return RequestAction(preset.Value);
                ReplaceSnapshot(Snapshot.Behavior, Snapshot.Presentation,
                    new AvatarMotionSnapshot(true, true, null, Snapshot.Motion.ActionSequence + 1, currentActionId: id));
                return new AvatarActionRequestResult(AvatarActionRequestOutcome.Started);
            }

            public FakeRuntimeFacade() : this(false)
            {
            }

            private FakeRuntimeFacade(bool ready)
            {
                Snapshot = new AvatarRuntimeSnapshot(
                    0,
                    ready ? AvatarRuntimeState.Ready : AvatarRuntimeState.Empty,
                    ready ? new AvatarModelInfo("C:/Models/Current.vrm", "Current", 1.6f) : null,
                    null,
                    AvatarBehaviorSettings.Default,
                    new AvatarPresentationSettings(false),
                    new AvatarCapabilitySet(AvatarAffectCapabilities.All, AvatarActionCapabilities.All),
                    new AvatarMotionSnapshot(ready, ready, null, 0));
            }

            public static FakeRuntimeFacade CreateReady() => new FakeRuntimeFacade(true);

            public AvatarRuntimeSnapshot Snapshot { get; private set; }
            public AvatarPoseFrame CurrentPose { get; } = new AvatarPoseFrame();
            public event Action<AvatarRuntimeSnapshot> Changed;
            public AvatarBehaviorSettings LastBehavior { get; private set; } = AvatarBehaviorSettings.Default;
            public AvatarPresentationSettings LastPresentation { get; private set; } =
                new AvatarPresentationSettings(false);
            public AvatarPresetAction? LastAction { get; private set; }
            public string LastLoadPath { get; private set; }
            public int ResetCount { get; private set; }
            public int UnloadCount { get; private set; }

            public Task<AvatarLoadResult> LoadAsync(string path, CancellationToken cancellationToken = default)
            {
                LastLoadPath = path;
                return Task.FromResult(new AvatarLoadResult(AvatarLoadOutcome.Loaded));
            }

            public void Unload() => UnloadCount += 1;
            public void ApplyBehavior(AvatarBehaviorSettings settings)
            {
                LastBehavior = settings;
                ReplaceSnapshot(settings, Snapshot.Presentation, Snapshot.Motion);
            }
            public void ApplyPresentation(AvatarPresentationSettings settings)
            {
                LastPresentation = settings;
                ReplaceSnapshot(Snapshot.Behavior, settings, Snapshot.Motion);
            }
            public void SetManualVisemes(AvatarVisemeWeights weights) { }
            public void RequestBlink() { }
            public void ResetBehavior() => ResetCount += 1;
            public AvatarActionRequestResult RequestAction(AvatarPresetAction action)
            {
                LastAction = action;
                ReplaceSnapshot(
                    Snapshot.Behavior,
                    Snapshot.Presentation,
                    new AvatarMotionSnapshot(true, true, action, Snapshot.Motion.ActionSequence + 1));
                return new AvatarActionRequestResult(AvatarActionRequestOutcome.Started);
            }
            public void CancelAction()
            {
                ReplaceSnapshot(
                    Snapshot.Behavior,
                    Snapshot.Presentation,
                    new AvatarMotionSnapshot(true, true, null, Snapshot.Motion.ActionSequence));
            }
            public BehaviorRequestResult RequestBehavior(
                BehaviorIntent intent,
                PerformanceRequestPolicy policy = PerformanceRequestPolicy.Queue) =>
                new BehaviorRequestResult(BehaviorRequestOutcome.Unavailable);
            public PerformanceTransitionOutcome ApplyPerformanceCommand(
                string instanceId,
                PerformanceCommand command) => PerformanceTransitionOutcome.Rejected;
            public void Dispose() { }

            private void ReplaceSnapshot(
                AvatarBehaviorSettings behavior,
                AvatarPresentationSettings presentation,
                AvatarMotionSnapshot motion)
            {
                Snapshot = new AvatarRuntimeSnapshot(
                    Snapshot.Revision + 1,
                    Snapshot.RuntimeState,
                    Snapshot.Model,
                    Snapshot.LastError,
                    behavior,
                    presentation,
                    Snapshot.Capabilities,
                    motion);
                Changed?.Invoke(Snapshot);
            }
        }

        private sealed class FakeVrmFilePicker : IAvatarVrmFilePicker
        {
            private readonly string _selectedPath;

            public FakeVrmFilePicker(string selectedPath)
            {
                _selectedPath = selectedPath;
            }

            public string CurrentModelPath { get; private set; }

            public void Open(string currentModelPath, Action<string> selected)
            {
                CurrentModelPath = currentModelPath;
                selected(_selectedPath);
            }
        }

        private sealed class UnusedAvatarLoader : IAvatarModelLoader
        {
            public Task<AvatarLoadCandidate> LoadAsync(
                string path,
                AvatarPresentationSettings presentation,
                CancellationToken cancellationToken) =>
                Task.FromException<AvatarLoadCandidate>(new InvalidOperationException("Not used by this test."));
        }
    }
}
