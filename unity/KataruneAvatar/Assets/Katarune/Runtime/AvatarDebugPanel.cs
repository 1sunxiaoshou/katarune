using System;
using UnityEngine;

namespace Katarune.Avatar
{
    public sealed class AvatarDebugPanel : MonoBehaviour
    {
        private const float PanelWidth = 620f;
        private const float MaximumPanelHeight = 920f;
        private AvatarRuntimeSession _session;
        private AvatarBehaviorController _behavior;
        private string _modelPath = string.Empty;
        private bool _captureMode;
        private bool _handleHotkey;
        private bool _visible;
        private Vector2 _scroll;
        private Rect _windowRect = new Rect(32f, 32f, PanelWidth, MaximumPanelHeight);
        private float _fps;
        private float _fpsAccumulator;
        private int _fpsFrames;
        private readonly float[] _manualVisemes = new float[5];
        private Font _uiFont;
        private GUIStyle _windowStyle;
        private GUIStyle _labelStyle;
        private GUIStyle _sectionStyle;
        private GUIStyle _buttonStyle;
        private GUIStyle _toggleStyle;
        private GUIStyle _textFieldStyle;

        public event Action<bool> VisibilityChanged;

        public bool Visible => _visible;

        public void Configure(
            AvatarRuntimeSession session,
            AvatarBehaviorController behavior,
            string initialModelPath,
            bool visible,
            bool captureMode,
            bool handleHotkey)
        {
            _session = session ?? throw new ArgumentNullException(nameof(session));
            _behavior = behavior ?? throw new ArgumentNullException(nameof(behavior));
            _modelPath = initialModelPath ?? string.Empty;
            _captureMode = captureMode;
            _handleHotkey = handleHotkey;
            _visible = visible && !captureMode;
        }

        public void SetVisible(bool visible)
        {
            var next = visible && !_captureMode;
            if (_visible == next) return;
            _visible = next;
            VisibilityChanged?.Invoke(_visible);
        }

        public void ToggleVisible()
        {
            SetVisible(!_visible);
        }

        private void Update()
        {
            _fpsAccumulator += Time.unscaledDeltaTime;
            _fpsFrames += 1;
            if (_fpsAccumulator < 0.5f) return;
            _fps = _fpsAccumulator > 0f ? _fpsFrames / _fpsAccumulator : 0f;
            _fpsAccumulator = 0f;
            _fpsFrames = 0;
        }

        private void OnGUI()
        {
            var current = Event.current;
            if (_handleHotkey
                && !_captureMode
                && current.type == EventType.KeyDown
                && current.keyCode == KeyCode.F1)
            {
                ToggleVisible();
                current.Use();
            }
            if (!_visible || _session == null || _behavior == null) return;

            EnsureStyles();
            var availableWidth = Mathf.Max(360f, Screen.width - 64f);
            _windowRect.width = Mathf.Min(PanelWidth, availableWidth);
            _windowRect.height = Mathf.Min(Mathf.Max(420f, Screen.height - 64f), MaximumPanelHeight);
            _windowRect.x = Mathf.Clamp(_windowRect.x, 0f, Mathf.Max(0f, Screen.width - _windowRect.width));
            _windowRect.y = Mathf.Clamp(_windowRect.y, 0f, Mathf.Max(0f, Screen.height - _windowRect.height));
            _windowRect = GUI.Window(GetInstanceID(), _windowRect, DrawWindow, "言奏 · 形体调试（F1 隐藏）", _windowStyle);
        }

        private void DrawWindow(int id)
        {
            _scroll = GUILayout.BeginScrollView(_scroll);
            DrawRuntimeSection();
            DrawActivitySection();
            DrawAffectSection();
            DrawMotionSection();
            DrawGazeSection();
            DrawMouthSection();
            GUILayout.EndScrollView();
            GUI.DragWindow(new Rect(0f, 0f, _windowRect.width, 36f));
        }

        private void DrawRuntimeSection()
        {
            DrawSectionTitle("模型与运行状态");
            GUILayout.Label($"状态：{GetRuntimeLabel(_session.State)}    帧率：{_fps:F0} FPS", _labelStyle);
            if (_session.HasAvatar)
            {
                GUILayout.Label($"模型：{_session.ModelName}    高度：{_session.ModelHeight:F2} 米", _labelStyle);
            }
            if (!string.IsNullOrWhiteSpace(_session.LastError))
            {
                var previous = GUI.color;
                GUI.color = new Color(1f, 0.55f, 0.55f);
                GUILayout.Label($"错误：{_session.LastError}", _labelStyle);
                GUI.color = previous;
            }

            GUILayout.Label("VRM 绝对路径", _labelStyle);
            _modelPath = GUILayout.TextField(_modelPath ?? string.Empty, _textFieldStyle);
            GUILayout.BeginHorizontal();
            if (GUILayout.Button(_session.HasAvatar ? "加载其他模型" : "加载模型", _buttonStyle)) _ = _session.LoadAsync(_modelPath);
            GUI.enabled = _session.HasAvatar;
            if (GUILayout.Button("重新加载", _buttonStyle)) _ = _session.LoadAsync(_session.ModelPath);
            if (GUILayout.Button("卸载模型", _buttonStyle)) _session.Unload();
            GUI.enabled = true;
            GUILayout.EndHorizontal();
            GUILayout.Space(14f);
        }

