using System;
using System.Collections.Generic;
using UniVRM10;
using UnityEngine;

namespace Katarune.Avatar
{
    // Normalized humanoid pose; model-specific rest axes and proportions stay in ControlRig.
    public sealed class FixedIdlePose
    {
        [Serializable] private sealed class Entry { public string bone, parent; public float[] rotation; }
        [Serializable] private sealed class Data { public float[] hipsOffset; public Entry[] bones; }
        private readonly Dictionary<HumanBodyBones, (HumanBodyBones parent, Quaternion rotation)> _bones = new();
        private readonly Vector3 _hipsOffset;
        public string SourceJson { get; }
        private static FixedIdlePose _default;
        public static FixedIdlePose Default => _default ??= new FixedIdlePose(Resources.Load<TextAsset>("AvatarIdleBasePose")?.text
            ?? throw new InvalidOperationException("Missing fixed idle pose resource."));

        public FixedIdlePose(string json)
        {
            SourceJson = json;
            var data = JsonUtility.FromJson<Data>(json);
            if (data?.hipsOffset?.Length != 3 || data.bones == null || data.bones.Length > 55) throw new ArgumentException("Invalid idle pose.");
            _hipsOffset = new Vector3(data.hipsOffset[0], data.hipsOffset[1], data.hipsOffset[2]);
            if (!Finite(_hipsOffset.x) || !Finite(_hipsOffset.y) || !Finite(_hipsOffset.z) || _hipsOffset.magnitude > 1) throw new ArgumentException("Invalid idle hips offset.");
            foreach (var entry in data.bones)
            {
                if (!Enum.TryParse(entry.bone, out HumanBodyBones bone) || bone < 0 || bone >= HumanBodyBones.LastBone
                    || !Enum.TryParse(entry.parent, out HumanBodyBones parent) || parent < 0 || parent > HumanBodyBones.LastBone
                    || entry.rotation?.Length != 4 || _bones.ContainsKey(bone)) throw new ArgumentException("Invalid idle bone.");
                var q = new Quaternion(entry.rotation[0], entry.rotation[1], entry.rotation[2], entry.rotation[3]);
                if (!Finite(q.x) || !Finite(q.y) || !Finite(q.z) || !Finite(q.w) || Mathf.Abs(Quaternion.Dot(q, q) - 1) > .005f) throw new ArgumentException("Invalid idle rotation.");
                _bones.Add(bone, (parent, q.normalized));
            }
            foreach (var bone in _bones.Keys) RotationBetween(bone, HumanBodyBones.LastBone);
        }
        private static bool Finite(float x) => float.IsFinite(x);
        public Quaternion RotationBetween(HumanBodyBones bone, HumanBodyBones parent)
        {
            if (!_bones.ContainsKey(bone)) return Quaternion.identity;
            var q = Quaternion.identity;
            var visited = new HashSet<HumanBodyBones>();
            while (bone != parent && bone != HumanBodyBones.LastBone)
            {
                if (!visited.Add(bone) || !_bones.TryGetValue(bone, out var entry)) throw new ArgumentException("Broken idle bone hierarchy.");
                q = entry.rotation * q; bone = entry.parent;
            }
            return q;
        }
        public void Apply(Vrm10RuntimeControlRig rig)
        {
            ITPoseProvider tpose = rig;
            INormalizedPoseApplicable pose = rig;
            foreach (var (bone, parent) in tpose.EnumerateBoneParentPairs()) pose.SetNormalizedLocalRotation(bone, RotationBetween(bone, parent));
            var hips = tpose.GetWorldTransform(HumanBodyBones.Hips).Value.Translation;
            pose.SetRawHipsPosition(hips + _hipsOffset * hips.y);
        }
    }
}
