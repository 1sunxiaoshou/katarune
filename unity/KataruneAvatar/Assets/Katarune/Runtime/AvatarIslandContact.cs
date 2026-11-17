using System.Collections.Generic;
using UnityEngine;

namespace Katarune.Avatar
{
    // Read-only bone followers: animation owns the character; PhysX owns props.
    // The proxies belong to the island and disappear with the background.
    internal sealed class AvatarIslandContact : MonoBehaviour
    {
        private readonly List<(Transform bone, Rigidbody body, SphereCollider shape)> _followers = new();
        private Transform _avatar;
        private readonly Vector4[] _ripples = new Vector4[8];
        private int _nextRipple;
        private float _time;
        private Material _water;

        internal void Initialize(Material water) => _water = water;

        internal void Bind(Transform avatar)
        {
            if (ReferenceEquals(_avatar, avatar)) return;
            ClearFollowers();
            _avatar = avatar;
            if (avatar == null) return;
            foreach (var animator in avatar.GetComponentsInChildren<Animator>(true))
            {
                if (animator.avatar == null || !animator.isHuman) continue;
                foreach (var bone in new[] { HumanBodyBones.LeftHand, HumanBodyBones.RightHand,
                    HumanBodyBones.LeftFoot, HumanBodyBones.RightFoot })
                {
                    var target = animator.GetBoneTransform(bone);
                    if (target != null) AddFollower(target, bone.ToString());
                }
                break;
            }
        }

        internal void AddFollower(Transform bone, string name)
        {
            var child = new GameObject("Island contact " + name);
            child.transform.SetParent(transform, false);
            child.transform.position = bone.position;
            var shape = child.AddComponent<SphereCollider>();
            shape.radius = .07f;
            var body = child.AddComponent<Rigidbody>();
            body.isKinematic = true;
            body.useGravity = false;
            body.interpolation = RigidbodyInterpolation.Interpolate;
            body.collisionDetectionMode = CollisionDetectionMode.ContinuousSpeculative;
            // Never couple our environmental proxies back into the avatar rig.
            if (_avatar != null)
                foreach (var other in _avatar.GetComponentsInChildren<Collider>(true))
                    Physics.IgnoreCollision(shape, other);
            foreach (var follower in _followers) Physics.IgnoreCollision(shape, follower.shape);
            _followers.Add((bone, body, shape));
        }

        internal void SetTime(float time)
        {
            _time = time;
            if (_water != null) _water.SetVectorArray("_ContactRipples", _ripples);
        }

        private void OnEnable()
        {
            System.Array.Clear(_ripples, 0, _ripples.Length);
            foreach (var follower in _followers)
                if (follower.bone != null) follower.body.position = follower.bone.position;
        }

        private void FixedUpdate()
        {
            foreach (var follower in _followers)
            {
                if (follower.bone == null || !follower.bone.gameObject.activeInHierarchy)
                {
                    follower.shape.enabled = false;
                    continue;
                }
                follower.shape.enabled = true;
                var target = follower.bone.position;
                var distance = Vector3.Distance(follower.body.position, target);
                var scale = transform.lossyScale.x;
                // Teleport/reframe is not an impact. Ordinary animated movements
                // are swept by the kinematic solver and can push the props.
                if (distance > .45f * scale) follower.body.position = target;
                else follower.body.MovePosition(target);
                var local = transform.InverseTransformPoint(target);
                if (distance > .003f * scale && distance < .45f * scale &&
                    local.z < AvatarIslandWater.Shore(local.x) &&
                    Mathf.Abs(local.y - AvatarIslandWater.Height(local.x, local.z, _time)) < .09f)
                    AddRipple(local, Mathf.Clamp01(distance / (.03f * scale)));
            }
        }

        internal void AddRipple(Vector3 point, float strength)
        {
            // Bound emission to 20 Hz across all contacts.
            var previous = _ripples[(_nextRipple + _ripples.Length - 1) % _ripples.Length];
            if (previous.w > 0 && _time - previous.z < .05f) return;
            _ripples[_nextRipple] = new Vector4(point.x, point.z, _time, strength);
            _nextRipple = (_nextRipple + 1) % _ripples.Length;
        }

        private void ClearFollowers()
        {
            foreach (var follower in _followers)
            {
                follower.shape.enabled = false;
                if (Application.isPlaying) Destroy(follower.body.gameObject);
                else DestroyImmediate(follower.body.gameObject);
            }
            _followers.Clear();
        }
    }
}
