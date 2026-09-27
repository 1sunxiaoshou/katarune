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
        private const float DefaultAffectIntensity = 1f;
        private readonly Dictionary<HudCategory, Button> _categoryButtons = new();
        private readonly Dictionary<HudCategory, VisualElement> _categoryGroups = new();
        private readonly Dictionary<AvatarAffectPreset, Button> _affectButtons = new();
        private readonly Dictionary<string, Button> _actionButtons = new();

        private IAvatarRuntimeFacade _runtime;
        private IAvatarVrmFilePicker _filePicker;
        private UIDocument _document;
        private VisualElement _root;
        private VisualElement _dock, _bounds;
        private PanelSettings _runtimePanel;
        private float _uiScale = 1f;
        private float _nextDisplayRefresh;
        private AvatarHudTooltipElement _tooltip;
        private AvatarHudDragManipulator _dragManipulator;
        private IAvatarPointerPositionSource _pointerSource;
        private Label _modelName;
        private Label _actionLabel;
        private Label _noticeLabel;
        private VisualElement _primaryGroup;
        private AvatarHudTransition _panelTransition;
        private VisualElement _tabIndicator;
        private readonly Dictionary<HudCategory, AvatarHudTransition> _pageTransitions = new();
        private Button _centralButton;
        private Button _voiceToggleButton;
        private VisualElement _micLevel;
        private VisualElement _roleLevel;
        private bool _voiceEnabled;
        private bool _roleSpeaking;
        private string _voicePhase;
        private string _voiceError;
        private Button _selectModelButton;
        private Button _reloadModelButton;
        private Button _unloadModelButton;
        private Button _cancelActionButton;
        private Toggle _gazeTrackingToggle;
        private Toggle _showcaseControlToggle;
        private Toggle _softOutlineToggle;
        private Button _resetBehaviorButton;
        private HudCategory? _activeCategory;
        private bool _primaryExpanded;
        private bool _localShortcutEnabled;
        private bool _configured;
        private bool _visible;
        private string _localNotice;

        public bool Visible => _visible;
        public bool CharacterShowcaseControlEnabled { get; private set; }
        public event Action<bool> VisibilityChanged;
        public event Action<bool> VoiceCommand;
        public event Action OpenChatRequested;
        public event Action<bool> CharacterShowcaseControlChanged;
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
            _runtimePanel = Instantiate(_document.panelSettings);
            _document.panelSettings = _runtimePanel;
            _uiScale = PlayerPrefs.GetFloat("katarune.hud.scale", 1f);
            BindDocument();
            AvatarHudPopup.InstallTheme(_document.rootVisualElement);
            RefreshDisplay();
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
            if (!visible) { AvatarHudPopup.Close(_root); CollapseMenus(); SetCharacterShowcaseControlEnabled(false); }
            VisibilityChanged?.Invoke(visible);
        }

        public void ToggleVisible() => SetVisible(!_visible);

        public void SetVoiceState(bool enabled, string phase, string error)
        {
            _voiceEnabled = enabled;
            _voicePhase = phase;
            _voiceError = error;
            RefreshVoiceStatus();
        }

        public void SetRoleSpeaking(bool speaking)
        {
            _roleSpeaking = speaking;
            RefreshVoiceStatus();
        }

        public void SetInputLevel(float level)
        {
            if (_micLevel != null) _micLevel.style.width = Length.Percent(Mathf.Clamp01(level) * 100f);
        }

        public void SetRoleLevel(float level)
        {
            if (_roleLevel != null) _roleLevel.style.width = Length.Percent(Mathf.Clamp01(level) * 100f);
        }

        private void RefreshVoiceStatus()
        {
            if (_voiceToggleButton == null) return;
            var status = !string.IsNullOrWhiteSpace(_voiceError) ? "语音异常" : !_voiceEnabled ? "麦克风已关闭" : _voicePhase switch
            {
                "preparing" => "语音准备中",
                "recording" => "正在收音",
                "transcribing" => "正在识别",
                "waiting" => "等待回复",
                "error" => "语音异常",
                _ => _roleSpeaking ? "角色说话 · 正在听" : "正在听",
            };

            _voiceToggleButton.EnableInClassList("is-selected", _voiceEnabled);
            _voiceToggleButton.EnableInClassList("is-error", !string.IsNullOrEmpty(_voiceError));
            var compact = Require<Button>("compactVoiceButton");
            compact.tooltip = !string.IsNullOrEmpty(_voiceError) ? "重试语音：" + _voiceError
                : status + " · " + (_voiceEnabled ? "关闭麦克风" : "开启麦克风");
            compact.EnableInClassList(SelectedClass, _voiceEnabled);
            compact.EnableInClassList("is-error", !string.IsNullOrEmpty(_voiceError));
            _voiceToggleButton.tooltip = compact.tooltip;
            foreach (var button in new[] { compact, _voiceToggleButton })
                if (button is AvatarHudIconButton icon) icon.iconClass = !string.IsNullOrEmpty(_voiceError) ? "icon-retry" : _voiceEnabled ? "icon-mic" : "icon-mic-off";

            var error = Require<Label>("voiceErrorLabel"); error.text = _voiceError ?? "";
            error.EnableInClassList(VisibleClass, !string.IsNullOrEmpty(_voiceError));
        }

        private void Update()
        {
            if (_localShortcutEnabled && Input.GetKeyDown(KeyCode.F1)) ToggleVisible();
            if (_configured && Time.unscaledTime >= _nextDisplayRefresh) { RefreshDisplay(); _nextDisplayRefresh = Time.unscaledTime + 1f; }
        }

        private void LateUpdate()
        {
            if (_dragManipulator == null || !_dragManipulator.IsActive) return;
            var panel = _root?.panel;
            if (panel == null || !_pointerSource.TryGetClientPosition(out var clientPosition)) return;
            var panelPosition = RuntimePanelUtils.ScreenToPanel(panel, clientPosition);
            _dragManipulator.UpdatePointerPosition(panelPosition);
            RefreshLayout();
        }

        private void BindDocument()
        {
            _root = _document.rootVisualElement.Q<VisualElement>("hudRoot")
                ?? throw new InvalidOperationException("AvatarHud.uxml is missing hudRoot.");
            _dock = Require<VisualElement>("hudDock");
            _root.RegisterCallback<PointerDownEvent>(_ => _root.RemoveFromClassList("keyboard-navigation"), TrickleDown.TrickleDown);
            _root.RegisterCallback<KeyDownEvent>(evt =>
            {
                if (evt.keyCode == KeyCode.Tab || evt.keyCode == KeyCode.Return ||
                    evt.keyCode == KeyCode.Space || evt.keyCode == KeyCode.UpArrow ||
                    evt.keyCode == KeyCode.DownArrow || evt.keyCode == KeyCode.LeftArrow || evt.keyCode == KeyCode.RightArrow)
                    _root.AddToClassList("keyboard-navigation");
            }, TrickleDown.TrickleDown);
            _root.RegisterCallback<NavigationMoveEvent>(_ => _root.AddToClassList("keyboard-navigation"), TrickleDown.TrickleDown);
            _bounds = Require<VisualElement>("hudBounds");
            var scroller = Require<ScrollView>("hudPanelScroll").verticalScroller;
            scroller.AddToClassList("hud-scroller");
            scroller.slider.AddToClassList("hud-scroll-slider");
            scroller.lowButton.style.display = DisplayStyle.None;
            scroller.highButton.style.display = DisplayStyle.None;
            _voiceToggleButton = Require<Button>("voiceToggleButton");
            _micLevel = Require<VisualElement>("micLevel");
            _roleLevel = Require<VisualElement>("roleLevel");
            var chatButton = Require<Button>("openChatButton");
            chatButton.focusable = true; chatButton.tabIndex = 0;
            chatButton.clicked += () => OpenChatRequested?.Invoke();
            _voiceToggleButton.focusable = true; _voiceToggleButton.tabIndex = 0;
            _voiceToggleButton.clicked += () => VoiceCommand?.Invoke(!_voiceEnabled || !string.IsNullOrEmpty(_voiceError));
            var moreButton = Require<Button>("quickMoreButton");
            moreButton.focusable = true; moreButton.tabIndex = 0;
            moreButton.clicked += TogglePrimaryMenu;
            _dock.RegisterCallback<GeometryChangedEvent>(_ => { _dragManipulator?.RefreshBounds(); RefreshLayout(); });
            _bounds.RegisterCallback<GeometryChangedEvent>(_ => RefreshLayout());
            _tooltip = Require<AvatarHudTooltipElement>("hudTooltip");
            _modelName = Require<Label>("modelNameLabel");
            _actionLabel = Require<Label>("actionLabel");
            _noticeLabel = Require<Label>("noticeLabel");
            _primaryGroup = Require<VisualElement>("primaryMenu");
            _panelTransition = new AvatarHudTransition(_primaryGroup);
            _tabIndicator = Require<VisualElement>("tabIndicator");
            _tabIndicator.parent.RegisterCallback<GeometryChangedEvent>(_ => RefreshTabIndicator());
            _centralButton = Require<Button>("centralMenuButton");
            _centralButton.focusable = true; _centralButton.tabIndex = 0;
            _centralButton.clicked += OnCentralButtonClicked;
            if (_centralButton.clickable != null)
            {
                _centralButton.RemoveManipulator(_centralButton.clickable);
            }
            _centralButton.RegisterCallback<NavigationSubmitEvent>(_ => OnCentralButtonClicked());
            _dragManipulator = new AvatarHudDragManipulator(
                _dock,
                _bounds,
                OnCentralButtonClicked,
                OnPointerInteractionChanged,
                (_, _) => RefreshLayout());
            _centralButton.AddManipulator(_dragManipulator);

            RegisterCategory(HudCategory.Model, "modelCategoryButton", "modelMenu");
            RegisterCategory(HudCategory.Affect, "affectCategoryButton", "affectMenu");
            RegisterCategory(HudCategory.Action, "actionCategoryButton", "actionMenu");
            RegisterCategory(HudCategory.More, "moreCategoryButton", "moreMenu");
            RegisterCategory(HudCategory.Shortcuts, "shortcutsCategoryButton", "shortcutsMenu");
            _gazeTrackingToggle = Require<Toggle>("gazeTrackingToggle");
            _gazeTrackingToggle.RegisterValueChangedCallback(evt => _runtime.ApplyBehavior(_runtime.Snapshot.Behavior.WithPointerGazeTracking(evt.newValue)));
            _showcaseControlToggle = Require<Toggle>("showcaseControlToggle");
            _showcaseControlToggle.RegisterValueChangedCallback(evt => SetCharacterShowcaseControlEnabled(evt.newValue));

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

            BuildActionMenu();
            _cancelActionButton = Require<Button>("cancelActionButton");
            _cancelActionButton.clicked += () => _runtime.CancelAction();

            _softOutlineToggle = Require<Toggle>("softOutlineToggle");
            _resetBehaviorButton = Require<Button>("resetBehaviorButton");
            _softOutlineToggle.RegisterValueChangedCallback(evt => _runtime.ApplyPresentation(_runtime.Snapshot.Presentation.WithSoftOutline(evt.newValue)));
            _resetBehaviorButton.clicked += () => _runtime.ResetBehavior();
            foreach (var name in new[] { "voiceToggleButton", "compactVoiceButton" })
            {
                var indicator = new VisualElement { pickingMode = PickingMode.Ignore };
                indicator.AddToClassList("mic-indicator");
                Require<Button>(name).Add(indicator);
            }
            _root.Query<Button>().ForEach(button => _tooltip.AttachTo(button, button.tooltip));
            _root.Query<Toggle>().ForEach(toggle => _tooltip.AttachTo(toggle, toggle.tooltip));
            CollapseMenus();
            SetVoiceState(false, "idle", null);
            SetActiveCategory(HudCategory.Model);
            Require<Button>("closePanelButton").clicked += ClosePanel;
            Require<Button>("compactVoiceButton").clicked += () => VoiceCommand?.Invoke(!_voiceEnabled || !string.IsNullOrEmpty(_voiceError));
            var scaleField = Require<DropdownField>("uiScaleField");
            scaleField.choices = new List<string> { "小", "标准", "大" };
            scaleField.RegisterValueChangedCallback(evt =>
            {
                if (scaleField.index >= 0 && scaleField.index < 3) SetScale(new[] { 0.85f, 1f, 1.15f }[scaleField.index]);
            });
            _root.RegisterCallback<KeyDownEvent>(evt => { if (evt.keyCode == KeyCode.Escape && _primaryExpanded) { ClosePanel(); evt.StopPropagation(); } });
            _root.Query<Button>().ForEach(button => { button.focusable = true; button.tabIndex = 0; });
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
            _pageTransitions.Add(category, new AvatarHudTransition(_categoryGroups[category]));
            button.clicked += () => ToggleCategory(category);
            button.RegisterCallback<GeometryChangedEvent>(_ => RefreshTabIndicator());
        }

        private void RegisterAffect(AvatarAffectPreset affect, string buttonName)
        {
            var button = Require<Button>(buttonName);
            _affectButtons.Add(affect, button);
            button.clicked += () => ApplyAffect(affect);
        }

        private void BuildActionMenu()
        {
            var group = Require<VisualElement>("actionChoices");
            group.Clear(); _actionButtons.Clear();
            foreach (var action in _runtime.AvailableActions)
            {
                var id = action.Id;
                var button = new Button(() => RequestAction(id)) { name = "action-" + id, text = action.DisplayName, tooltip = action.DisplayName };
                button.AddToClassList("choice-button");
                group.Add(button); _actionButtons.Add(id, button);
            }
            Require<Label>("emptyActionsLabel").style.display = _actionButtons.Count == 0 ? DisplayStyle.Flex : DisplayStyle.None;
        }

        private void TogglePrimaryMenu()
        {
            _primaryExpanded = !_primaryExpanded;
            if (_primaryExpanded) _panelTransition.Show(); else _panelTransition.Hide();
            Require<Button>("quickMoreButton").EnableInClassList(SelectedClass, _primaryExpanded);
            if (_primaryExpanded) { SetActiveCategory(_activeCategory ?? HudCategory.Model); RefreshLayout(); }
            _tooltip?.Hide();
        }

        private void ClosePanel() { CollapseMenus(); Require<Button>("quickMoreButton").Focus(); }

        private void OnCentralButtonClicked()
        {
            _dock.ToggleInClassList("is-compact");
            _centralButton.tooltip = (_dock.ClassListContains("is-compact") ? "展开控制栏" : "收起控制栏") + " · 拖动移动";
            CollapseMenus();
        }

        private void SetScale(float scale)
        {
            _uiScale = scale;
            PlayerPrefs.SetFloat("katarune.hud.scale", scale);
            RefreshDisplay();
        }

        private void RefreshDisplay()
        {
            if (_runtimePanel == null) return;
            AvatarHudLayout.GetDisplay(out var dpi, out var area);
            if (_runtimePanel.targetTexture == null)
            {
                _runtimePanel.scaleMode = PanelScaleMode.ConstantPixelSize;
                _runtimePanel.scale = AvatarHudLayout.Scale(dpi, _uiScale, area.width, area.height);
                var scale = _runtimePanel.scale;
                _bounds.style.left = area.xMin / scale;
                _bounds.style.top = area.yMin / scale;
                _bounds.style.right = (Screen.width - area.xMax) / scale;
                _bounds.style.bottom = (Screen.height - area.yMax) / scale;
            }
            Require<DropdownField>("uiScaleField").SetValueWithoutNotify(_uiScale < 0.95f ? "小" : _uiScale > 1.05f ? "大" : "标准");
            _dragManipulator?.RefreshBounds();
            RefreshLayout();
        }

        internal void RefreshLayout()
        {
            if (_bounds == null || _dock == null || !float.IsFinite(_bounds.layout.width)) return;
            var bounds = _bounds.worldBound;
            if (bounds.width < 1 || bounds.height < 1) return;
            var dock = new Rect(_dock.worldBound.position - bounds.position, _dock.worldBound.size);
            var panel = AvatarHudLayout.PlacePanel(dock, bounds.size);
            _primaryGroup.style.left = panel.x; _primaryGroup.style.top = panel.y;
            _primaryGroup.style.width = panel.width; _primaryGroup.style.height = panel.height;
            var opensBelow = panel.center.y > dock.center.y;
            _primaryGroup.EnableInClassList("opens-below", opensBelow);
            _primaryGroup.style.transformOrigin = new TransformOrigin(
                Length.Percent(Mathf.Clamp01((dock.center.x - panel.x) / panel.width) * 100),
                Length.Percent(opensBelow ? 0 : 100));
            var caption = Require<VisualElement>("subtitleRoot");
            var captionWidth = Mathf.Min(640, bounds.width - 32);
            var captionLeft = (bounds.width - captionWidth) / 2;
            var bottom = 24f;
            if (_visible && dock.xMax > captionLeft && dock.xMin < captionLeft + captionWidth)
                bottom = Mathf.Max(bottom, bounds.height - dock.yMin + 12);
            if (_visible && _primaryExpanded && panel.xMax > captionLeft && panel.xMin < captionLeft + captionWidth)
                bottom = Mathf.Max(bottom, bounds.height - panel.yMin + 12);
            caption.style.bottom = bottom;
            var scroll = _root.Q<ScrollView>("speechSubtitleScroll");
            if (scroll != null) { scroll.style.maxWidth = captionWidth; scroll.style.maxHeight = Mathf.Max(48, Mathf.Min(180, bounds.height - bottom - 16)); }
        }

        private void OnPointerInteractionChanged(bool active)
        {
            if (active) _tooltip?.Hide();
            PointerInteractionChanged?.Invoke(active);
        }

        private void ToggleCategory(HudCategory category)
        {
            if (_activeCategory == category) return;
            SetActiveCategory(category);
            Require<ScrollView>("hudPanelScroll").scrollOffset = Vector2.zero;
        }

        private void SetActiveCategory(HudCategory? category)
        {
            _activeCategory = category;
            foreach (var pair in _categoryGroups)
            {
                if (pair.Key == category) _pageTransitions[pair.Key].Show();
                else _pageTransitions[pair.Key].Hide(true);
            }
            foreach (var pair in _categoryButtons)
            {
                pair.Value.EnableInClassList(SelectedClass, pair.Key == category);
            }
            RefreshTabIndicator();
        }

        private void RefreshTabIndicator()
        {
            if (_tabIndicator == null || !_activeCategory.HasValue ||
                !_categoryButtons.TryGetValue(_activeCategory.Value, out var button)) return;
            var bounds = button.layout;
            if (float.IsNaN(bounds.width) || bounds.width <= 0) return;
            _tabIndicator.style.width = bounds.width;
            _tabIndicator.style.height = bounds.height;
            _tabIndicator.style.translate = new Translate(bounds.x, bounds.y);
        }

        private void CollapseMenus()
        {
            AvatarHudPopup.Close(_root);
            _primaryExpanded = false;
            _panelTransition?.Hide(!_visible);
            _root?.Q<Button>("quickMoreButton")?.RemoveFromClassList(SelectedClass);
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
            var intensity = affect == AvatarAffectPreset.Neutral ? 0f : DefaultAffectIntensity;
            _runtime.ApplyBehavior(_runtime.Snapshot.Behavior.WithAffect(affect, intensity));
        }

        private void RequestAction(string action)
        {
            var result = _runtime.RequestAction(action);
            if (result.Outcome != AvatarActionRequestOutcome.Started)
            {
                ShowNotice(string.IsNullOrWhiteSpace(result.Error) ? "当前动作不可用。" : result.Error);
            }
        }

        private void SetCharacterShowcaseControlEnabled(bool enabled)
        {
            if (CharacterShowcaseControlEnabled == enabled) return;
            CharacterShowcaseControlEnabled = enabled;
            _showcaseControlToggle?.SetValueWithoutNotify(enabled);
            CharacterShowcaseControlChanged?.Invoke(enabled);
        }

        internal void ShowNotice(string message)
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
            var actionsChanged = _runtime.AvailableActions.Count != _actionButtons.Count;
            foreach (var action in _runtime.AvailableActions)
                if (!_actionButtons.TryGetValue(action.Id, out var button) || button.text != action.DisplayName) actionsChanged = true;
            if (actionsChanged) BuildActionMenu();
            var notice = !string.IsNullOrWhiteSpace(_localNotice) ? _localNotice : snapshot.LastError;
            _noticeLabel.text = notice ?? string.Empty;
            _noticeLabel.EnableInClassList(VisibleClass, !string.IsNullOrWhiteSpace(notice));

            var ready = snapshot.RuntimeState == AvatarRuntimeState.Ready;
            var loading = snapshot.RuntimeState == AvatarRuntimeState.Loading;
            if (!ready) SetCharacterShowcaseControlEnabled(false);
            _selectModelButton.SetEnabled(!loading);
            _reloadModelButton.SetEnabled(snapshot.Model.HasValue && !loading);
            _unloadModelButton.SetEnabled(snapshot.Model.HasValue && !loading);

            foreach (var pair in _affectButtons)
            {
                pair.Value.SetEnabled(ready && snapshot.Capabilities.SupportsAffect(pair.Key));
                pair.Value.EnableInClassList(SelectedClass, snapshot.Behavior.Affect == pair.Key);
            }
            foreach (var pair in _actionButtons)
            {
                pair.Value.SetEnabled(ready && snapshot.Motion.LibraryAvailable);
                pair.Value.EnableInClassList(SelectedClass, snapshot.Motion.CurrentActionId == pair.Key);
            }
            _cancelActionButton.SetEnabled(ready && snapshot.Motion.CurrentActionId != null);
            _softOutlineToggle.SetValueWithoutNotify(snapshot.Presentation.SoftOutlineEnabled);
            _gazeTrackingToggle.SetValueWithoutNotify(snapshot.Behavior.PointerGazeTrackingEnabled);
            _showcaseControlToggle.SetEnabled(ready);
            _showcaseControlToggle.SetValueWithoutNotify(CharacterShowcaseControlEnabled);
        }

        internal bool IsScreenPositionOverInteractiveControl(Vector2 screenPosition)
        {
            var panel = _root?.panel;
            if (panel == null) return false;
            var clientPosition = new Vector2(screenPosition.x, Screen.height - screenPosition.y);
            var panelPosition = RuntimePanelUtils.ScreenToPanel(panel, clientPosition);
            return AvatarWindow.IsInteractivePick(panel.Pick(panelPosition), _root);
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

        private string GetActionStatusLabel(AvatarRuntimeSnapshot snapshot)
        {
            if (snapshot.RuntimeState == AvatarRuntimeState.Loading) return "正在准备角色";
            if (snapshot.RuntimeState == AvatarRuntimeState.Error && !snapshot.Model.HasValue)
            {
                return "等待重试";
            }
            if (snapshot.Motion.CurrentActionId != null)
            {
                return $"{GetActionLabel(snapshot.Motion.CurrentActionId)}中";
            }
            return snapshot.RuntimeState == AvatarRuntimeState.Ready
                ? (snapshot.Motion.AuthoredBaseActive ? "待机呼吸" : "基础姿态")
                : "无动作";
        }

        private string GetActionLabel(string id)
        {
            foreach (var action in _runtime.AvailableActions)
                if (action.Id == id) return action.DisplayName;
            return id;
        }

        private void OnDestroy()
        {
            if (_runtime != null) _runtime.Changed -= OnRuntimeChanged;
            if (_runtimePanel != null) Destroy(_runtimePanel);
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
            More,
            Shortcuts,
        }
    }
}
