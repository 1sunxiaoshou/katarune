using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UniHumanoid;
using UniVRM10;
using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;

namespace Katarune.Avatar
{
    internal interface IPackageMotionSource : IDisposable
    {
        float Duration { get; }
        void Sample(float time, Vrm10RuntimeControlRig target, AvatarVrmAnimationTracks tracks = null);
    }

    // A single manually evaluated graph per package. Only the normalized humanoid
    // bones are copied out; clips cannot animate components on the visible model.
    internal sealed class NativePackageMotionSampler : IDisposable
    {
        private readonly GameObject _root;
        private readonly UnityEngine.Avatar _avatar;
        private readonly Dictionary<HumanBodyBones, Transform> _bones;
        private readonly PlayableGraph _graph;
        private readonly AnimationPlayableOutput _output;

        internal NativePackageMotionSampler(Vrm10RuntimeControlRig target)
        {
            _root = new GameObject("Package Humanoid Sampler") { hideFlags = HideFlags.HideAndDontSave };
            try
            {
                var original = target.GetBoneTransform(HumanBodyBones.Hips).parent;
                var copy = UnityEngine.Object.Instantiate(original.gameObject, _root.transform, false).transform;
                copy.localPosition = Vector3.zero; copy.localRotation = Quaternion.identity; copy.localScale = Vector3.one;
                var originals = original.GetComponentsInChildren<Transform>();
                var copies = copy.GetComponentsInChildren<Transform>();
                _bones = target.Bones.ToDictionary(pair => pair.Key, pair => copies[Array.IndexOf(originals, pair.Value.ControlBone)]);
                var rest = target.Bones.ToDictionary(pair => _bones[pair.Key], pair => pair.Value.InitialTargetGlobalPosition);
                foreach (var bone in copies)
                {
                    bone.localScale = Vector3.one; bone.rotation = Quaternion.identity;
                    if (rest.TryGetValue(bone, out var position)) bone.position = position;
                }
                _avatar = HumanoidLoader.BuildHumanAvatarFromMap(_root.transform, _bones.Select(pair => (pair.Value, pair.Key)));
                if (_avatar == null || !_avatar.isValid || !_avatar.isHuman) throw new InvalidDataException("无法创建原生动画采样骨架。");
                var animator = _root.AddComponent<Animator>(); animator.avatar = _avatar;
                animator.applyRootMotion = false; animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
                _graph = PlayableGraph.Create("Package native motions"); _graph.SetTimeUpdateMode(DirectorUpdateMode.Manual);
                _output = AnimationPlayableOutput.Create(_graph, "Humanoid", animator);
                _graph.Play();
            }
            catch { Dispose(); throw; }
        }

        internal IPackageMotionSource Create(NativeMotionClipLease lease) => new Source(this, lease);
        private sealed class Source : IPackageMotionSource
        {
            private readonly NativePackageMotionSampler _owner;
            private NativeMotionClipLease _lease;
            private AnimationClipPlayable _playable;
            public float Duration => _lease.Clip.length;
            internal Source(NativePackageMotionSampler owner, NativeMotionClipLease lease)
            {
                _owner = owner; _lease = lease;
                _playable = AnimationClipPlayable.Create(owner._graph, lease.Clip);
                _playable.SetSpeed(0); _playable.SetApplyFootIK(lease.FootIK);
            }
            public void Sample(float time, Vrm10RuntimeControlRig target, AvatarVrmAnimationTracks tracks = null)
            {
                _owner._output.SetSourcePlayable(_playable);
                _playable.SetTime(Mathf.Clamp(time, 0, Duration));
                _owner._graph.Evaluate(0);
                _owner._root.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
                foreach (var (id, source) in _owner._bones)
                {
                    var destination = target.GetBoneTransform(id);
                    var p = source.localPosition; var q = source.localRotation;
                    if (!float.IsFinite(p.x) || !float.IsFinite(p.y) || !float.IsFinite(p.z)
                        || !float.IsFinite(q.x) || !float.IsFinite(q.y) || !float.IsFinite(q.z) || !float.IsFinite(q.w))
                        throw new InvalidDataException("原生动画采样产生无效姿态。");
                    destination.SetLocalPositionAndRotation(p, q);
                }
            }
            public void Dispose()
            {
                if (_lease == null) return;
                if (_playable.IsValid()) _owner._graph.DestroyPlayable(_playable);
                _lease.Dispose(); _lease = null;
            }
        }
        public void Dispose()
        {
            if (_graph.IsValid()) _graph.Destroy();
            if (_avatar != null) UnityEngine.Object.Destroy(_avatar);
            if (_root != null) UnityEngine.Object.Destroy(_root);
        }
    }
}
