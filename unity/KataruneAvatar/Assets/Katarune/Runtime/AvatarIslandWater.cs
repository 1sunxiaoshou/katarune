using UnityEngine;

namespace Katarune.Avatar
{
    // Shared wave parameters drive the baked water mesh shader and buoyancy samples.
    // A small sum of directional gravity waves, following GPU Gems chapter 1.
    internal static class AvatarIslandWater
    {
        internal const float SeaLevel = -.27f;
        private static readonly Vector4[] Waves =
        {
            Wave(new Vector2(.8f,.6f),4.2f,.045f),
            Wave(new Vector2(-.35f,.94f),2.3f,.018f),
            Wave(new Vector2(.96f,.28f),8.5f,.030f),
        };
        private static Vector4 Wave(Vector2 direction,float length,float amplitude)
        {
            direction.Normalize();
            return new Vector4(direction.x,direction.y,amplitude,2*Mathf.PI/length);
        }
        internal static float Shore(float x) => -3.4f+.65f*Mathf.Sin(x*.39f)+.35f*Mathf.Cos(x*.73f)
            -3*Mathf.Exp(-Mathf.Pow((Mathf.Abs(x)-3.6f)/1.8f,2));
        internal static float Height(float x,float z,float time)
        {
            var amplitude=Mathf.SmoothStep(0,1,Mathf.InverseLerp(0,2,Shore(x)-z));
            amplitude*=1-Mathf.SmoothStep(0,1,Mathf.InverseLerp(18,24,Mathf.Abs(x)));
            amplitude*=1-Mathf.SmoothStep(0,1,Mathf.InverseLerp(24,32,-z));
            var height=0f;
            foreach(var wave in Waves)
                height+=wave.z*Mathf.Sin(wave.w*(wave.x*x+wave.y*z)-Mathf.Sqrt(9.81f*wave.w)*time);
            return SeaLevel+height*amplitude;
        }
        internal static void Apply(Material material)
        {
            for(var i=0;i<Waves.Length;i++) material.SetVector("_Wave"+i,Waves[i]);
        }
    }
}
