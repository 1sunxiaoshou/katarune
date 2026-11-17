Shader "Katarune/IslandBackdrop"
{
    Properties
    {
        _Opacity ("Opacity",Range(0,1)) = 0
        _MotionTime ("Motion time",Float) = 0
        _Mode ("Surface",Float) = 0
        _SurfacePaint ("Baked surface pigment",2D) = "gray" {}
        _LeafCluster ("Leaf cluster cutout",2D) = "white" {}
        _WaterNormal ("Baked wave normals",2D) = "bump" {}
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" "RenderPipeline"="UniversalPipeline" }
        HLSLINCLUDE
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl"
        #include "Packages/com.unity.render-pipelines.core/ShaderLibrary/Color.hlsl"
        CBUFFER_START(UnityPerMaterial)
            float _Opacity;
            float _MotionTime;
            float _Mode;
            float4 _Wave0, _Wave1, _Wave2;
            float4 _ContactRipples[8];
        CBUFFER_END
        TEXTURE2D(_SurfacePaint);
        SAMPLER(sampler_SurfacePaint);
        TEXTURE2D(_LeafCluster);
        SAMPLER(sampler_LeafCluster);
        TEXTURE2D(_WaterNormal);
        SAMPLER(sampler_WaterNormal);
        #include "IslandWaterSampling.hlsl"
        struct Attributes { float4 positionOS:POSITION; float3 normalOS:NORMAL; float4 color:COLOR; float4 uv:TEXCOORD0; };
        struct Varyings
        {
            float4 positionCS:SV_POSITION;
            float3 positionOS:TEXCOORD0;
            float3 positionWS:TEXCOORD1;
            float3 normalWS:TEXCOORD2;
            float4 detail:TEXCOORD3;
            half4 color:COLOR;
        };
        float Shore(float x) { float c=(abs(x)-3.6)/1.8; return -3.4+.65*sin(x*.39)+.35*cos(x*.73)-3*exp(-c*c); }
        float WaterHeight(float2 p)
        {
            float4 waves[3]={_Wave0,_Wave1,_Wave2};
            float value=0;
            [unroll] for(int i=0;i<3;i++)
                value+=waves[i].z*sin(waves[i].w*dot(waves[i].xy,p)-sqrt(9.81*waves[i].w)*_MotionTime);
            float mask=smoothstep(0,2,Shore(p.x)-p.y)*(1-smoothstep(18,24,abs(p.x)))*(1-smoothstep(24,32,-p.y));
            return value*mask;
        }
        float3 Wind(float3 p,float weight,float surface)
        {
            if(_Mode>1.5 && _Mode<2.5)
            {
                if(surface>7.5) weight=max(weight,.35);
                // Main sway + higher-frequency leaf flutter, spatially dephased.
                // GPU Gems 3, chapters 6 and 16; no per-frame CPU mesh updates.
                float phase=p.x*.7+p.z*.6;
                float gust=sin(_MotionTime*.8+phase)*.7+sin(_MotionTime*1.37+phase*.8)*.3;
                p.x+=(gust*.045+sin(_MotionTime*3.1+phase*2.7)*.008*weight)*weight;
                p.z+=sin(_MotionTime*.65+phase)*.025*weight;
            }
            return p;
        }
        Varyings Vert(Attributes input)
        {
            Varyings output;
            float3 p=Wind(input.positionOS.xyz,input.uv.x,input.uv.y);
            float3 localNormal=input.normalOS;
            if(_Mode>.5 && _Mode<1.5)
            {
                p.y+=WaterHeight(p.xz);
                const float e=.025;
                localNormal=normalize(float3(WaterHeight(p.xz-float2(e,0))-WaterHeight(p.xz+float2(e,0)),
                    2*e,WaterHeight(p.xz-float2(0,e))-WaterHeight(p.xz+float2(0,e))));
            }
            output.positionCS=TransformObjectToHClip(p);
            output.positionOS=p;
            output.positionWS=TransformObjectToWorld(p);
            output.normalWS=TransformObjectToWorldNormal(localNormal);
            output.detail=input.uv;
            output.color=input.color;
            return output;
        }
        void Fade(float2 screen)
        {
            float threshold=frac(52.9829189*frac(dot(floor(screen),float2(.06711056,.00583715))));
            clip(_Opacity-threshold-.00001);
        }
        void Cutout(float4 detail)
        {
            if(_Mode>1.5 && _Mode<2.5 && detail.y>8.5)
                clip(SAMPLE_TEXTURE2D(_LeafCluster,sampler_LeafCluster,detail.zw).r-.45);
        }
        float Hash(float2 p) { return frac(sin(dot(p,float2(127.1,311.7)))*43758.5453); }
        float Noise(float2 p)
        {
            float2 i=floor(p), f=frac(p); f=f*f*(3-2*f);
            return lerp(lerp(Hash(i),Hash(i+float2(1,0)),f.x),lerp(Hash(i+float2(0,1)),Hash(i+1),f.x),f.y);
        }
        float CellEdge(float2 p)
        {
            float2 cell=floor(p), f=frac(p); float first=9,second=9;
            [unroll] for(int y=-1;y<=1;y++) [unroll] for(int x=-1;x<=1;x++)
            {
                float2 o=float2(x,y); float2 jitter=float2(Hash(cell+o),Hash(cell+o+17));
                float2 r=o+jitter-f; float d=dot(r,r);
                if(d<first) { second=first; first=d; } else second=min(second,d);
            }
            return second-first;
        }
        half3 Palette(float3 srgb) { return SRGBToLinear(srgb); }
        half3 SurfacePaint(float3 p,float3 n,float scale)
        {
            float3 w=pow(abs(n),4); w/=max(.001,w.x+w.y+w.z);
            return SAMPLE_TEXTURE2D(_SurfacePaint,sampler_SurfacePaint,p.zy*scale).rgb*w.x
                +SAMPLE_TEXTURE2D(_SurfacePaint,sampler_SurfacePaint,p.xz*scale).rgb*w.y
                +SAMPLE_TEXTURE2D(_SurfacePaint,sampler_SurfacePaint,p.xy*scale).rgb*w.z;
        }
        ENDHLSL
        Pass
        {
            Name "Island cel surfaces"
            Tags { "LightMode"="UniversalForwardOnly" }
            Cull Off ZWrite On
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile_fragment _ _SHADOWS_SOFT _SHADOWS_SOFT_LOW _SHADOWS_SOFT_MEDIUM _SHADOWS_SOFT_HIGH
            #pragma multi_compile_fragment _ _SCREEN_SPACE_OCCLUSION
            half4 Frag(Varyings input):SV_Target
            {
                Fade(input.positionCS.xy);
                Cutout(input.detail);
                float3 p=input.positionOS;
                float3 normal=normalize(input.normalWS);
                float3 view=SafeNormalize(_WorldSpaceCameraPos-input.positionWS);
                float surface=input.detail.y;
                Light sun=GetMainLight(TransformWorldToShadowCoord(input.positionWS));
                float3 lightDirection=length(sun.direction)>.1 ? sun.direction : normalize(float3(-.45,.8,.35));
                half3 base=input.color.rgb;
                float n=Noise(p.xz*2.3+p.y*.7);
                half3 color;
                if(_Mode>.5 && _Mode<1.5)
                {
                    half3 flowing=IslandFourWayNormal(p.xz*.18,_MotionTime);
                    normal=normalize(normal+float3(flowing.r,0,flowing.g)*.22);
                    float coast=Shore(p.x)-p.z;
                    // Toon-water depth/foam principle: roystan.net/articles/toon-water/.
                    // Reimplemented with URP 17 depth reconstruction, no legacy CG APIs.
                    float rawDepth=SampleSceneDepth(input.positionCS.xy/_ScaledScreenParams.xy);
                    #if !UNITY_REVERSED_Z
                        rawDepth=lerp(UNITY_NEAR_CLIP_VALUE,1,rawDepth);
                    #endif
                    float3 behind=ComputeWorldSpacePosition(input.positionCS.xy/_ScaledScreenParams.xy,rawDepth,UNITY_MATRIX_I_VP);
                    float waterDepth=max(0,p.y-TransformWorldToObject(behind).y);
                    // A sky sample has no seabed; treat it as deep open water.
                    #if UNITY_REVERSED_Z
                        if(rawDepth<.00001) waterDepth=100;
                    #else
                        if(rawDepth>.99999) waterDepth=100;
                    #endif
                    // The known procedural seabed keeps shallow-water color stable
                    // where depth has no geometry (outside the finite coast mesh).
                    float seabed=lerp(-.65,-.025,smoothstep(-1.2,1.7,-coast))-pow(max(0,coast-1.2),1.3)*.55;
                    float seabedDepth=max(0,p.y-seabed);
                    float depth=smoothstep(.05,6,seabedDepth);
                    float2 warped=p.xz+float2(sin(p.z*.75+_MotionTime*.26),sin(p.x*.7-_MotionTime*.22))*.18;
                    float patches=Noise(warped*.65);
                    float bands=smoothstep(.36,.44,patches)*.6+smoothstep(.65,.7,patches)*.4;
                    color=lerp(Palette(float3(.26,.79,.71)),Palette(float3(.055,.39,.59)),depth);
                    color*=.96+patches*.12;
                    float cells=CellEdge(warped*1.35);
                    float caustic=(1-smoothstep(.018,.065,cells))*(1-smoothstep(.15,1.3,seabedDepth));
                    color=lerp(color,Palette(float3(.65,.94,.78)),caustic*.10);
                    float curve=coast+.16*sin(p.x*2.1+_MotionTime*.5)+.09*sin(p.x*5.7);
                    float wave=frac(curve*.55-_MotionTime*.10);
                    float shoreFoam=(1-smoothstep(.025,.10,abs(wave-.52)))*(1-smoothstep(.4,3.3,coast));
                    shoreFoam*=smoothstep(.18,.40,Noise(warped*2.1));
                    float contactFoam=(1-smoothstep(.006,.025,waterDepth))*smoothstep(.44,.65,Noise(warped*5+_MotionTime*.2));
                    shoreFoam=max(shoreFoam,contactFoam);
                    float tip=sin(warped.y*3.2+sin(warped.x*1.2)*1.5+_MotionTime*.5);
                    float breakup=smoothstep(.58,.75,Noise(warped*1.8));
                    float ripples=smoothstep(.975,.998,tip)*breakup*.16;
                    [unroll] for(int r=0;r<8;r++)
                    {
                        float4 contact=_ContactRipples[r];
                        float age=_MotionTime-contact.z;
                        float radius=length(p.xz-contact.xy);
                        float ring=exp(-pow((radius-age*.7)/.045,2));
                        ripples+=ring*contact.w*saturate(1-age/1.8)*step(0,age)*.5;
                    }
                    float fresnel=pow(1-saturate(dot(normal,view)),4);
                    float3 reflected=reflect(-view,normal);
                    half3 skyReflection=lerp(Palette(float3(.66,.83,.87)),Palette(float3(.23,.51,.78)),saturate(reflected.y*2));
                    color=lerp(color,skyReflection,fresnel*.60);
                    float glint=pow(saturate(dot(normal,normalize(lightDirection+view))),320);
                    color+=Palette(float3(.91,.91,.71))*glint*.4;
                    color*=lerp(half3(.66,.76,.93),half3(1,1,1),sun.shadowAttenuation);
                    color=lerp(color,Palette(float3(.91,.99,.91)),saturate(shoreFoam*.90+ripples));
                }
                else if(_Mode>2.5)
                {
                    // Broad painted shade gradients keep the cloud volume soft.
                    float lit=dot(normal,lightDirection)+.10;
                    half3 shade=Palette(float3(.66,.72,.86));
                    half3 mid=Palette(float3(.86,.88,.94));
                    color=lerp(shade,mid,smoothstep(-.55,.2,lit));
                    color=lerp(color,base,smoothstep(.08,.65,lit));
                }
                else
                {
                    if(_Mode<.5)
                    {
                        if(surface<.5)
                        {
                            half3 paint=SurfacePaint(p,normal,.32);
                            base*=.84+paint.r*.30;
                            float ripple=sin(p.z*22+p.x*3+paint.g*7)*.5+.5;
                            base*=1-ripple*.035;
                            float wet=1-smoothstep(.3,1.5,p.z-Shore(p.x));
                            base=lerp(base,Palette(float3(.69,.75,.62)),wet*.45);
                            base*=.94+paint.b*.12;
                        }
                        else if(surface<1.5)
                        {
                            half3 paint=SurfacePaint(p,normal,.16);
                            half3 fine=SurfacePaint(p,normal,.8);
                            base*=.67+paint.r*.62+fine.b*.12;
                            float stratum=p.y*.62+p.x*.10+p.z*.07+paint.g*.08;
                            float seam=1-smoothstep(.012,.05,abs(frac(stratum)-.5));
                            float face=1-smoothstep(.48,.79,normal.y);
                            base*=1-seam*face*smoothstep(.42,.65,paint.r)*.12;
                            float wash=smoothstep(.57,.72,paint.g)*face;
                            base=lerp(base,base*Palette(float3(.73,.80,.87)),wash*.35);
                        }
                        else if(surface<2.5)
                        {
                            float grain=sin(p.x*7+Noise(p.xz*4)*3+p.z*100);
                            base*=1-smoothstep(.8,.98,grain)*.17;
                        }
                        else if(surface>6.5)
                        {
                            float streak=sin(p.x*37+Noise(float2(p.x*4,p.y*.8+_MotionTime*.8))*3);
                            base=lerp(Palette(float3(.60,.90,.94)),Palette(float3(.94,1,.98)),.55+.45*smoothstep(.2,.8,streak));
                            base*=.94+.06*sin(p.y*9+_MotionTime*3);
                        }
                    }
                    else if(surface<.5)
                    {
                        float vein=(1-smoothstep(.01,.05,input.detail.w))*.13;
                        float diagonal=sin(input.detail.z*84+input.detail.w*7);
                        base=lerp(base,Palette(float3(.83,.91,.54)),vein);
                        base*=1-smoothstep(.97,1,diagonal)*.06;
                    }
                    float lambert=dot(normal,lightDirection);
                    if(_Mode>1.5) lambert=abs(lambert)*.65+.15;
                    float shade=smoothstep(-.16,.18,lambert)*.45+smoothstep(.28,.67,lambert)*.55;
                    shade*=lerp(.22,1,sun.shadowAttenuation);
                    half3 cool=Palette(float3(.60,.72,.83));
                    half3 warm=half3(1.06,1.015,.92);
                    color=base*lerp(cool,warm,shade);
                    float edge=1-smoothstep(.08,.20,abs(dot(normal,view)));
                    // Fine colored contour, never a thick black wireframe.
                    color*=1-edge*.12;
                    #if defined(_SCREEN_SPACE_OCCLUSION)
                        AmbientOcclusionFactor ao=GetScreenSpaceAmbientOcclusion(input.positionCS.xy/_ScaledScreenParams.xy);
                        color*=lerp(.8,1,ao.indirectAmbientOcclusion);
                    #endif
                    if(surface>5.5 && surface<6.5) color=lerp(color,base*1.2,.65);
                    if(_Mode<.5 && surface>6.5) color=lerp(color,base,.75);
                    if(_Mode>1.5 && surface>7.5)
                    {
                        float transmission=pow(saturate(dot(view,-lightDirection)),3)*.17;
                        color+=base*Palette(float3(.82,.93,.48))*transmission;
                    }
                }
                // Air perspective is evaluated in world-relative island distance.
                float haze=(1-exp(-max(0,length(p.xz)-12)*.010))*.65;
                color=lerp(color,Palette(float3(.61,.78,.85)),haze);
                return half4(color,1);
            }
            ENDHLSL
        }
        Pass
        {
            Name "Island shadows"
            Tags { "LightMode"="ShadowCaster" }
            ZWrite On ZTest LEqual ColorMask 0 Cull Off
            HLSLPROGRAM
            #pragma vertex ShadowVert
            #pragma fragment ShadowFrag
            float3 _LightDirection;
            Varyings ShadowVert(Attributes input)
            {
                Varyings output=Vert(input);
                float3 p=Wind(input.positionOS.xyz,input.uv.x,input.uv.y);
                float3 world=TransformObjectToWorld(p);
                float3 normal=TransformObjectToWorldNormal(input.normalOS);
                output.positionCS=ApplyShadowClamping(TransformWorldToHClip(ApplyShadowBias(world,normal,_LightDirection)));
                return output;
            }
            half4 ShadowFrag(Varyings input):SV_Target { Fade(input.positionCS.xy); Cutout(input.detail); return 0; }
            ENDHLSL
        }
        Pass
        {
            Name "Island depth normals"
            Tags { "LightMode"="DepthNormalsOnly" }
            ZWrite On Cull Off
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment DepthNormals
            half4 DepthNormals(Varyings input):SV_Target { if(_Mode>.5 && _Mode<1.5) discard; Fade(input.positionCS.xy); Cutout(input.detail); return half4(normalize(input.normalWS),0); }
            ENDHLSL
        }
        Pass
        {
            Name "Island depth"
            Tags { "LightMode"="DepthOnly" }
            ZWrite On ColorMask R Cull Off
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Depth
            half Depth(Varyings input):SV_Target { if(_Mode>.5 && _Mode<1.5) discard; Fade(input.positionCS.xy); Cutout(input.detail); return input.positionCS.z; }
            ENDHLSL
        }
    }
}