        private void DrawActivitySection()
        {
            DrawSectionTitle("活动状态");
            GUILayout.BeginHorizontal();
            DrawActivityButton(AvatarActivityState.Idle, "待机");
            DrawActivityButton(AvatarActivityState.Listening, "倾听");
            DrawActivityButton(AvatarActivityState.Thinking, "思考");
            DrawActivityButton(AvatarActivityState.Speaking, "说话");
            GUILayout.EndHorizontal();
            if (GUILayout.Button("重置全部行为", _buttonStyle))
            {
                Array.Clear(_manualVisemes, 0, _manualVisemes.Length);
                _behavior.ResetBehavior();
            }
            GUILayout.Space(14f);
        }

        private void DrawActivityButton(AvatarActivityState activity, string label)
        {
            var previous = GUI.color;
            if (_behavior.Model.Activity == activity) GUI.color = new Color(0.55f, 0.8f, 1f);
            if (GUILayout.Button(label, _buttonStyle)) _behavior.SetActivity(activity);
            GUI.color = previous;
        }

        private void DrawAffectSection()
        {
            DrawSectionTitle("主表情");
            GUILayout.BeginHorizontal();
            DrawAffectButton(AvatarAffectPreset.Neutral, "自然");
            DrawAffectButton(AvatarAffectPreset.Happy, "开心");
            DrawAffectButton(AvatarAffectPreset.Relaxed, "放松");
            GUILayout.EndHorizontal();
            GUILayout.BeginHorizontal();
            DrawAffectButton(AvatarAffectPreset.Sad, "难过");
            DrawAffectButton(AvatarAffectPreset.Angry, "生气");
            DrawAffectButton(AvatarAffectPreset.Surprised, "惊讶");
            GUILayout.EndHorizontal();
            var affectIntensity = DrawSlider("表情强度", _behavior.Model.AffectIntensity, 0f, 1f);
            if (!Mathf.Approximately(affectIntensity, _behavior.Model.AffectIntensity))
            {
                _behavior.SetAffect(_behavior.Model.Affect, affectIntensity);
            }
            GUILayout.Space(14f);
        }

        private void DrawAffectButton(AvatarAffectPreset preset, string label)
        {
            var available = _behavior.SupportsAffect(preset);
            var selected = _behavior.Model.Affect == preset;
            var previous = GUI.color;
            if (selected) GUI.color = new Color(0.65f, 0.9f, 0.72f);
            GUI.enabled = available;
            if (GUILayout.Button(available ? label : $"{label}（不可用）", _buttonStyle) && !selected)
            {
                _behavior.SetAffect(preset, _behavior.Model.AffectIntensity);
            }
            GUI.enabled = true;
            GUI.color = previous;
        }

        private void DrawMotionSection()
        {
            DrawSectionTitle("程序化微动作");
            GUILayout.BeginHorizontal();
            _behavior.Model.BreathingEnabled = GUILayout.Toggle(_behavior.Model.BreathingEnabled, "呼吸", _toggleStyle);
            _behavior.Model.BlinkingEnabled = GUILayout.Toggle(_behavior.Model.BlinkingEnabled, "自动眨眼", _toggleStyle);
            _behavior.Model.SwayEnabled = GUILayout.Toggle(_behavior.Model.SwayEnabled, "身体摆动", _toggleStyle);
            GUILayout.EndHorizontal();
            _behavior.Model.BreathingIntensity = DrawSlider("呼吸强度", _behavior.Model.BreathingIntensity, 0f, 2f);
            _behavior.Model.SwayIntensity = DrawSlider("摆动强度", _behavior.Model.SwayIntensity, 0f, 2f);
            if (GUILayout.Button("立即眨眼", _buttonStyle)) _behavior.RequestBlink();
            GUILayout.Space(14f);
        }

