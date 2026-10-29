Shader "Katarune/LiveComposite" {
    Properties { _MainTex ("Subtitle", 2D) = "black" {} }
    SubShader { Tags { "RenderType"="Transparent" } Pass {
        Cull Off ZWrite Off ZTest Always Blend SrcAlpha OneMinusSrcAlpha
        CGPROGRAM
        #pragma vertex vert_img
        #pragma fragment frag
        #include "UnityCG.cginc"
        sampler2D _MainTex;
        float _AcceptancePulse;
        fixed4 frag(v2f_img input) : SV_Target {
            if(_AcceptancePulse>.5 && input.uv.x>.96 && input.uv.y>.94) return fixed4(1,1,1,1);
            return tex2D(_MainTex,input.uv);
        }
        ENDCG
    } }
}
