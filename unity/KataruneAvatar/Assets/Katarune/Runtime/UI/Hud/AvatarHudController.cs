using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Kirurobo;
using UnityEngine;
using UnityEngine.UIElements;

namespace Katarune.Avatar
{
    internal interface IAvatarVrmFilePicker
    {
        void Open(string currentModelPath, Action<string> selected);
    }

    internal sealed class AvatarVrmFilePicker : IAvatarVrmFilePicker
    {
        public void Open(string currentModelPath, Action<string> selected)
        {
            if (selected == null) throw new ArgumentNullException(nameof(selected));
            var initialDirectory = !string.IsNullOrWhiteSpace(currentModelPath)
                ? Path.GetDirectoryName(currentModelPath)
                : Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
            var settings = new FilePanel.Settings
            {
                title = "选择 VRM 角色模型",
                initialDirectory = initialDirectory,
                filters = new[] { new FilePanel.Filter("VRM 模型 (*.vrm)", "vrm") },
            };
            FilePanel.OpenFilePanel(settings, files =>
            {
                if (files == null || files.Length == 0 || string.IsNullOrWhiteSpace(files[0])) return;
                selected(Path.GetFullPath(files[0]));
            });
        }
    }

    [RequireComponent(typeof(UIDocument))]
    public sealed class AvatarHudController : MonoBehaviour
    {
        private const string HiddenClass = "is-hidden";
        private const string VisibleClass = "is-visible";
        private const string SelectedClass = "is-selected";
        private const string StatusHudHiddenClass = "is-status-hidden";
        private const float ComfortableAffectIntensity = 0.7f;
        private static readonly string[] AffectIconClasses =
        {
            "icon-neutral",
            "icon-happy",
            "icon-relaxed",
            "icon-sad",
            "icon-angry",
            "icon-surprised",
        };
        private readonly Dictionary<HudCategory, Button> _categoryButtons = new();
        private readonly Dictionary<HudCategory, VisualElement> _categoryGroups = new();
        private readonly Dictionary<AvatarActivityState, Button> _activityButtons = new();
        private readonly Dictionary<AvatarAffectPreset, Button> _affectButtons = new();
        private readonly Dictionary<AvatarPresetAction, Button> _actionButtons = new();

        private IAvatarRuntimeFacade _runtime;
        private IAvatarVrmFilePicker _filePicker;
        private UIDocument _document;
        private VisualElement _root;
        private VisualElement _statusHud;
        private AvatarRadialMenu _radialMenu;
        private AvatarHudTooltipElement _tooltip;
        private AvatarHudDragManipulator _dragManipulator;
        private IAvatarPointerPositionSource _pointerSource;
        private Label _modelName;
        private VisualElement _affectStatusIcon;
        private Label _actionLabel;
        private Label _noticeLabel;
        private VisualElement _primaryGroup;
        private Button _centralButton;
        private Button _selectModelButton;
        private Button _reloadModelButton;
        private Button _unloadModelButton;
        private Button _cancelActionButton;
        private Button _lightDesktopButton;
        private Button _darkDesktopButton;
        private Button _softOutlineButton;
        private Button _statusHudButton;
        private Button _resetBehaviorButton;
        private HudCategory? _activeCategory;
        private bool _primaryExpanded;
        private bool _localShortcutEnabled;
        private bool _configured;
        private bool _visible;
        private string _localNotice;

        public bool Visible => _visible;
        public bool StatusHudVisible { get; private set; }
        public event Action<bool> VisibilityChanged;
        internal event Action<bool> PointerInteractionChanged;

        internal VisualElement RootElement => _root;

        public void Configure(IAvatarRuntimeFacade runtime, bool initialVisible)
        {
            Configure(runtime, new AvatarVrmFilePicker(), initialVisible);
        }

        internal void Configure(
            IAvatarRuntimeFacade runtime,
            IAvatarVrmFilePicker filePicker,
            bool initialVisible)
        {
            Configure(runtime, filePicker, initialVisible, AvatarPointerPositionSource.CreateDefault());
        }