        private void DrawGazeSection()
        {
            DrawSectionTitle("视线控制");
            GUILayout.BeginHorizontal();
            DrawGazeButton(AvatarGazeMode.Auto, "自动注视");
            DrawGazeButton(AvatarGazeMode.Pointer, "跟随鼠标");
            DrawGazeButton(AvatarGazeMode.Manual, "手动控制");
            GUILayout.EndHorizontal();
            var manual = _behavior.Model.ManualGaze;
            manual.x = DrawSlider("水平角度", manual.x, -18f, 18f);
            manual.y = DrawSlider("垂直角度", manual.y, -10f, 10f);
            _behavior.Model.ManualGaze = manual;
            var frame = _behavior.CurrentFrame;
            GUILayout.Label($"当前视线：水平 {frame.GazeYaw:F1}°    垂直 {frame.GazePitch:F1}°", _labelStyle);
            GUILayout.Space(14f);
        }

        private void DrawGazeButton(AvatarGazeMode mode, string label)
        {
            var selected = _behavior.Model.GazeMode == mode;
            var previous = GUI.color;
            if (selected) GUI.color = new Color(0.68f, 0.78f, 1f);
            if (GUILayout.Button(label, _buttonStyle) && !selected) _behavior.Model.GazeMode = mode;
            GUI.color = previous;
        }

        private void DrawMouthSection()
        {
            DrawSectionTitle("口型调试");
            _behavior.Model.AutoMouthEnabled = GUILayout.Toggle(_behavior.Model.AutoMouthEnabled, "说话状态自动生成伪口型", _toggleStyle);
            _behavior.Model.MouthIntensity = DrawSlider("自动口型强度", _behavior.Model.MouthIntensity, 0f, 1f);
            GUI.enabled = !_behavior.Model.AutoMouthEnabled;
            _manualVisemes[0] = DrawSlider("aa", _manualVisemes[0], 0f, 1f);
            _manualVisemes[1] = DrawSlider("ih", _manualVisemes[1], 0f, 1f);
            _manualVisemes[2] = DrawSlider("ou", _manualVisemes[2], 0f, 1f);
            _manualVisemes[3] = DrawSlider("ee", _manualVisemes[3], 0f, 1f);
            _manualVisemes[4] = DrawSlider("oh", _manualVisemes[4], 0f, 1f);
            GUI.enabled = true;
            _behavior.Model.SetManualVisemes(
                _manualVisemes[0],
                _manualVisemes[1],
                _manualVisemes[2],
                _manualVisemes[3],
                _manualVisemes[4]);
        }

        private float DrawSlider(string label, float value, float minimum, float maximum)
        {
            GUILayout.BeginHorizontal();
            GUILayout.Label(label, _labelStyle, GUILayout.Width(150f));
            value = GUILayout.HorizontalSlider(value, minimum, maximum, GUILayout.MinHeight(28f));
            GUILayout.Label(value.ToString("F2"), _labelStyle, GUILayout.Width(64f));
            GUILayout.EndHorizontal();
            return value;
        }

        private void DrawSectionTitle(string title)
        {
            GUILayout.Label(title, _sectionStyle);
            GUILayout.Space(4f);
        }

        private void EnsureStyles()
        {
            if (_windowStyle != null) return;
            _uiFont = Font.CreateDynamicFontFromOSFont(
                new[] { "Microsoft YaHei UI", "Microsoft YaHei", "Arial" },
                22);
            _windowStyle = new GUIStyle(GUI.skin.window) { font = _uiFont, fontSize = 20 };
            _labelStyle = new GUIStyle(GUI.skin.label)
            {
                font = _uiFont,
                fontSize = 18,
                wordWrap = true,
                alignment = TextAnchor.MiddleLeft,
            };
            _sectionStyle = new GUIStyle(_labelStyle)
            {
                fontSize = 22,
                fontStyle = FontStyle.Bold,
            };
            _buttonStyle = new GUIStyle(GUI.skin.button)
            {
                font = _uiFont,
                fontSize = 17,
                fixedHeight = 38f,
            };
            _toggleStyle = new GUIStyle(GUI.skin.toggle)
            {
                font = _uiFont,
                fontSize = 17,
                fixedHeight = 34f,
            };
            _textFieldStyle = new GUIStyle(GUI.skin.textField)
            {
                font = _uiFont,
                fontSize = 17,
                fixedHeight = 38f,
            };
        }

        private static string GetRuntimeLabel(AvatarRuntimeState state)
        {
            switch (state)
            {
                case AvatarRuntimeState.Loading: return "加载中";
                case AvatarRuntimeState.Ready: return "就绪";
                case AvatarRuntimeState.Error: return "错误";
                default: return "未加载";
            }
        }

        private void OnDestroy()
        {
            if (_uiFont != null) Destroy(_uiFont);
        }
    }
}
