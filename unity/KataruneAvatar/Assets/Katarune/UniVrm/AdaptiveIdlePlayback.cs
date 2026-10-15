using System;
using System.Collections.Generic;
using UnityEngine;

namespace Katarune.Avatar
{
    // Run after UniVRM ControlRig, constraints and FastSpringBone service (11010).
    // The driver pauses spring writeback only while this baked loop owns the joints.
    [DefaultExecutionOrder(11011)]
    public sealed class AdaptiveIdlePlayback : MonoBehaviour
    {
        private AdaptiveIdleBaker.BakedLoop _clip;
        private readonly List<Transform> _bones = new();
        private Quaternion[] _from;
        private float _time, _blend;
        public bool IsBakedActive { get; private set; }
        public void Configure(AdaptiveIdleBaker.BakedLoop clip)
        {
            _clip = clip ?? throw new ArgumentNullException(nameof(clip));
            foreach (var channel in clip.channels)
            {
                var bone = transform.Find(channel.path);
                if (bone == null) throw new InvalidOperationException("Generated idle joint no longer exists.");
                _bones.Add(bone);
            }
            _from = new Quaternion[_bones.Count];
        }
        public void Tick(float delta, bool active)
        {
            active &= _bones.Count > 0;
            if (active && !IsBakedActive)
            {
                for (var i = 0; i < _bones.Count; i++) _from[i] = _bones[i].localRotation;
                _blend = 0;
            }
            IsBakedActive = active;
            if (active) { _time = (_time + Mathf.Max(0,delta)) % _clip.period; _blend = Mathf.Min(.2f,_blend + delta); }
        }
        private void LateUpdate()
        {
            if (!IsBakedActive) return;
            var frame = _time * (AdaptiveIdleBaker.Frames - 1) / _clip.period;
            var first = Mathf.FloorToInt(frame); var second = Mathf.Min(first + 1, AdaptiveIdleBaker.Frames - 1);
            for (var i = 0; i < _bones.Count; i++)
            {
                var values = _clip.channels[i].rotations;
                var q = Quaternion.Slerp(AdaptiveIdleBaker.Read(values,first),AdaptiveIdleBaker.Read(values,second),frame-first);
                _bones[i].localRotation = Quaternion.Slerp(_from[i],q,_blend/.2f);
            }
        }
    }
}
