Shader "Katarune/ImmersiveBackdrop"
{
    Properties
    {
        _Typography ("Typography", 2D) = "black" {}
        _Film ("Film", 2D) = "black" {}
        _Frames ("Frames", 2D) = "black" {}
        _Opacity ("Opacity", Range(0,1)) = 0
        _MotionTime ("Motion time", Float) = 0
    }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Background" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            ZWrite Off ZTest Always Cull Off
            Blend SrcAlpha OneMinusSrcAlpha, One OneMinusSrcAlpha
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.core/ShaderLibrary/Color.hlsl"
            TEXTURE2D(_Typography); SAMPLER(sampler_Typography);
            TEXTURE2D(_Film); SAMPLER(sampler_Film);
            TEXTURE2D(_Frames); SAMPLER(sampler_Frames);
            CBUFFER_START(UnityPerMaterial)
                float _Opacity;
                float _MotionTime;
            CBUFFER_END
            struct Attributes { float4 positionOS : POSITION; float2 uv : TEXCOORD0; };
            struct Varyings { float4 positionCS : SV_POSITION; float2 uv : TEXCOORD0; };
            Varyings Vert(Attributes input)
            {
                Varyings output;
                output.positionCS = float4(input.positionOS.xy * 2, 0, 1);
                output.positionCS.y *= _ProjectionParams.x;
                output.uv = input.uv;
                return output;
            }
            half4 Frag(Varyings input) : SV_Target
            {
                // HTML canvas uses top-left coordinates and centered aspect fill.
                float scale = max(_ScreenParams.x / 1920, _ScreenParams.y / 1080);
                float2 p = (float2(input.uv.x, 1-input.uv.y) - .5) * _ScreenParams.xy / scale;
                p += float2(960, 540);
                const float cosine = .9538469526, sine = .3002931752;
                half aperture = 0;
                float drift = fmod(_MotionTime * 26, 3200);
                // Each text column translates in screen X BEFORE rotation.
                // A single rotated repeating UV would incorrectly drift in Y.
                [unroll] for (int column=-1; column<2; column++)
                {
                    float2 delta = p - float2(615 + column * 3200 - drift, -260);
                    float2 local = float2(cosine*delta.x-sine*delta.y, sine*delta.x+cosine*delta.y);
                    half mask = SAMPLE_TEXTURE2D_LOD(_Typography, sampler_Typography,
                        float2(local.x/3200,1-frac(local.y/1050)),0).a;
                    mask *= step(0,local.x) * (1-step(3200,local.x));
                    aperture = 1-(1-aperture)*(1-mask);
                }
                // Fixed #292929 plane, #171717 full-screen strokes, 8px pitch
                // and 2.4px width. Only the letter-shaped openings reveal it.
                float stripeDistance = abs(frac((p.x-p.y)/8+.5)-.5) * 5.656854;
                float antialias = .5 / scale;
                half stripe = 1-smoothstep(1.2-antialias,1.2+antialias,stripeDistance);
                half gray = lerp(41.0/255,23.0/255,stripe);
                half3 color = SRGBToLinear(gray.xxx) * aperture;
                float2 q = float2(cosine*p.x-sine*p.y, sine*p.x+cosine*p.y);
                // Four original 202px bands: frame, color, frame, color.
                if (q.x >= -202 && q.x < 606)
                {
                    bool colored = (q.x >= 0 && q.x < 202) || q.x >= 404;
                    float left = q.x < 0 ? -202 : q.x < 202 ? 0 : q.x < 404 ? 202 : 404;
                    float phase = q.x >= 404 ? 245 : 0;
                    float movement = colored ? -22 : 22;
                    float2 uv = float2((q.x-left)/202,1-frac((q.y-_MotionTime*movement-phase)/1080));
                    color = colored ? SAMPLE_TEXTURE2D_LOD(_Film,sampler_Film,uv,0).rgb
                        : SAMPLE_TEXTURE2D_LOD(_Frames,sampler_Frames,uv,0).rgb;
                }
                return half4(color, _Opacity);
            }
            ENDHLSL
        }
    }
}
