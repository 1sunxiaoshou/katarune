using UnityEngine;

namespace Katarune.Avatar
{
    [RequireComponent(typeof(Rigidbody))]
    public sealed class AvatarIslandBuoyancy : MonoBehaviour
    {
        private static readonly Vector3[] Supports =
        {
            new(-.35f,0,-.085f),new(.35f,0,-.085f),
            new(-.35f,0,.085f),new(.35f,0,.085f),
        };
        private Rigidbody _body;
        private Transform _island;
        private Vector3 _restPosition;
        private Quaternion _restRotation;
        private float _mass, _time;

        private void Awake()
        {
            _body=GetComponent<Rigidbody>();
            _island=transform.parent;
            _restPosition=transform.localPosition;
            _restRotation=transform.localRotation;
            _mass=_body.mass;
            // A slightly heavier underside gives the asymmetric log a stable trim.
            _body.centerOfMass=new Vector3(0,-.035f,0);
        }
        private void OnEnable()
        {
            _body.position=_island.TransformPoint(_restPosition);
            _body.rotation=_island.rotation*_restRotation;
            _body.linearVelocity=Vector3.zero;
            _body.angularVelocity=Vector3.zero;
        }
        internal void SetTime(float time) => _time=time;
        private void FixedUpdate()
        {
            var scale=_island.lossyScale.x;
            _body.mass=_mass*scale*scale*scale;
            var area=.9f*.25f*.25f*scale*scale;
            foreach(var localSupport in Supports)
            {
                var point=transform.TransformPoint(localSupport);
                var local=_island.InverseTransformPoint(point);
                var surface=_island.TransformPoint(new Vector3(local.x,AvatarIslandWater.Height(local.x,local.z,_time),local.z));
                var depth=Mathf.Clamp(surface.y-point.y+.08f*scale,0,.16f*scale);
                if(depth<=0) continue;
                // Archimedes force on four patches also produces roll and pitch.
                var velocity=_body.GetPointVelocity(point);
                var buoyancy=Vector3.up*(1000f*Physics.gravity.magnitude*area*depth);
                var drag=new Vector3(velocity.x*1.2f*scale*scale,
                    velocity.y*32f*Mathf.Pow(scale,2.5f),velocity.z*1.2f*scale*scale);
                _body.AddForceAtPosition(buoyancy-drag,point,ForceMode.Force);
            }
            // A weak changing current; zero mean keeps background drift bounded.
            _body.AddForce(new Vector3(Mathf.Sin(_time*.23f)*.015f,0,Mathf.Cos(_time*.19f)*.008f)*_body.mass,ForceMode.Force);
        }
    }
}