        internal void Configure(
            IAvatarRuntimeFacade runtime,
            IAvatarVrmFilePicker filePicker,
            bool initialVisible,
            IAvatarPointerPositionSource pointerSource)
        {
            if (_configured) throw new InvalidOperationException("Avatar HUD is already configured.");
            _runtime = runtime ?? throw new ArgumentNullException(nameof(runtime));
            _filePicker = filePicker ?? throw new ArgumentNullException(nameof(filePicker));
            _pointerSource = pointerSource ?? throw new ArgumentNullException(nameof(pointerSource));
            _document = GetComponent<UIDocument>();
            BindDocument();
            _runtime.Changed += OnRuntimeChanged;
            _configured = true;
            _visible = !initialVisible;
            SetVisible(initialVisible);
            Refresh(_runtime.Snapshot);
        }

        internal void SetLocalShortcutEnabled(bool enabled) => _localShortcutEnabled = enabled;

        public void SetVisible(bool visible)
        {
            if (_visible == visible && _root != null) return;
            _visible = visible;
            _root?.EnableInClassList(HiddenClass, !visible);
            if (!visible) CollapseMenus();
            VisibilityChanged?.Invoke(visible);
        }

        public void ToggleVisible() => SetVisible(!_visible);

        private void Update()
        {
            if (_localShortcutEnabled && Input.GetKeyDown(KeyCode.F1)) ToggleVisible();
        }

        private void LateUpdate()
        {
            if (_dragManipulator == null || !_dragManipulator.IsActive) return;
            var panel = _root?.panel;
            if (panel == null || !_pointerSource.TryGetClientPosition(out var clientPosition)) return;
            var panelPosition = RuntimePanelUtils.ScreenToPanel(panel, clientPosition);
            _dragManipulator.UpdatePointerPosition(panelPosition);
        }

        private void BindDocument()
        {
            _root = _document.rootVisualElement.Q<VisualElement>("hudRoot")
                ?? throw new InvalidOperationException("AvatarHud.uxml is missing hudRoot.");
            _statusHud = Require<VisualElement>("statusHud");
            _radialMenu = Require<AvatarRadialMenu>("radialStage");
            _tooltip = Require<AvatarHudTooltipElement>("hudTooltip");
            _modelName = Require<Label>("modelNameLabel");
            _affectStatusIcon = Require<VisualElement>("affectStatusIcon");
            _actionLabel = Require<Label>("actionLabel");
            _noticeLabel = Require<Label>("noticeLabel");
            _primaryGroup = Require<VisualElement>("primaryMenu");
            _centralButton = Require<Button>("centralMenuButton");
            _centralButton.clicked += OnCentralButtonClicked;
            if (_centralButton.clickable != null)
            {
                _centralButton.RemoveManipulator(_centralButton.clickable);
            }
            _dragManipulator = new AvatarHudDragManipulator(
                _radialMenu,
                _root,
                OnCentralButtonClicked,
                OnPointerInteractionChanged,
                _radialMenu.UpdatePlacement);
            _centralButton.AddManipulator(_dragManipulator);

            RegisterCategory(HudCategory.Model, "modelCategoryButton", "modelMenu");
            RegisterCategory(HudCategory.Affect, "affectCategoryButton", "affectMenu");
            RegisterCategory(HudCategory.Action, "actionCategoryButton", "actionMenu");
            RegisterCategory(HudCategory.Activity, "activityCategoryButton", "activityMenu");
            RegisterCategory(HudCategory.More, "moreCategoryButton", "moreMenu");

            _selectModelButton = Require<Button>("selectModelButton");
            _reloadModelButton = Require<Button>("reloadModelButton");
            _unloadModelButton = Require<Button>("unloadModelButton");
            _selectModelButton.clicked += SelectModel;
            _reloadModelButton.clicked += ReloadModel;
            _unloadModelButton.clicked += UnloadModel;

            RegisterAffect(AvatarAffectPreset.Neutral, "neutralAffectButton");
            RegisterAffect(AvatarAffectPreset.Happy, "happyAffectButton");
            RegisterAffect(AvatarAffectPreset.Relaxed, "relaxedAffectButton");
            RegisterAffect(AvatarAffectPreset.Sad, "sadAffectButton");
            RegisterAffect(AvatarAffectPreset.Angry, "angryAffectButton");
            RegisterAffect(AvatarAffectPreset.Surprised, "surprisedAffectButton");

            RegisterAction(AvatarPresetAction.GreetWave, "greetWaveButton");
            RegisterAction(AvatarPresetAction.Explain, "explainButton");
            RegisterAction(AvatarPresetAction.Celebrate, "celebrateButton");
            RegisterAction(AvatarPresetAction.Cough, "coughButton");
            _cancelActionButton = Require<Button>("cancelActionButton");
            _cancelActionButton.clicked += () => _runtime.CancelAction();

            RegisterActivity(AvatarActivityState.Idle, "idleActivityButton");
            RegisterActivity(AvatarActivityState.Listening, "listeningActivityButton");
            RegisterActivity(AvatarActivityState.Thinking, "thinkingActivityButton");
            RegisterActivity(AvatarActivityState.Speaking, "speakingActivityButton");

            _lightDesktopButton = Require<Button>("lightDesktopButton");
            _darkDesktopButton = Require<Button>("darkDesktopButton");
            _softOutlineButton = Require<Button>("softOutlineButton");
            _statusHudButton = Require<Button>("statusHudButton");
            _resetBehaviorButton = Require<Button>("resetBehaviorButton");
            _lightDesktopButton.clicked += () => ApplyLighting(AvatarLightingMode.LightDesktop);
            _darkDesktopButton.clicked += () => ApplyLighting(AvatarLightingMode.DarkDesktop);
            _softOutlineButton.clicked += ToggleSoftOutline;
            _statusHudButton.clicked += ToggleStatusHud;
            _resetBehaviorButton.clicked += () => _runtime.ResetBehavior();
            _root.Query<Button>().ForEach(button => _tooltip.AttachTo(button, button.tooltip));
            CollapseMenus();
            SetStatusHudVisible(false);
        }

