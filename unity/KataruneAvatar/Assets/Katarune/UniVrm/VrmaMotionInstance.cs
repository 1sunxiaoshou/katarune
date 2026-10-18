using UniJSON;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using UniGLTF;
using UniGLTF.Extensions.VRMC_vrm_animation;
using UniVRM10;
using UnityEngine;

namespace Katarune.Avatar
{
    internal interface IAvatarPackageModelLoader
    {
        Task<AvatarLoadCandidate> LoadPackageAsync(AvatarCharacterPackage package, AvatarPresentationSettings presentation, CancellationToken cancellationToken);
    }

    // Imported legacy animation is sampled on its hidden source rig. The existing
    // motion controller owns time, transitions and cancellation and writes the
    // normalized target rig once, before the existing behavior/VRM processing.
    internal sealed class VrmaSource : IDisposable
    {
        private readonly GameObject _root;
        private readonly Animation _animation;
        private readonly AnimationState _state;
        private readonly Vrm10AnimationInstance _instance;
        public float Duration => _state.length;
        private VrmaSource(GameObject root, Animation animation, AnimationState state, Vrm10AnimationInstance instance)
        { _root = root; _animation = animation; _state = state; _instance = instance; }

        public static async Task<VrmaSource> LoadAsync(string path, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            var bytes = await Task.Run(() => File.ReadAllBytes(path), token);
            using var data = new GlbLowLevelParser(path, bytes).Parse();
            ValidateSelfContained(data);
            VRMC_vrm_animation extension = null;
            if (data.GLTF.extensions is glTFExtensionImport extensions)
                foreach (var entry in extensions.ObjectItems())
                    if (entry.Key.GetString() == VRMC_vrm_animation.ExtensionName)
                        extension = UniGLTF.Extensions.VRMC_vrm_animation.GltfDeserializer.Deserialize(entry.Value);
            if (extension == null || extension.SpecVersion != "1.0" || extension.Humanoid?.HumanBones?.Hips?.Node == null)
                throw new InvalidDataException("动画必须是 VRMA 1.0 Humanoid 动画。");
            if (extension.Expressions != null || extension.LookAt != null)
                throw new InvalidDataException("角色包暂不支持 VRMA 表情或视线轨道。");
            var nodes = new HashSet<int>();
            foreach (var field in typeof(HumanBones).GetFields())
                if (field.GetValue(extension.Humanoid.HumanBones) is UniGLTF.Extensions.VRMC_vrm_animation.HumanBone bone && bone.Node.HasValue) nodes.Add(bone.Node.Value);
            if (data.GLTF.animations == null || data.GLTF.animations.Count != 1 || data.GLTF.animations[0].channels.Count == 0)
                throw new InvalidDataException("每个 VRMA 必须包含一段非空动画。");
            foreach (var channel in data.GLTF.animations[0].channels)
                if (channel.target == null || !nodes.Contains(channel.target.node) ||
                    (channel.target.path != "rotation" && !(channel.target.path == "translation" && channel.target.node == extension.Humanoid.HumanBones.Hips.Node)))
                    throw new InvalidDataException("动画包含不支持的轨道。");
            using var importer = new VrmAnimationImporter(new VrmAnimationData(data), materialGenerator: new UrpVrm10MaterialDescriptorGenerator());
            var source = await importer.LoadAsync(new RuntimeOnlyAwaitCaller());
            try
            {
                token.ThrowIfCancellationRequested();
                var animator = source.Root.GetComponent<Animator>();
                var animation = source.Root.GetComponent<Animation>();
                var instance = source.Root.GetComponent<Vrm10AnimationInstance>();
                if (animator == null || !animator.avatar.isHuman || animation?.clip == null || instance?.ControlRig.Item1 == null || animation.clip.length <= 0f || animation.clip.length > 3600f || !float.IsFinite(animation.clip.length))
                    throw new InvalidDataException("VRMA 没有有效的 Humanoid 动画或正时长。");
                animator.enabled = false; animation.enabled = false; animation.playAutomatically = false;
                foreach (AnimationState candidate in animation) candidate.enabled = false;
                var state = animation[animation.clip.name]; state.enabled = true; state.weight = 1f; state.speed = 0f; state.wrapMode = WrapMode.ClampForever;
                foreach (var renderer in source.Root.GetComponentsInChildren<Renderer>(true)) renderer.enabled = false;
                source.Root.hideFlags = HideFlags.HideAndDontSave;
                return new VrmaSource(source.Root, animation, state, instance);
            }
            catch { UnityEngine.Object.Destroy(source.Root); throw; }
        }
        internal static void ValidateSelfContained(GltfData data)
        {
            foreach (var buffer in data.GLTF.buffers)
                if (!string.IsNullOrEmpty(buffer.uri) && !buffer.uri.StartsWith("data:", StringComparison.Ordinal)) throw new InvalidDataException("资源引用了外部 buffer。");
            if (data.GLTF.images != null)
                foreach (var image in data.GLTF.images)
                    if (!string.IsNullOrEmpty(image.uri) && !image.uri.StartsWith("data:", StringComparison.Ordinal)) throw new InvalidDataException("资源引用了外部图像。");
        }
        public void Sample(float time, Vrm10RuntimeControlRig target)
        {
            _state.time = Mathf.Clamp(time, 0f, Duration); _animation.Sample();
            Vrm10Retarget.Retarget(_instance.ControlRig, (target, target));
            var hips = target.GetBoneTransform(HumanBodyBones.Hips);
            if (hips == null || !float.IsFinite(hips.position.x) || !float.IsFinite(hips.position.y) || !float.IsFinite(hips.position.z)) throw new InvalidDataException("动画重定向产生无效姿态。");
            for (var bone = 0; bone < (int)HumanBodyBones.LastBone; bone++) {
                var transform = target.GetBoneTransform((HumanBodyBones)bone);
                if (transform == null) continue;
                var rotation = transform.localRotation;
                if (!float.IsFinite(rotation.x) || !float.IsFinite(rotation.y) || !float.IsFinite(rotation.z) || !float.IsFinite(rotation.w)) throw new InvalidDataException("动画重定向产生无效旋转。");
            }
        }
        public void Dispose() { if (_root != null) UnityEngine.Object.Destroy(_root); }
    }

