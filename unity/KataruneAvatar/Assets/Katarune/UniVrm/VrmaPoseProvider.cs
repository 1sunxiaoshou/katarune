using System.Collections.Generic;
using UniVRM10;
using UnityEngine;

namespace Katarune.Avatar
{
    // UniVRM 0.131's InitRotationPoseProvider ignores parentBone and returns the
    // immediate local rotation. A target without an optional source joint then
    // loses that joint's rotation. Resolve the pose relative to the target's
    // actual humanoid parent, including any intervening source joints.
    internal sealed class VrmaPoseProvider : INormalizedPoseProvider
    {
        private readonly Transform _root;
        private readonly Quaternion _initialRootRotation;
        private readonly INormalizedPoseProvider _source;
        private readonly Dictionary<HumanBodyBones, BoneInitialRotation> _bones = new();

        internal VrmaPoseProvider(Transform root, IEnumerable<(Transform, HumanBodyBones)> map, INormalizedPoseProvider source)
        {
            _root = root;
            _initialRootRotation = root.rotation;
            _source = source;
            foreach (var (transform, bone) in map) _bones.Add(bone, new BoneInitialRotation(transform));
        }

        public Quaternion GetNormalizedLocalRotation(HumanBodyBones bone, HumanBodyBones parentBone)
        {
            if (!_bones.ContainsKey(bone)) return Quaternion.identity;
            while (parentBone != HumanBodyBones.LastBone && !_bones.ContainsKey(parentBone))
            {
                var definition = Vrm10HumanoidBoneSpecification.GetDefine(Vrm10HumanoidBoneSpecification.ConvertFromUnityBone(parentBone));
                parentBone = definition.ParentBone.HasValue
                    ? Vrm10HumanoidBoneSpecification.ConvertToUnityBone(definition.ParentBone.Value)
                    : HumanBodyBones.LastBone;
            }
            return Quaternion.Inverse(NormalizedWorld(parentBone)) * NormalizedWorld(bone);
        }

        private Quaternion NormalizedWorld(HumanBodyBones bone)
        {
            if (!_bones.TryGetValue(bone, out var value)) return Quaternion.identity;
            return Quaternion.Inverse(_root.rotation) * value.Transform.rotation
                * Quaternion.Inverse(value.InitialGlobalRotation) * _initialRootRotation;
        }

        public Vector3 GetRawHipsPosition() => _source.GetRawHipsPosition();
    }
}