        private T Require<T>(string name) where T : VisualElement
        {
            return _document.rootVisualElement.Q<T>(name)
                ?? throw new InvalidOperationException($"AvatarHud.uxml is missing '{name}'.");
        }

        private void RegisterCategory(HudCategory category, string buttonName, string groupName)
        {
            var button = Require<Button>(buttonName);
            _categoryButtons.Add(category, button);
            _categoryGroups.Add(category, Require<VisualElement>(groupName));
            button.clicked += () => ToggleCategory(category);
        }

        private void RegisterAffect(AvatarAffectPreset affect, string buttonName)
        {
            var button = Require<Button>(buttonName);
            _affectButtons.Add(affect, button);
            button.clicked += () => ApplyAffect(affect);
        }

        private void RegisterAction(AvatarPresetAction action, string buttonName)
        {
            var button = Require<Button>(buttonName);
            _actionButtons.Add(action, button);
            button.clicked += () => RequestAction(action);
        }

        private void RegisterActivity(AvatarActivityState activity, string buttonName)
        {
            var button = Require<Button>(buttonName);
            _activityButtons.Add(activity, button);
            button.clicked += () =>
                _runtime.ApplyBehavior(_runtime.Snapshot.Behavior.WithActivity(activity));
        }

        private void TogglePrimaryMenu()
        {
            if (_primaryExpanded)
            {
                CollapseMenus();
                return;
            }
            _primaryExpanded = true;
            _primaryGroup.AddToClassList(VisibleClass);
        }

        private void OnCentralButtonClicked()
        {
            TogglePrimaryMenu();
        }

        private void OnPointerInteractionChanged(bool active)
        {
            if (active) _tooltip?.Hide();
            PointerInteractionChanged?.Invoke(active);
        }

        private void ToggleCategory(HudCategory category)
        {
            if (_activeCategory == category)
            {
                SetActiveCategory(null);
                return;
            }
            SetActiveCategory(category);
        }

        private void SetActiveCategory(HudCategory? category)
        {
            _activeCategory = category;
            foreach (var pair in _categoryGroups)
            {
                pair.Value.EnableInClassList(VisibleClass, pair.Key == category);
            }
            foreach (var pair in _categoryButtons)
            {
                pair.Value.EnableInClassList(SelectedClass, pair.Key == category);
            }
        }

