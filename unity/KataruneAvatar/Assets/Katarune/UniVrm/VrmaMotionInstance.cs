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
using UniHumanoid;

namespace Katarune.Avatar
{
    internal interface IAvatarPackageModelLoader
    {
        Task<AvatarLoadCandidate> LoadPackageAsync(AvatarCharacterPackage package, AvatarPresentationSettings presentation, CancellationToken cancellationToken);
    }

    internal sealed class AvatarVrmAnimationTracks
    {
        internal readonly Dictionary<ExpressionKey, float> Expressions = new(ExpressionKey.Comparer);
        internal Vector2? LookAt;
        internal void Clear() { Expressions.Clear(); LookAt = null; }
    }

    // Imported legacy animation is sampled on its hidden source rig. The existing
    // motion controller owns time, transitions and cancellation and writes the
    // normalized target rig once, before the existing behavior/VRM processing.
    internal sealed class VrmaSource : IDisposable
    {
        private readonly GameObject _root;
        private readonly Animation _animation;
        private readonly AnimationState _state;
        private readonly InitRotationPoseProvider _pose;
        private readonly UnityEngine.Avatar _avatar;
        private readonly Dictionary<ExpressionKey, Transform> _expressions;
        private readonly Transform _lookAt;
        public float Duration => _state.length;
        private VrmaSource(GameObject root, Animation animation, AnimationState state, InitRotationPoseProvider pose,
            UnityEngine.Avatar avatar, Dictionary<ExpressionKey, Transform> expressions, Transform lookAt)
        { _root = root; _animation = animation; _state = state; _pose = pose; _avatar = avatar; _expressions = expressions; _lookAt = lookAt; }

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
            var expressionNodes = ValidateTracks(data, extension);
            // 0.131's VRMA importer removes expression nodes and all but the first scene root,
            // and does not import LookAt. Keep the complete glTF curves in its native importer;
            // humanoid normalization/retargeting below still use the same official implementation.
            using var importer = new UniGLTF.ImporterContext(data, materialGenerator: new UrpVrm10MaterialDescriptorGenerator(),
                settings: new ImporterContextSettings(invertAxis: Axes.X));
            var source = await importer.LoadAsync(new RuntimeOnlyAwaitCaller());
            UnityEngine.Avatar avatar = null;
            try
            {
                token.ThrowIfCancellationRequested();
                InitRotationPoseProvider pose = null;
                if (extension.Humanoid != null)
                {
                    var map = new List<(Transform, HumanBodyBones)>();
                    foreach (HumanBodyBones bone in Enum.GetValues(typeof(HumanBodyBones)))
                    {
                        if (bone is HumanBodyBones.LastBone or HumanBodyBones.LeftEye or HumanBodyBones.RightEye) continue;
                        var name = bone.ToString().Replace("ThumbProximal", "ThumbMetacarpal").Replace("ThumbIntermediate", "ThumbProximal");
                        var field = typeof(HumanBones).GetField(name);
                        if (field?.GetValue(extension.Humanoid.HumanBones) is UniGLTF.Extensions.VRMC_vrm_animation.HumanBone human && human.Node.HasValue)
                            map.Add((importer.Nodes[human.Node.Value], bone));
                    }
                    avatar = HumanoidLoader.BuildHumanAvatarFromMap(source.Root.transform, map);
                    if (avatar == null || !avatar.isHuman || !avatar.isValid) throw new InvalidDataException("VRMA 没有有效的 Humanoid 骨骼。");
                    var animator = source.Root.AddComponent<Animator>(); animator.avatar = avatar; animator.enabled = false;
                    var humanoid = source.Root.AddComponent<UniHumanoid.Humanoid>();
                    if (!humanoid.AssignBonesFromAnimator()) throw new InvalidDataException("VRMA 人体骨骼映射无效。");
                    pose = new InitRotationPoseProvider(source.Root.transform, humanoid);
                }
                var animation = source.Root.GetComponent<Animation>();
                if (animation?.clip == null || animation.clip.length <= 0f || animation.clip.length > 3600f || !float.IsFinite(animation.clip.length))
                    throw new InvalidDataException("VRMA 没有有效的动画或正时长。");
                animation.enabled = false; animation.playAutomatically = false;
                animation.cullingType = AnimationCullingType.AlwaysAnimate;
                animation.clip.wrapMode = WrapMode.ClampForever;
                foreach (AnimationState candidate in animation) candidate.enabled = false;
                var state = animation[animation.clip.name]; state.enabled = true; state.weight = 1f; state.speed = 0f; state.wrapMode = WrapMode.ClampForever;
                foreach (var renderer in source.Root.GetComponentsInChildren<Renderer>(true)) renderer.enabled = false;
                source.Root.hideFlags = HideFlags.HideAndDontSave;
                return new VrmaSource(source.Root, animation, state, pose, avatar,
                    expressionNodes.ToDictionary(pair => pair.Key, pair => importer.Nodes[pair.Value], ExpressionKey.Comparer),
                    extension.LookAt?.Node is int gaze ? importer.Nodes[gaze] : null);
            }
            catch { Destroy(avatar); Destroy(source.Root); throw; }
        }
        internal static Dictionary<ExpressionKey, int> ValidateTracks(GltfData data, VRMC_vrm_animation extension)
        {
            if (extension == null || extension.SpecVersion != "1.0") throw new InvalidDataException("动画必须是 VRMA 1.0。");
            var gltf = data.GLTF;
            if (gltf.nodes == null || gltf.nodes.Count == 0 || gltf.scene < 0 || gltf.scene >= gltf.scenes.Count)
                throw new InvalidDataException("VRMA 节点或场景无效。");
            var reachable = new HashSet<int>();
            var pending = new Stack<int>(gltf.rootnodes ?? Array.Empty<int>());
            while (pending.Count > 0)
            {
                var node = pending.Pop();
                if (node < 0 || node >= gltf.nodes.Count || !reachable.Add(node)) throw new InvalidDataException("VRMA 节点层级无效。");
                var value = gltf.nodes[node];
                if ((value.translation != null && (value.translation.Length != 3 || value.translation.Any(v => !float.IsFinite(v))))
                    || (value.rotation != null && (value.rotation.Length != 4 || value.rotation.Any(v => !float.IsFinite(v))))
                    || (value.scale != null && (value.scale.Length != 3 || value.scale.Any(v => !float.IsFinite(v))))
                    || (value.matrix != null && (value.matrix.Length != 16 || value.matrix.Any(v => !float.IsFinite(v)))))
                    throw new InvalidDataException("VRMA 节点变换无效。");
                foreach (var child in gltf.nodes[node].children ?? Array.Empty<int>()) pending.Push(child);
            }
            var assigned = new HashSet<int>(); var humanNodes = new HashSet<int>();
            int Node(int? value)
            {
                if (!value.HasValue || !reachable.Contains(value.Value) || !assigned.Add(value.Value))
                    throw new InvalidDataException("VRMA 轨道节点无效或重复。");
                return value.Value;
            }
            if (extension.Humanoid != null)
            {
                if (extension.Humanoid.HumanBones?.Hips?.Node == null) throw new InvalidDataException("VRMA 人体缺少 Hips。");
                foreach (var field in typeof(HumanBones).GetFields())
                    if (field.GetValue(extension.Humanoid.HumanBones) is UniGLTF.Extensions.VRMC_vrm_animation.HumanBone bone)
                        humanNodes.Add(Node(bone.Node));
            }
            var expressions = new Dictionary<ExpressionKey, int>(ExpressionKey.Comparer);
            if (extension.Expressions?.Preset != null)
                foreach (var field in typeof(Preset).GetFields())
                    if (field.GetValue(extension.Expressions.Preset) is UniGLTF.Extensions.VRMC_vrm_animation.Expression expression)
                    {
                        if (!Enum.TryParse<ExpressionPreset>(field.Name, true, out var preset) || preset == ExpressionPreset.custom)
                            throw new InvalidDataException("VRMA 预设表情无效。");
                        expressions.Add(ExpressionKey.CreateFromPreset(preset), Node(expression.Node));
                    }
            foreach (var pair in extension.Expressions?.Custom ?? new Dictionary<string, UniGLTF.Extensions.VRMC_vrm_animation.Expression>())
            {
                if (string.IsNullOrWhiteSpace(pair.Key) || Enum.GetNames(typeof(ExpressionPreset)).Any(name => name != "custom" && name == pair.Key))
                    throw new InvalidDataException("VRMA 自定义表情名称无效。");
                expressions.Add(ExpressionKey.CreateCustom(pair.Key), Node(pair.Value?.Node));
            }
            var expressionSet = new HashSet<int>(expressions.Values);
            int? lookAt = extension.LookAt?.Node is int gaze ? Node(gaze) : null;
            if (extension.LookAt?.OffsetFromHeadBone is float[] offset && (offset.Length != 3 || offset.Any(value => !float.IsFinite(value))))
                throw new InvalidDataException("VRMA 视线原点无效。");
            if (gltf.animations == null || gltf.animations.Count != 1 || gltf.animations[0].channels.Count == 0)
                throw new InvalidDataException("每个 VRMA 必须包含一段非空动画。");
            var animation = gltf.animations[0]; var targets = new HashSet<(int, string)>();
            foreach (var channel in animation.channels)
            {
                var target = channel.target;
                if (target == null || !targets.Add((target.node, target.path)) ||
                    !(humanNodes.Contains(target.node) && (target.path == "rotation" || (target.path == "translation" && target.node == extension.Humanoid.HumanBones.Hips.Node))
                        || expressionSet.Contains(target.node) && target.path == "translation" || target.node == lookAt && target.path == "rotation"))
                    throw new InvalidDataException("动画包含不符合 VRMA 规范的轨道。");
                if (channel.sampler < 0 || channel.sampler >= animation.samplers.Count) throw new InvalidDataException("VRMA 动画采样器无效。");
                var sampler = animation.samplers[channel.sampler];
                if (sampler.input < 0 || sampler.input >= gltf.accessors.Count || sampler.output < 0 || sampler.output >= gltf.accessors.Count)
                    throw new InvalidDataException("VRMA 动画数据引用无效。");
                var input = gltf.accessors[sampler.input]; var output = gltf.accessors[sampler.output];
                var cubic = sampler.interpolation == "CUBICSPLINE";
                if ((sampler.interpolation != null && sampler.interpolation != "" && sampler.interpolation != "LINEAR" && sampler.interpolation != "STEP" && !cubic)
                    || input.type != "SCALAR" || input.componentType != glComponentType.FLOAT || input.count <= 0
                    || output.componentType != glComponentType.FLOAT || output.type != (target.path == "rotation" ? "VEC4" : "VEC3")
                    || (long)output.count != (long)input.count * (cubic ? 3 : 1))
                    throw new InvalidDataException("VRMA 动画采样数据无效。");
                var times = data.GetArrayFromAccessor<float>(sampler.input).ToArray();
                var previous = -1f;
                foreach (var time in times)
                { if (!float.IsFinite(time) || time < 0 || time <= previous || time > 3600f) throw new InvalidDataException("VRMA 动画时间无效。"); previous = time; }
                var values = data.FlatternFloatArrayFromAccessor(sampler.output).ToArray();
                if (values.Any(value => !float.IsFinite(value))) throw new InvalidDataException("VRMA 动画包含无效数值。");
                if (target.path == "rotation")
                    for (var key = 0; key < input.count; key++)
                    {
                        var keyOffset = cubic ? key * 12 + 4 : key * 4;
                        var norm = 0f; for (var component = 0; component < 4; component++) norm += values[keyOffset + component] * values[keyOffset + component];
                        if (!float.IsFinite(norm) || Mathf.Abs(norm - 1f) > .01f) throw new InvalidDataException("VRMA 动画旋转须为单位四元数。");
                    }
            }
            return expressions;
        }
        internal static void ValidateSelfContained(GltfData data)
        {
            foreach (var buffer in data.GLTF.buffers)
                if (!string.IsNullOrEmpty(buffer.uri) && !buffer.uri.StartsWith("data:", StringComparison.Ordinal)) throw new InvalidDataException("资源引用了外部 buffer。");
            if (data.GLTF.images != null)
                foreach (var image in data.GLTF.images)
                    if (!string.IsNullOrEmpty(image.uri) && !image.uri.StartsWith("data:", StringComparison.Ordinal)) throw new InvalidDataException("资源引用了外部图像。");
        }
        public void Sample(float time, Vrm10RuntimeControlRig target, AvatarVrmAnimationTracks tracks = null)
        {
            // Sampling a clip directly also works for expression-only rigs without renderers/Animator.
            _animation.clip.SampleAnimation(_root, Mathf.Clamp(time, 0f, Duration));
            if (tracks != null)
            {
                foreach (var pair in _expressions)
                {
                    // The native importer reverses glTF X once. The expression weight is the original glTF X.
                    var value = -pair.Value.localPosition.x;
                    if (!float.IsFinite(value)) throw new InvalidDataException("VRMA 表情采样产生无效数值。");
                    tracks.Expressions[pair.Key] = Mathf.Clamp01(value);
                }
                if (_lookAt != null) tracks.LookAt = GazeAngles(_lookAt.localRotation);
            }
            if (_pose == null) return;
            Vrm10Retarget.Retarget((_pose, _pose), (target, target));
            var hips = target.GetBoneTransform(HumanBodyBones.Hips);
            if (hips == null || !float.IsFinite(hips.position.x) || !float.IsFinite(hips.position.y) || !float.IsFinite(hips.position.z)) throw new InvalidDataException("动画重定向产生无效姿态。");
            for (var bone = 0; bone < (int)HumanBodyBones.LastBone; bone++) {
                var transform = target.GetBoneTransform((HumanBodyBones)bone);
                if (transform == null) continue;
                var rotation = transform.localRotation;
                if (!float.IsFinite(rotation.x) || !float.IsFinite(rotation.y) || !float.IsFinite(rotation.z) || !float.IsFinite(rotation.w)) throw new InvalidDataException("动画重定向产生无效旋转。");
            }
        }
        internal static Vector2 GazeAngles(Quaternion rotation)
        {
            if (!float.IsFinite(rotation.x) || !float.IsFinite(rotation.y) || !float.IsFinite(rotation.z) || !float.IsFinite(rotation.w)
                || Quaternion.Dot(rotation, rotation) < .000001f) throw new InvalidDataException("VRMA 视线旋转无效。");
            // Unity's Euler decomposition is extrinsic ZXY, as required by VRMA. Pitch is up-positive in UniVRM.
            var angles = rotation.normalized.eulerAngles;
            return new Vector2(Mathf.DeltaAngle(0f, angles.y), -Mathf.DeltaAngle(0f, angles.x));
        }
        private static void Destroy(UnityEngine.Object value)
        { if (value == null) return; if (Application.isPlaying) UnityEngine.Object.Destroy(value); else UnityEngine.Object.DestroyImmediate(value); }
        public void Dispose() { Destroy(_avatar); Destroy(_root); }
    }

    internal sealed class VrmaMotionInstance : IAvatarMotionInstance, IAvatarMotionCatalog, IAvatarActionControl, IAvatarDanceRuntime
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
        private readonly Dictionary<string, AvatarPackagePlayback> _dances = new(StringComparer.Ordinal);
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
        private string _danceId;
        private float _danceTime, _danceBlendTime, _danceWeight, _danceEndWeight;
        private bool _danceEnding;
        private long _danceRevision;
        private Quaternion[] _danceBaseRotations;
        private Vector3[] _danceBasePositions;
        public bool DanceActive => _danceId != null;
        public string DanceError { get; private set; }
        internal AvatarVrmAnimationTracks AnimationTracks { get; } = new();
        public IReadOnlyList<AvatarActionInfo> AvailableActions => _actions;
        public bool HasAuthoredBodyPose => !_disposed;
        public float ProceduralBodyWeight => HasAuthoredBodyPose ? 0f : 1f;
        public float ProceduralArmWeight => HasAuthoredBodyPose ? 0f : 1f;
        public string CurrentActionId => _danceId ?? (_variations.Contains(_controller.CurrentActionId) ? null : _controller.CurrentActionId);
        public string CurrentInstanceId => _controller.CurrentInstanceId;
        public AvatarPresetAction? CurrentAction => null;
        public ulong ActionSequence => _controller.ActionSequence;
        public AvatarActionCapabilities Actions => AvatarActionCapabilities.None;
        public long PerformanceRevision => _controller.Revision + _danceRevision;
        public int ActivePerformanceCount => _controller.ActiveCount + (DanceActive ? 1 : 0);
        public int QueuedPerformanceCount => _controller.QueuedCount;
        public string PerformanceDiagnostics => _controller.Diagnostics + (_danceId == null ? "" : $"; dance[action={_danceId}; time={_danceTime.ToString("F4", System.Globalization.CultureInfo.InvariantCulture)}; exiting={_danceEnding}]");
        public event Action Changed;
        private VrmaMotionInstance(Vrm10RuntimeControlRig target)
        {
            _target = target ?? throw new ArgumentNullException(nameof(target));
            for (var bone = 0; bone < (int)HumanBodyBones.LastBone; bone++)
            { var transform = target.GetBoneTransform((HumanBodyBones)bone); if (transform != null) { _bones.Add(transform); _boneIds.Add((HumanBodyBones)bone); } }
            foreach (var bone in _bones) { _fromRotations.Add(bone.localRotation); _fromPositions.Add(bone.localPosition); }
            _danceBaseRotations = new Quaternion[_bones.Count]; _danceBasePositions = new Vector3[_bones.Count];
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
            if (package == null || package.formatVersion != 3 || string.IsNullOrWhiteSpace(package.id)) throw new InvalidDataException("角色包描述无效。");
            var instance = new VrmaMotionInstance(model.Runtime.ControlRig);
            async Task<VrmaSource> Read(string path)
            {
                if (string.IsNullOrWhiteSpace(path)) throw new InvalidDataException("动作片段缺少资源。");
                if (instance._files.TryGetValue(path, out var shared)) return shared;
                var source = await VrmaSource.LoadAsync(path, token); instance._files.Add(path, source); return source;
            }
            async Task Add(AvatarPackageAction action)
            {
                if (action == null || !AvatarActionIds.IsValid(action.id) || instance._clips.ContainsKey(action.id)
                    || !Guid.TryParse(action.id, out _))
                    throw new InvalidDataException("动作 ID 无效或重复。");
                var playback = action.playback ?? throw new InvalidDataException("动作缺少播放定义。");
                if (playback.kind != "oneShot" && playback.kind != "loop" && playback.kind != "performance") throw new InvalidDataException("动作播放类型无效。");
                var loop = playback.kind == "loop";
                var dance = playback.kind == "performance";
                var layer = playback.layer switch { null or "" or "body" => PackageActionLayer.Body, "upperBody" => PackageActionLayer.UpperBody, "head" => PackageActionLayer.Head, _ => throw new InvalidDataException("动作通道无效。") };
                var blending = string.IsNullOrEmpty(playback.blending) ? (layer == PackageActionLayer.Head ? "additive" : "override") : playback.blending;
                if ((blending != "override" && blending != "additive") || (layer == PackageActionLayer.Body && blending == "additive") || (!string.IsNullOrEmpty(playback.reference) && blending != "additive"))
                    throw new InvalidDataException("动作混合定义无效。");
                if (!loop && (!string.IsNullOrEmpty(playback.enter) || !string.IsNullOrEmpty(playback.exit)))
                    throw new InvalidDataException("一次性动作不能包含循环片段。");
                if (dance && (layer != PackageActionLayer.Body || blending != "override" || !string.IsNullOrEmpty(playback.reference)))
                    throw new InvalidDataException("舞蹈使用全身覆盖播放。");
                if (!dance && (!string.IsNullOrEmpty(playback.audio) || !string.IsNullOrEmpty(playback.subtitles) || playback.HasCamera))
                    throw new InvalidDataException("伴奏、字幕和镜头仅用于舞蹈。");
                var clips = new Clips { Main = await Read(playback.motion), Additive = blending == "additive" };
                if (dance)
                {
                    if (playback.HasCamera && playback.camera.kind != "track" && playback.camera.kind != "presets") throw new InvalidDataException("镜头配置类型无效。");
                    if (playback.camera?.kind == "presets" && (!string.IsNullOrEmpty(playback.camera.file) || (playback.camera.keys?.Length ?? 0) == 0)) throw new InvalidDataException("预设镜头配置无效。");
                    if (playback.camera?.kind == "track")
                    {
                        if ((playback.camera.keys?.Length ?? 0) > 0) throw new InvalidDataException("镜头轨道与预设镜头不能同时配置。");
                        var track = await Task.Run(() => AvatarDanceCameraTrack.Read(playback.camera.file, playback.camera), token);
                        track.ValidateDuration(clips.Main.Duration);
                    }
                    if ((playback.camera?.keys?.Length ?? 0) > 64) throw new InvalidDataException("舞蹈镜头提示过多。");
                    var previous = -1f;
                    foreach (var cue in playback.camera?.keys ?? Array.Empty<AvatarDanceCameraCue>())
                    {
                        if (cue == null || !float.IsFinite(cue.at) || cue.at < 0 || cue.at <= previous || cue.at > clips.Main.Duration
                            || (cue.view != "overhead" && cue.view != "center" && cue.view != "closeup"))
                            throw new InvalidDataException("舞蹈镜头提示无效。");
                        previous = cue.at;
                    }
                    if (!string.IsNullOrEmpty(playback.audio))
                    {
                        AudioClip audio = null;
                        try
                        {
                            audio = await AvatarAudioClipLoader.LoadAsync(playback.audio, token);
                            if (audio.length > 3600f) throw new InvalidDataException("舞蹈伴奏不能超过一小时。");
                            if (audio.length + .05f < clips.Main.Duration) throw new InvalidDataException("舞蹈伴奏短于动作。");
                        }
                        finally { AvatarAudioClipLoader.Release(audio); }
                    }
                    if (!string.IsNullOrEmpty(playback.subtitles))
                    {
                        var subtitles = await Task.Run(() => AvatarDanceSubtitles.Read(playback.subtitles), token);
                        subtitles.ValidateDuration(clips.Main.Duration);
                    }
                    instance._dances.Add(action.id, playback);
                }
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
                    action.description, playback.kind, action.key, package.bindings?.FirstOrDefault(b => b.actionId == action.id)?.role, layer == PackageActionLayer.Head ? "head" : layer == PackageActionLayer.UpperBody ? "upperBody" : "body", package.idle?.@base == action.id || (package.idle?.variations?.Contains(action.id) ?? false)));
            }
            try
            {
                var keys = new HashSet<string>(StringComparer.Ordinal);
                foreach (var action in package.actions ?? Array.Empty<AvatarPackageAction>())
                {
                    if (action == null || string.IsNullOrEmpty(action.key) || !keys.Add(action.key)) throw new InvalidDataException("动作标识无效或重复。");
                    await Add(action);
                }
                AvatarPackageAction IdleAction(string id, string kind)
                {
                    var action = package.actions?.FirstOrDefault(a => a.id == id);
                    if (action?.playback?.kind != kind || (action.playback.layer != null && action.playback.layer != "" && action.playback.layer != "body") || (action.playback.blending != null && action.playback.blending != "" && action.playback.blending != "override")) throw new InvalidDataException("待机动作引用或播放类型无效。");
                    return action;
                }
                if (!string.IsNullOrEmpty(package.idle?.@base))
                {
                    var idle = IdleAction(package.idle.@base, "loop");
                    if (!string.IsNullOrEmpty(idle.playback.enter) || !string.IsNullOrEmpty(idle.playback.exit)) throw new InvalidDataException("基础待机只包含循环主体。");
                    instance._idle = instance._clips[idle.id].Main;
                }
                foreach (var id in package.idle?.variations ?? Array.Empty<string>())
                {
                    var variation = IdleAction(id, "oneShot");
                    if (instance._variations.Contains(variation.id)) throw new InvalidDataException("待机变化重复。");
                    instance._variations.Add(variation.id);
                }
                var roles = new HashSet<string>(StringComparer.Ordinal);
                foreach (var binding in package.bindings ?? Array.Empty<AvatarActionBinding>())
                    if (binding == null || string.IsNullOrWhiteSpace(binding.role) || !roles.Add(binding.role) || !instance._clips.ContainsKey(binding.actionId) || instance._dances.ContainsKey(binding.actionId)) throw new InvalidDataException("用途绑定无效。");
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
            if (DanceActive) return new AvatarActionRequestResult(AvatarActionRequestOutcome.Unavailable, "舞蹈正在播放。");
            if (_dances.ContainsKey(actionId)) return new AvatarActionRequestResult(AvatarActionRequestOutcome.Unavailable, "舞蹈需要独立播放入口。");
            _controller.Request(actionId);
            return new AvatarActionRequestResult(AvatarActionRequestOutcome.Started);
        }
        public bool FinishAction(string actionId, bool completeCycle = false) => !_disposed && _controller.Finish(actionId, completeCycle);
        public string GetActionInstanceId(string actionId) => _controller.InstanceFor(actionId);
        public bool CancelAction(string actionId) => !_disposed && _controller.CancelAction(actionId);
        public PerformanceInstanceState? GetActionState(string instanceId) => _controller.GetState(instanceId);
        public void CancelAction() { EndDance(true); _controller.Cancel(); }
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
            AnimationTracks.Clear();
            deltaTime = Mathf.Max(0f, deltaTime); _idleTime += deltaTime;
            if (!DanceActive) _controller.Tick(deltaTime);
            if (!DanceActive && _controller.ActiveCount == 0 && _variations.Count > 0 && (_untilVariation -= deltaTime) <= 0f)
                _controller.Request(_variations[UnityEngine.Random.Range(0, _variations.Count)]);
            if (_controller.CurrentActionId != null)
            {
                var clips = _clips[_controller.CurrentActionId];
                var source = _controller.Phase == PackageActionPhase.Enter ? clips.Enter : _controller.Phase == PackageActionPhase.Exit ? clips.Exit : clips.Main;
                source.Sample(_controller.Time, _target, AnimationTracks);
            }
            else if (_idle != null) _idle.Sample(_idleTime % _idle.Duration, _target, AnimationTracks);
            else FixedIdlePose.Default.Apply(_target);
            _generatedIdle?.Tick(deltaTime, !DanceActive && _controller.ActiveCount == 0);
            var body = _layers[0]; body.Time = Mathf.Min(body.Seconds, body.Time + deltaTime);
            var weight = body.Seconds > 0f ? body.Time / body.Seconds : 1f;
            for (var i = 0; i < _bones.Count; i++)
            { var bone = _bones[i]; bone.localRotation = body.Cache[i] = Quaternion.Slerp(body.From[i], bone.localRotation, weight); bone.localPosition = Vector3.Lerp(body.FromPositions[i], bone.localPosition, weight); body.Positions[i] = bone.localPosition; }
            ApplyLayer(PackageActionLayer.UpperBody, deltaTime);
            ApplyLayer(PackageActionLayer.Head, deltaTime);
            ApplyDance(deltaTime);
        }
        public AvatarPackagePlayback GetDancePlayback(string actionId) => !_disposed && _dances.TryGetValue(actionId, out var playback) ? playback : null;
        public void BeginDance(string actionId)
        {
            if (_disposed || DanceActive || !_dances.ContainsKey(actionId)) throw new InvalidOperationException("舞蹈不可用或已有舞蹈在播放。");
            _danceId = actionId; _danceTime = _danceBlendTime = _danceWeight = 0f; _danceEnding = false; DanceError = null;
            _danceRevision++; Changed?.Invoke();
        }
        public void SampleDance(string actionId, float seconds)
        {
            if (_danceId != actionId || _danceEnding || !float.IsFinite(seconds) || seconds < 0f) throw new InvalidOperationException("舞蹈播放游标无效。");
            _danceTime = Mathf.Min(seconds, _clips[actionId].Main.Duration);
        }
        public void EndDance(bool immediate = false)
        {
            if (_danceId == null) return;
            if (immediate) { _danceId = null; _danceEnding = false; _danceWeight = 0; AnimationTracks.Clear(); _danceRevision++; Changed?.Invoke(); }
            else if (!_danceEnding) { _danceEnding = true; _danceEndWeight = _danceWeight; _danceBlendTime = 0f; }
        }
        private void ApplyDance(float deltaTime)
        {
            if (_danceId == null || DanceError != null) return;
            var blend = _dances[_danceId].blendSeconds;
            _danceBlendTime += deltaTime;
            var t = blend > 0 ? Mathf.Clamp01(_danceBlendTime / blend) : 1f;
            _danceWeight = _danceEnding ? _danceEndWeight * (1f - t) : t;
            if (_danceEnding && t >= 1f) { EndDance(true); return; }
            for (var i = 0; i < _bones.Count; i++) { _danceBaseRotations[i] = _bones[i].localRotation; _danceBasePositions[i] = _bones[i].localPosition; }
            // A dance owns facial/gaze input too; its missing tracks mean neutral, never an idle overlay.
            AnimationTracks.Clear();
            try { _clips[_danceId].Main.Sample(_danceTime, _target, AnimationTracks); }
            catch (Exception error)
            {
                for (var i = 0; i < _bones.Count; i++) { _bones[i].localRotation = _danceBaseRotations[i]; _bones[i].localPosition = _danceBasePositions[i]; }
                DanceError = "舞蹈动作采样失败：" + error.Message;
                return;
            }
            for (var i = 0; i < _bones.Count; i++)
            {
                _bones[i].localRotation = Quaternion.Slerp(_danceBaseRotations[i], _bones[i].localRotation, _danceWeight);
                _bones[i].localPosition = Vector3.Lerp(_danceBasePositions[i], _bones[i].localPosition, _danceWeight);
            }
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
                source.Sample(lane.Time, _target, AnimationTracks);
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
            if (_disposed) return; EndDance(true); _disposed = true; _controller.Cancel(); _controller.LayerChanged -= OnLayerChanged;
            foreach (var source in _files.Values) source.Dispose(); _files.Clear(); _clips.Clear(); _variations.Clear();
            if (_generatedIdle != null) UnityEngine.Object.Destroy(_generatedIdle);
        }
    }
}