    internal sealed class VrmaMotionInstance : IAvatarMotionInstance, IAvatarMotionCatalog, IAvatarActionControl
    {
        private sealed class Clips
        {
            public VrmaSource Enter, Main, Exit;
            public bool Additive;
            public Quaternion[] Reference;
        }
        private sealed class LayerBlend
        {
            public Quaternion[] From, Cache;
            public Vector3[] Positions, FromPositions;
            public float Time, Seconds = .2f;
            public bool Additive;
            public string ActionId;
            public PackageActionPhase Phase;
        }
        private readonly Vrm10RuntimeControlRig _target;
        private readonly Dictionary<string, VrmaSource> _files = new(StringComparer.Ordinal);
        private readonly Dictionary<string, Clips> _clips = new(StringComparer.Ordinal);
        private readonly List<AvatarActionInfo> _actions = new();
        private readonly List<string> _variations = new();
        private readonly List<Transform> _bones = new();
        private readonly List<HumanBodyBones> _boneIds = new();
        private readonly List<Quaternion> _fromRotations = new();
        private readonly List<Vector3> _fromPositions = new();
        private readonly PackageActionController _controller = new();
        private readonly LayerBlend[] _layers = new LayerBlend[3];
        private VrmaSource _idle;
        private AdaptiveIdlePlayback _generatedIdle;
        private float _idleTime, _untilVariation;
        private bool _disposed;
        public IReadOnlyList<AvatarActionInfo> AvailableActions => _actions;
        public bool HasAuthoredBodyPose => !_disposed;
        public float ProceduralBodyWeight => HasAuthoredBodyPose ? 0f : 1f;
        public float ProceduralArmWeight => HasAuthoredBodyPose ? 0f : 1f;
        public string CurrentActionId => _variations.Contains(_controller.CurrentActionId) ? null : _controller.CurrentActionId;
        public string CurrentInstanceId => _controller.CurrentInstanceId;
        public AvatarPresetAction? CurrentAction => null;
        public ulong ActionSequence => _controller.ActionSequence;
        public AvatarActionCapabilities Actions => AvatarActionCapabilities.None;
        public long PerformanceRevision => _controller.Revision;
        public int ActivePerformanceCount => _controller.ActiveCount;
        public int QueuedPerformanceCount => _controller.QueuedCount;
        public string PerformanceDiagnostics => _controller.Diagnostics;
        public event Action Changed;
        private VrmaMotionInstance(Vrm10RuntimeControlRig target)
        {
            _target = target ?? throw new ArgumentNullException(nameof(target));
            for (var bone = 0; bone < (int)HumanBodyBones.LastBone; bone++)
            { var transform = target.GetBoneTransform((HumanBodyBones)bone); if (transform != null) { _bones.Add(transform); _boneIds.Add((HumanBodyBones)bone); } }
            foreach (var bone in _bones) { _fromRotations.Add(bone.localRotation); _fromPositions.Add(bone.localPosition); }
            for (var i = 0; i < _layers.Length; i++) _layers[i] = new LayerBlend { From = _fromRotations.ToArray(), Cache = _fromRotations.ToArray(), Positions = _fromPositions.ToArray(), FromPositions = _fromPositions.ToArray() };
            _controller.LayerChanged += OnLayerChanged;
            _untilVariation = UnityEngine.Random.Range(20f, 40f);
        }
        private void OnLayerChanged(PackageActionLayer layer)
        {
            var state = _layers[(int)layer]; var lane = _controller.Lane(layer);
            var continuous = state.ActionId == lane.CurrentActionId && (state.Phase == lane.Phase
                || (state.Phase == PackageActionPhase.Enter && lane.Phase == PackageActionPhase.Loop));
            state.ActionId = lane.CurrentActionId; state.Phase = lane.Phase;
            // Authored enter/loop clips already meet at the boundary. Preserve
            // their motion instead of starting another frozen-pose fade.
            if (continuous) { Changed?.Invoke(); return; }
            if (lane.CurrentActionId != null)
            {
                var additive = _clips[lane.CurrentActionId].Additive;
                if (additive != state.Additive)
                    for (var i = 0; i < _bones.Count; i++) state.Cache[i] = additive ? Quaternion.identity : _bones[i].localRotation;
                state.Additive = additive; state.Seconds = lane.BlendSeconds;
            }
            Array.Copy(state.Cache, state.From, state.Cache.Length); state.Time = 0f;
            Array.Copy(state.Positions, state.FromPositions, state.Positions.Length);
            _untilVariation = UnityEngine.Random.Range(20f, 40f); Changed?.Invoke();
        }
        public static async Task<VrmaMotionInstance> PrepareAsync(Vrm10Instance model, AvatarCharacterPackage package, byte[] modelBytes, CancellationToken token)
        {
            if (package == null || package.formatVersion != 2 || string.IsNullOrWhiteSpace(package.id)) throw new InvalidDataException("角色包描述无效。");
            var instance = new VrmaMotionInstance(model.Runtime.ControlRig);
            async Task<VrmaSource> Read(string path)
            {
                if (string.IsNullOrWhiteSpace(path)) throw new InvalidDataException("动作片段缺少资源。");
                if (instance._files.TryGetValue(path, out var shared)) return shared;
                var source = await VrmaSource.LoadAsync(path, token); instance._files.Add(path, source); return source;
            }
            async Task Add(AvatarPackageAction action, bool system)
            {
                if (action == null || !AvatarActionIds.IsValid(action.id) || instance._clips.ContainsKey(action.id)
                    || (system ? action.id != "system." + action.name?.ToLowerInvariant() : !Guid.TryParse(action.id, out _)))
                    throw new InvalidDataException("动作 ID 无效或重复。");
                var playback = action.playback ?? throw new InvalidDataException("动作缺少播放定义。");
                if (playback.kind != "oneShot" && playback.kind != "loop") throw new InvalidDataException("动作播放类型无效。");
                var loop = playback.kind == "loop";
                var layer = playback.layer switch { null or "" or "body" => PackageActionLayer.Body, "upperBody" => PackageActionLayer.UpperBody, "head" => PackageActionLayer.Head, _ => throw new InvalidDataException("动作通道无效。") };
                var blending = string.IsNullOrEmpty(playback.blending) ? (layer == PackageActionLayer.Head ? "additive" : "override") : playback.blending;
                if ((blending != "override" && blending != "additive") || (layer == PackageActionLayer.Body && blending == "additive") || (!string.IsNullOrEmpty(playback.reference) && blending != "additive"))
                    throw new InvalidDataException("动作混合定义无效。");
                if (!loop && (!string.IsNullOrEmpty(playback.enter) || !string.IsNullOrEmpty(playback.loop) || !string.IsNullOrEmpty(playback.exit)))
                    throw new InvalidDataException("一次性动作不能包含循环片段。");
                if (loop && !string.IsNullOrEmpty(playback.file)) throw new InvalidDataException("循环动作必须使用 loop 片段。");
                var clips = new Clips { Main = await Read(loop ? playback.loop : playback.file), Additive = blending == "additive" };
                if (loop && !string.IsNullOrEmpty(playback.enter)) clips.Enter = await Read(playback.enter);
                if (loop && !string.IsNullOrEmpty(playback.exit)) clips.Exit = await Read(playback.exit);
                if (clips.Additive)
                {
                    var reference = string.IsNullOrEmpty(playback.reference) ? clips.Enter ?? clips.Main : await Read(playback.reference);
                    reference.Sample(0f, instance._target); clips.Reference = instance._bones.Select(b => b.localRotation).ToArray();
                }
                instance._clips.Add(action.id, clips);
                instance._controller.Add(new PackageActionDefinition(action.id, loop, clips.Main.Duration,
                    clips.Enter?.Duration ?? 0f, clips.Exit?.Duration ?? 0f, playback.blendSeconds, layer));
                instance._actions.Add(new AvatarActionInfo(action.id, action.name, loop ? 0f : clips.Main.Duration,
                    action.description, playback.kind, action.key, system ? action.name : null, layer == PackageActionLayer.Head ? "head" : layer == PackageActionLayer.UpperBody ? "upperBody" : "body"));
            }
            try
            {
                if (!string.IsNullOrWhiteSpace(package.idle)) instance._idle = await Read(package.idle);
                foreach (var path in package.idleVariations ?? Array.Empty<string>())
                {
                    var source = await Read(path); var id = "idle.variation." + instance._variations.Count;
                    instance._variations.Add(id); instance._clips.Add(id, new Clips { Main = source });
                    instance._controller.Add(new PackageActionDefinition(id, false, source.Duration));
                }
                var keys = new HashSet<string>(StringComparer.Ordinal);
                foreach (var action in package.customActions ?? Array.Empty<AvatarPackageAction>())
                {
                    if (!string.IsNullOrEmpty(action.key) && !keys.Add(action.key)) throw new InvalidDataException("自定义动作标识重复。");
                    await Add(action, false);
                }
                foreach (var action in package.systemBehaviors ?? Array.Empty<AvatarPackageAction>()) await Add(action, true);
                foreach (var source in instance._files.Values)
                { token.ThrowIfCancellationRequested(); source.Sample(0f, instance._target); source.Sample(source.Duration * .5f, instance._target); }
                if (instance._idle != null) instance._idle.Sample(0f, instance._target);
                else
                {
                    FixedIdlePose.Default.Apply(instance._target);
                    var baked = await AdaptiveIdleBaker.PrepareAsync(model, modelBytes, token);
                    instance._generatedIdle = model.gameObject.AddComponent<AdaptiveIdlePlayback>();
                    instance._generatedIdle.Configure(baked); instance._generatedIdle.Tick(0f, true);
                }
                foreach (var state in instance._layers)
                    for (var i = 0; i < instance._bones.Count; i++) { state.From[i] = state.Cache[i] = instance._bones[i].localRotation; state.Positions[i] = state.FromPositions[i] = instance._bones[i].localPosition; }
                return instance;
            }
            catch { instance.Dispose(); throw; }
        }
        public AvatarActionRequestResult RequestAction(AvatarPresetAction action) => RequestAction(AvatarActionIds.FromPreset(action));
        public AvatarActionRequestResult RequestAction(string actionId)
        {
            if (_disposed || !_actions.Any(action => action.Id == actionId))
                return new AvatarActionRequestResult(AvatarActionRequestOutcome.Unavailable, "当前角色包没有该动作。");
            _controller.Request(actionId);
            return new AvatarActionRequestResult(AvatarActionRequestOutcome.Started);
        }
        public bool FinishAction(string actionId, bool completeCycle = false) => !_disposed && _controller.Finish(actionId, completeCycle);
        public string GetActionInstanceId(string actionId) => _controller.InstanceFor(actionId);
        public bool CancelAction(string actionId) => !_disposed && _controller.CancelAction(actionId);
        public PerformanceInstanceState? GetActionState(string instanceId) => _controller.GetState(instanceId);
        public void CancelAction() => _controller.Cancel();
        public void CancelAllBehaviors() => CancelAction();
        public BehaviorRequestResult RequestBehavior(BehaviorIntent intent, PerformanceRequestPolicy policy)
        {
            var result = RequestAction(intent.BehaviorId);
            return new BehaviorRequestResult(result.Outcome == AvatarActionRequestOutcome.Started ? BehaviorRequestOutcome.Started : BehaviorRequestOutcome.Unavailable,
                GetActionInstanceId(intent.BehaviorId), result.Error);
        }
        public PerformanceTransitionOutcome ApplyPerformanceCommand(string instanceId, PerformanceCommand command)
        {
            if (GetActionState(instanceId)?.IsTerminal() == true) return PerformanceTransitionOutcome.AlreadyTerminal;
            var actionId = _controller.ActionFor(instanceId);
            if (actionId == null) return PerformanceTransitionOutcome.Rejected;
            if (command.Kind == PerformanceCommandKind.CancelImmediate) return CancelAction(actionId) ? PerformanceTransitionOutcome.Applied : PerformanceTransitionOutcome.Rejected;
            if (command.Kind == PerformanceCommandKind.ExitAtSafePoint) return FinishAction(actionId) ? PerformanceTransitionOutcome.Applied : PerformanceTransitionOutcome.Unsupported;
            return PerformanceTransitionOutcome.Unsupported;
        }
        public void Tick(float deltaTime)
        {
            if (_disposed) return;
            deltaTime = Mathf.Max(0f, deltaTime); _idleTime += deltaTime; _controller.Tick(deltaTime);
            if (_controller.ActiveCount == 0 && _variations.Count > 0 && (_untilVariation -= deltaTime) <= 0f)
                _controller.Request(_variations[UnityEngine.Random.Range(0, _variations.Count)]);
            if (_controller.CurrentActionId != null)
            {
                var clips = _clips[_controller.CurrentActionId];
                var source = _controller.Phase == PackageActionPhase.Enter ? clips.Enter : _controller.Phase == PackageActionPhase.Exit ? clips.Exit : clips.Main;
                source.Sample(_controller.Time, _target);
            }
            else if (_idle != null) _idle.Sample(_idleTime % _idle.Duration, _target);
            else FixedIdlePose.Default.Apply(_target);
            _generatedIdle?.Tick(deltaTime, _controller.ActiveCount == 0);
            var body = _layers[0]; body.Time = Mathf.Min(body.Seconds, body.Time + deltaTime);
            var weight = body.Seconds > 0f ? body.Time / body.Seconds : 1f;
            for (var i = 0; i < _bones.Count; i++)
            { var bone = _bones[i]; bone.localRotation = body.Cache[i] = Quaternion.Slerp(body.From[i], bone.localRotation, weight); bone.localPosition = Vector3.Lerp(body.FromPositions[i], bone.localPosition, weight); body.Positions[i] = bone.localPosition; }
            ApplyLayer(PackageActionLayer.UpperBody, deltaTime);
            ApplyLayer(PackageActionLayer.Head, deltaTime);
        }
        internal static bool ContainsBone(PackageActionLayer layer, HumanBodyBones bone)
        {
            if (layer == PackageActionLayer.Body) return true;
            if (layer == PackageActionLayer.Head) return bone == HumanBodyBones.Neck || bone == HumanBodyBones.Head;
            return bone != HumanBodyBones.Hips && bone != HumanBodyBones.LeftUpperLeg && bone != HumanBodyBones.RightUpperLeg
                && bone != HumanBodyBones.LeftLowerLeg && bone != HumanBodyBones.RightLowerLeg && bone != HumanBodyBones.LeftFoot && bone != HumanBodyBones.RightFoot
                && bone != HumanBodyBones.LeftToes && bone != HumanBodyBones.RightToes && bone != HumanBodyBones.LeftEye && bone != HumanBodyBones.RightEye && bone != HumanBodyBones.Jaw;
        }
        private void ApplyLayer(PackageActionLayer layer, float deltaTime)
        {
            var lane = _controller.Lane(layer); var state = _layers[(int)layer];
            state.Time = Mathf.Min(state.Seconds, state.Time + deltaTime);
            var weight = state.Seconds > 0f ? state.Time / state.Seconds : 1f;
            for (var i = 0; i < _bones.Count; i++) { _fromRotations[i] = _bones[i].localRotation; _fromPositions[i] = _bones[i].localPosition; }
            Clips clips = null;
            if (lane.CurrentActionId != null)
            {
                clips = _clips[lane.CurrentActionId];
                var source = lane.Phase == PackageActionPhase.Enter ? clips.Enter : lane.Phase == PackageActionPhase.Exit ? clips.Exit : clips.Main;
                source.Sample(lane.Time, _target);
            }
            for (var i = 0; i < _bones.Count; i++)
            {
                var bone = _bones[i]; var basis = _fromRotations[i];
                if (!ContainsBone(layer, _boneIds[i])) bone.localRotation = basis;
                else
                {
                    var contribution = clips == null ? (state.Additive ? Quaternion.identity : basis)
                        : state.Additive ? Quaternion.Inverse(clips.Reference[i]) * bone.localRotation : bone.localRotation;
                    state.Cache[i] = Quaternion.Slerp(state.From[i], contribution, weight);
                    bone.localRotation = state.Additive ? basis * state.Cache[i] : state.Cache[i];
                }
                bone.localPosition = _fromPositions[i];
            }
        }
        public void Dispose()
        {
            if (_disposed) return; _disposed = true; _controller.Cancel(); _controller.LayerChanged -= OnLayerChanged;
            foreach (var source in _files.Values) source.Dispose(); _files.Clear(); _clips.Clear(); _variations.Clear();
            if (_generatedIdle != null) UnityEngine.Object.Destroy(_generatedIdle);
        }
    }
}
