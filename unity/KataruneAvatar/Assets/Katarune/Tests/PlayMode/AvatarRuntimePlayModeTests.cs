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
        public IEnumerator HudPagesAndPlaysAnActionWithoutAnEnumOrUxmlEntry()
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
                Assert.That(custom.tooltip, Is.EqualTo("自定义敬礼"));
                Assert.That(custom.style.display.value, Is.EqualTo(DisplayStyle.None));
                Click(hud, "nextActionPageButton");
                Click(hud, "nextActionPageButton");
                Assert.That(custom.style.display.value, Is.EqualTo(DisplayStyle.Flex));
                Click(hud, "action-custom.salute");
                Assert.That(runtime.LastActionId, Is.EqualTo("custom.salute"));
                Assert.That(hud.RootElement.Q<Label>("actionLabel").text, Is.EqualTo("自定义敬礼中"));
                Assert.That(hud.RootElement.Q<Button>("cancelActionButton").enabledSelf, Is.True);
                Click(hud, "cancelActionButton");
                Assert.That(runtime.Snapshot.Motion.CurrentActionId, Is.Null);
                Click(hud, "nextActionPageButton");
                Assert.That(custom.style.display.value, Is.EqualTo(DisplayStyle.None));
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

            Assert.That(hud.StatusHudVisible, Is.False);
            Assert.That(
                hud.RootElement.Q<VisualElement>("statusHud").ClassListContains("is-status-hidden"),
                Is.True);

            Click(hud, "centralMenuButton");
            Assert.That(hud.RootElement.Q<VisualElement>("primaryMenu").ClassListContains("is-visible"), Is.True);
            Assert.That(runtime.LastBehavior.PointerGazeTrackingEnabled, Is.False);
            Assert.That(
                hud.RootElement.Q<Button>("gazeTrackingButton").ClassListContains("is-selected"),
                Is.False);
            Click(hud, "gazeTrackingButton");
            Assert.That(runtime.LastBehavior.PointerGazeTrackingEnabled, Is.True);
            Assert.That(
                hud.RootElement.Q<Button>("gazeTrackingButton").ClassListContains("is-selected"),
                Is.True);
            Assert.That(hud.CharacterShowcaseControlEnabled, Is.False);
            Click(hud, "showcaseControlButton");
            Assert.That(hud.CharacterShowcaseControlEnabled, Is.True);
            Assert.That(lastShowcaseControlState, Is.True);
            Assert.That(showcaseControlChanges, Is.EqualTo(1));
            Assert.That(
                hud.RootElement.Q<Button>("showcaseControlButton").ClassListContains("is-selected"),
                Is.True);
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
                hud.RootElement.Q<VisualElement>("affectStatusIcon").ClassListContains("icon-happy"),
                Is.True);
            Click(hud, "neutralAffectButton");
            Assert.That(runtime.LastBehavior.AffectIntensity, Is.Zero);
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
            Click(hud, "softOutlineButton");
            Assert.That(runtime.LastPresentation.SoftOutlineEnabled, Is.True);
            Click(hud, "statusHudButton");
            Assert.That(hud.StatusHudVisible, Is.True);
            Assert.That(
                hud.RootElement.Q<VisualElement>("statusHud").ClassListContains("is-status-hidden"),
                Is.False);
            Assert.That(
                hud.RootElement.Q<Button>("statusHudButton").ClassListContains("is-selected"),
                Is.True);
            Click(hud, "statusHudButton");
            Assert.That(hud.StatusHudVisible, Is.False);
            Click(hud, "resetBehaviorButton");
            Assert.That(runtime.ResetCount, Is.EqualTo(1));
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
