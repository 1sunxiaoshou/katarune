// Adapted from Daniel Shervheim's MotionFourWayChaos (2019), BSD-3-Clause.
// Full license distributed in StreamingAssets/IslandArt-LICENSE.txt.
#ifndef KATARUNE_ISLAND_WATER_SAMPLING
#define KATARUNE_ISLAND_WATER_SAMPLING
half3 IslandFourWayNormal(float2 uv, float time)
{
    float2 motion = time * .018 * normalize(float2(1,1));
    half3 a = SAMPLE_TEXTURE2D(_WaterNormal, sampler_WaterNormal, uv + motion).rgb*2-1;
    half3 b = SAMPLE_TEXTURE2D(_WaterNormal, sampler_WaterNormal, uv + float2(.418,.355) - motion).rgb*2-1;
    half3 c = SAMPLE_TEXTURE2D(_WaterNormal, sampler_WaterNormal, uv + float2(.865,.148) + motion * float2(-1,1)).rgb*2-1;
    half3 d = SAMPLE_TEXTURE2D(_WaterNormal, sampler_WaterNormal, uv + float2(.651,.752) + motion * float2(1,-1)).rgb*2-1;
    return normalize(a+b+c+d);
}
#endif