        private void CollapseMenus()
        {
            _primaryExpanded = false;
            _primaryGroup?.RemoveFromClassList(VisibleClass);
            SetActiveCategory(null);
            _tooltip?.Hide();
        }

        private void SelectModel()
        {
            try
            {
                var path = _runtime.Snapshot.Model?.Path;
                _filePicker.Open(path, selected => _ = LoadModelAsync(selected));
            }
            catch (Exception error)
            {
                ShowNotice(error.Message);
            }
        }

        private void ReloadModel()
        {
            var path = _runtime.Snapshot.Model?.Path;
            if (!string.IsNullOrWhiteSpace(path)) _ = LoadModelAsync(path);
        }

        private async Task LoadModelAsync(string path)
        {
            _localNotice = null;
            try
            {
                var result = await _runtime.LoadAsync(path, destroyCancellationToken);
                if (result.Outcome == AvatarLoadOutcome.Failed) ShowNotice(result.Error);
            }
            catch (OperationCanceledException)
            {
            }
            catch (Exception error)
            {
                ShowNotice(error.Message);
            }
            Refresh(_runtime.Snapshot);
        }

        private void UnloadModel()
        {
            _localNotice = null;
            _runtime.Unload();
        }

        private void ApplyAffect(AvatarAffectPreset affect)
        {
            var intensity = affect == AvatarAffectPreset.Neutral ? 0f : ComfortableAffectIntensity;
            _runtime.ApplyBehavior(_runtime.Snapshot.Behavior.WithAffect(affect, intensity));
        }

        private void RequestAction(AvatarPresetAction action)
        {
            var result = _runtime.RequestAction(action);
            if (result.Outcome != AvatarActionRequestOutcome.Started)
            {
                ShowNotice(string.IsNullOrWhiteSpace(result.Error) ? "当前动作不可用。" : result.Error);
            }
        }

        private void ApplyLighting(AvatarLightingMode mode)
        {
            var presentation = _runtime.Snapshot.Presentation;
            _runtime.ApplyPresentation(presentation.WithLightingMode(mode));
        }

        private void ToggleSoftOutline()
        {
            var presentation = _runtime.Snapshot.Presentation;
            _runtime.ApplyPresentation(presentation.WithSoftOutline(!presentation.SoftOutlineEnabled));
        }

        private void ToggleStatusHud() => SetStatusHudVisible(!StatusHudVisible);

        private void SetStatusHudVisible(bool visible)
        {
            StatusHudVisible = visible;
            _statusHud?.EnableInClassList(StatusHudHiddenClass, !visible);
            _statusHudButton?.EnableInClassList(SelectedClass, visible);
        }

        private void ShowNotice(string message)
        {
            _localNotice = string.IsNullOrWhiteSpace(message) ? "操作失败，请稍后重试。" : message;
            Refresh(_runtime.Snapshot);
        }

        private void OnRuntimeChanged(AvatarRuntimeSnapshot snapshot) => Refresh(snapshot);

