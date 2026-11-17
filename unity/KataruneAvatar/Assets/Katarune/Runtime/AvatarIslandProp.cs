using UnityEngine;

namespace Katarune.Avatar
{
    [RequireComponent(typeof(Rigidbody))]
    public sealed class AvatarIslandProp : MonoBehaviour
    {
        private Rigidbody _body;
        private Transform _island;
        private Vector3 _rest;
        private Quaternion _rotation;
        private float _mass;

        private void Awake()
        {
            _body = GetComponent<Rigidbody>();
            _island = transform.parent;
            _rest = transform.localPosition;
            _rotation = transform.localRotation;
            _mass = _body.mass;
        }
        private void OnEnable() => ResetPose();
        private void ResetPose()
        {
            _body.mass = _mass * Mathf.Pow(_island.lossyScale.x, 3);
            _body.position = _island.TransformPoint(_rest);
            _body.rotation = _island.rotation * _rotation;
            _body.linearVelocity = Vector3.zero;
            _body.angularVelocity = Vector3.zero;
        }
        private void FixedUpdate()
        {
            // Decorative props reset only after leaving the finite authored stage.
            var p = _island.InverseTransformPoint(_body.position);
            if (p.y < -2 || Mathf.Abs(p.x) > 20 || p.z > 17 || p.z < -15) ResetPose();
        }
    }
}
