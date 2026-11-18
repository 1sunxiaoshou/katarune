Shader "Katarune/LiveComposite" {
    Properties {
        _MainTex ("Subtitle", 2D) = "black" {}
        _DanmakuTex ("Danmaku", 2D) = "black" {}
    }
    SubShader { Tags { "RenderType"="Transparent" } Pass {
        Cull Off ZWrite Off ZTest Always Blend SrcAlpha OneMinusSrcAlpha
        CGPROGRAM
        #pragma vertex vert_img
        #pragma fragment frag
        #include "UnityCG.cginc"
        sampler2D _MainTex, _DanmakuTex;
        float _AcceptancePulse, _ShowSubtitles, _ShowDanmaku;
        float4 _DanmakuRect;
        fixed4 frag(v2f_img input) : SV_Target {
            if(_AcceptancePulse>.5 && input.uv.x>.96 && input.uv.y>.94) return fixed4(1,1,1,1);
            fixed4 subtitle = _ShowSubtitles > .5 ? tex2D(_MainTex, input.uv) : 0;
            if (_ShowDanmaku < .5) return subtitle;
            float2 panel = (input.uv - _DanmakuRect.xy) / _DanmakuRect.zw;
            if (any(panel < 0) || any(panel > 1)) return subtitle;
            fixed4 chat = tex2D(_DanmakuTex, panel);
            fixed alpha = subtitle.a + chat.a * (1 - subtitle.a);
            fixed3 color = (subtitle.rgb * subtitle.a + chat.rgb * chat.a * (1 - subtitle.a)) / max(alpha, .001);
            return fixed4(color, alpha);
        }
        ENDCG
    } }
}