        private void Refresh(AvatarRuntimeSnapshot snapshot)
        {
            if (_root == null || snapshot == null) return;
            _modelName.text = GetModelTitle(snapshot);
            _actionLabel.text = GetActionStatusLabel(snapshot);
            SetAffectStatusIcon(snapshot.Behavior.Affect);
            var notice = !string.IsNullOrWhiteSpace(_localNotice) ? _localNotice : snapshot.LastError;
            _noticeLabel.text = notice ?? string.Empty;
            _noticeLabel.EnableInClassList(VisibleClass, !string.IsNullOrWhiteSpace(notice));

            var ready = snapshot.RuntimeState == AvatarRuntimeState.Ready;
            var loading = snapshot.RuntimeState == AvatarRuntimeState.Loading;
            _selectModelButton.SetEnabled(!loading);
            _reloadModelButton.SetEnabled(snapshot.Model.HasValue && !loading);
            _unloadModelButton.SetEnabled(snapshot.Model.HasValue && !loading);

            foreach (var pair in _activityButtons)
            {
                pair.Value.SetEnabled(ready);
                pair.Value.EnableInClassList(SelectedClass, snapshot.Behavior.Activity == pair.Key);
            }
            foreach (var pair in _affectButtons)
            {
                pair.Value.SetEnabled(ready && snapshot.Capabilities.SupportsAffect(pair.Key));
                pair.Value.EnableInClassList(SelectedClass, snapshot.Behavior.Affect == pair.Key);
            }
            foreach (var pair in _actionButtons)
            {
                pair.Value.SetEnabled(
                    ready
                    && snapshot.Motion.LibraryAvailable
                    && snapshot.Capabilities.SupportsAction(pair.Key));
                pair.Value.EnableInClassList(SelectedClass, snapshot.Motion.CurrentAction == pair.Key);
            }
            _cancelActionButton.SetEnabled(ready && snapshot.Motion.CurrentAction.HasValue);
            _lightDesktopButton.EnableInClassList(
                SelectedClass,
                snapshot.Presentation.LightingMode == AvatarLightingMode.LightDesktop);
            _darkDesktopButton.EnableInClassList(
                SelectedClass,
                snapshot.Presentation.LightingMode == AvatarLightingMode.DarkDesktop);
            _softOutlineButton.EnableInClassList(
                SelectedClass,
                snapshot.Presentation.SoftOutlineEnabled);
        }

        private void SetAffectStatusIcon(AvatarAffectPreset affect)
        {
            foreach (var className in AffectIconClasses) _affectStatusIcon.RemoveFromClassList(className);
            _affectStatusIcon.AddToClassList(affect switch
            {
                AvatarAffectPreset.Happy => "icon-happy",
                AvatarAffectPreset.Relaxed => "icon-relaxed",
                AvatarAffectPreset.Sad => "icon-sad",
                AvatarAffectPreset.Angry => "icon-angry",
                AvatarAffectPreset.Surprised => "icon-surprised",
                _ => "icon-neutral",
            });
        }

        private static string GetModelTitle(AvatarRuntimeSnapshot snapshot)
        {
            switch (snapshot.RuntimeState)
            {
                case AvatarRuntimeState.Loading:
                    return "正在准备角色";
                case AvatarRuntimeState.Error when !snapshot.Model.HasValue:
                    return "角色加载失败";
            }
            if (!snapshot.Model.HasValue) return "未加载角色";
            var model = snapshot.Model.Value;
            return string.IsNullOrWhiteSpace(model.Name)
                ? Path.GetFileNameWithoutExtension(model.Path)
                : model.Name;
        }

        private static string GetActionStatusLabel(AvatarRuntimeSnapshot snapshot)
        {
            if (snapshot.RuntimeState == AvatarRuntimeState.Loading) return "正在准备角色";
            if (snapshot.RuntimeState == AvatarRuntimeState.Error && !snapshot.Model.HasValue)
            {
                return "等待重试";
            }
            if (snapshot.Motion.CurrentAction.HasValue)
            {
                return $"{GetActionLabel(snapshot.Motion.CurrentAction.Value)}中";
            }
            return snapshot.RuntimeState == AvatarRuntimeState.Ready
                ? GetActivityLabel(snapshot.Behavior.Activity)
                : "无动作";
        }

        private static string GetActivityLabel(AvatarActivityState activity)
        {
            return activity switch
            {
                AvatarActivityState.Listening => "倾听中",
                AvatarActivityState.Thinking => "思考中",
                AvatarActivityState.Speaking => "说话中",
                _ => "待机中",
            };
        }

        private static string GetActionLabel(AvatarPresetAction action)
        {
            return action switch
            {
                AvatarPresetAction.Explain => "解释",
                AvatarPresetAction.Celebrate => "庆祝",
                AvatarPresetAction.Cough => "咳嗽",
                _ => "挥手",
            };
        }

        private void OnDestroy()
        {
            if (_runtime != null) _runtime.Changed -= OnRuntimeChanged;
            if (_centralButton != null && _dragManipulator != null)
            {
                _centralButton.RemoveManipulator(_dragManipulator);
            }
        }

        private enum HudCategory
        {
            Model,
            Affect,
            Action,
            Activity,
            More,
        }
    }
}
