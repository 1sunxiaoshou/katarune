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
                throw new InvalidDataException("角色包 v1 不支持 VRMA 表情或视线轨道。");
            var nodes = new HashSet<int>();
            foreach (var field in typeof(HumanBones).GetFields())
                if (field.GetValue(extension.Humanoid.HumanBones) is UniGLTF.Extensions.VRMC_vrm_animation.HumanBone bone && bone.Node.HasValue) nodes.Add(bone.Node.Value);
            if (data.GLTF.animations == null || data.GLTF.animations.Count != 1 || data.GLTF.animations[0].channels.Count == 0)
                throw new InvalidDataException("每个 VRMA 必须包含一段非空动画。");
            foreach (var channel in data.GLTF.animations[0].channels)
                if (channel.target == null || !nodes.Contains(channel.target.node) ||
                    (channel.target.path != "rotation" && !(channel.target.path == "translation" && channel.target.node == extension.Humanoid.HumanBones.Hips.Node)))
                    throw new InvalidDataException("动画包含 v1 不支持的轨道。");
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

    internal sealed class VrmaMotionInstance : IAvatarMotionInstance, IAvatarMotionCatalog
    {
        private const float TransitionSeconds = .2f;
        private readonly Vrm10RuntimeControlRig _target;
        private readonly Dictionary<string, VrmaSource> _sources = new(StringComparer.Ordinal);
        private readonly List<AvatarActionInfo> _actions = new();
        private readonly List<VrmaSource> _variations = new();
        private readonly List<Transform> _bones = new();
        private readonly List<Quaternion> _fromRotations = new();
        private readonly List<Vector3> _fromPositions = new();
        private VrmaSource _idle;
        private VrmaSource _playing;
        private float _time, _idleTime, _transition = TransitionSeconds, _untilVariation;
        private bool _returning, _system, _disposed;
        public IReadOnlyList<AvatarActionInfo> AvailableActions => _actions;
        public bool HasAuthoredBodyPose => !_disposed && (_idle != null || _playing != null);
        public float ProceduralBodyWeight => HasAuthoredBodyPose ? 0f : 1f;
        public float ProceduralArmWeight => HasAuthoredBodyPose ? 0f : 1f;
        public string CurrentActionId { get; private set; }
        public AvatarPresetAction? CurrentAction => null;
        public ulong ActionSequence { get; private set; }
        public AvatarActionCapabilities Actions => AvatarActionCapabilities.None;
        public long PerformanceRevision => 0;
        public int ActivePerformanceCount => 0;
        public int QueuedPerformanceCount => 0;
        public string PerformanceDiagnostics => string.Empty;
        public event Action Changed;
        private VrmaMotionInstance(Vrm10RuntimeControlRig target)
        {
            _target = target ?? throw new ArgumentNullException(nameof(target));
            for (var bone = 0; bone < (int)HumanBodyBones.LastBone; bone++)
            { var transform = target.GetBoneTransform((HumanBodyBones)bone); if (transform != null) _bones.Add(transform); }
            foreach (var bone in _bones) { _fromRotations.Add(bone.localRotation); _fromPositions.Add(bone.localPosition); }
            _untilVariation = UnityEngine.Random.Range(20f, 40f);
        }
        public static async Task<VrmaMotionInstance> PrepareAsync(Vrm10Instance model, AvatarCharacterPackage package, CancellationToken token)
        {
            if (package == null || string.IsNullOrWhiteSpace(package.id)) throw new InvalidDataException("角色包描述无效。");
            var instance = new VrmaMotionInstance(model.Runtime.ControlRig);
            var files = new Dictionary<string, VrmaSource>(StringComparer.Ordinal);
            async Task<VrmaSource> Read(string path)
            {
                if (files.TryGetValue(path, out var shared)) return shared;
                var source = await VrmaSource.LoadAsync(path, token); files.Add(path, source); return source;
            }
            try
            {
                if (!string.IsNullOrWhiteSpace(package.idle)) { instance._idle = await Read(package.idle); instance._sources.Add("idle", instance._idle); }
                foreach (var path in package.idleVariations ?? Array.Empty<string>()) instance._variations.Add(await Read(path));
                foreach (var action in package.customActions ?? Array.Empty<AvatarPackageAction>())
                {
                    if (!Guid.TryParse(action.id, out _) || instance._sources.ContainsKey(action.id)) throw new InvalidDataException("动作 ID 无效或重复。");
                    var source = await Read(action.file); instance._sources.Add(action.id, source);
                    instance._actions.Add(new AvatarActionInfo(action.id, action.name, source.Duration, action.description));
                }
                // Check retargeting on the candidate rig, without publishing its catalog.
                foreach (var source in files.Values) { token.ThrowIfCancellationRequested(); source.Sample(0f, instance._target); source.Sample(source.Duration * .5f, instance._target); }
                if (instance._idle != null) instance._idle.Sample(0f, instance._target);
                else Vrm10Retarget.EnforceTPose((instance._target, instance._target));
                return instance;
            }
            catch { foreach (var source in files.Values) source.Dispose(); throw; }
        }
        public AvatarActionRequestResult RequestAction(AvatarPresetAction action) => RequestAction(AvatarActionIds.FromPreset(action));
        public AvatarActionRequestResult RequestAction(string actionId)
        {
            if (_disposed || !_sources.TryGetValue(actionId, out var source) || actionId == "idle") return new AvatarActionRequestResult(AvatarActionRequestOutcome.Unavailable, "当前角色包没有该自定义动作。");
            Capture(); _playing = source; _time = 0f; _returning = false; _system = false; CurrentActionId = actionId; ActionSequence++; Changed?.Invoke();
            return new AvatarActionRequestResult(AvatarActionRequestOutcome.Started);
        }
        private void Capture()
        {
            for (var i = 0; i < _bones.Count; i++) { _fromRotations[i] = _bones[i].localRotation; _fromPositions[i] = _bones[i].localPosition; }
            _transition = 0f;
        }
        public void CancelAction() { if (_playing == null || _returning) return; Capture(); _returning = true; ActionSequence++; Changed?.Invoke(); }
        public void CancelAllBehaviors() => CancelAction();
        public BehaviorRequestResult RequestBehavior(BehaviorIntent intent, PerformanceRequestPolicy policy) => new(BehaviorRequestOutcome.Unavailable, error: "角色包动作由系统和自定义动作工具调度。");
        public PerformanceTransitionOutcome ApplyPerformanceCommand(string instanceId, PerformanceCommand command) => PerformanceTransitionOutcome.Rejected;
        public void Tick(float deltaTime)
        {
            if (_disposed) return;
            deltaTime = Mathf.Max(0f, deltaTime); _idleTime += deltaTime; _time += deltaTime;
            if (_playing != null && !_returning && _time >= _playing.Duration) { Capture(); _returning = true; }
            if (_playing == null && _variations.Count > 0 && (_untilVariation -= deltaTime) <= 0f)
            { Capture(); _playing = _variations[UnityEngine.Random.Range(0, _variations.Count)]; _time = 0f; _system = true; _returning = false; }
            if (_playing == null || _returning) { if (_idle != null) _idle.Sample(_idleTime % _idle.Duration, _target); else Vrm10Retarget.EnforceTPose((_target, _target)); } else _playing.Sample(_time, _target);
            _transition = Mathf.Min(TransitionSeconds, _transition + deltaTime); var weight = _transition / TransitionSeconds;
            for (var i = 0; i < _bones.Count; i++)
            { var bone = _bones[i]; bone.localRotation = Quaternion.Slerp(_fromRotations[i], bone.localRotation, weight); bone.localPosition = Vector3.Lerp(_fromPositions[i], bone.localPosition, weight); }
            if (_returning && _transition >= TransitionSeconds)
            { _playing = null; _returning = false; CurrentActionId = null; _untilVariation = UnityEngine.Random.Range(20f, 40f); if (!_system) Changed?.Invoke(); _system = false; }
        }
        public void Dispose()
        {
            if (_disposed) return; _disposed = true;
            foreach (var source in _sources.Values.Concat(_variations).Distinct()) source.Dispose();
            _sources.Clear(); _variations.Clear();
        }
    }
}
