using System;
using System.Buffers;
using System.Collections.Concurrent;
using System.IO;
using System.IO.Pipes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.UIElements;

namespace Katarune.Avatar
{
    // After motion (9000), behavior (10000), VRM and idle (11011) have applied poses.
    [DefaultExecutionOrder(32000)]
    internal sealed class AvatarLiveOutput : MonoBehaviour
    {
        [Serializable] internal sealed class Settings {
            public string pipe, camera="center", background="immersive", backgroundColor="#202020";
            public int width=1920, fps=60; public bool subtitles=true;
            public float voiceVolume=1, musicVolume=1;
        }
        private sealed class Frame { internal byte[] Bytes; internal long Index; }
        private Settings _settings;
        private AvatarControlConnection _connection;
        private AvatarSpeechPlayer _speech;
        private AvatarDancePlayer _dance;
        private AvatarSceneRig _rig;
        private AvatarWindow _window;
        private Camera _camera;
        private RenderTexture _scene, _subtitles, _composite, _previousTarget;
        private Material _blend;
        private PanelSettings _panel;
        private GameObject _ui;
        private Label _label;
        private Font _font;
        private AvatarLiveAudioTap _audio;
        private NamedPipeServerStream _videoPipe, _audioPipe;
        private BlockingCollection<Frame> _frames;
        private CancellationTokenSource _lifetime;
        private volatile bool _active;
        private bool _previousHdr, _previousEnabled;
        private int _readbacks;
        private long _captured, _dropped, _repeated, _written, _updates;
        private double _readbackMilliseconds;
        private RenderPipeline.StandardRequest _renderRequest;
        private long _submitted=-1;
        private int _frameBytes, _generation, _previousFrameRate;
        private float _previousAspect, _speechVolume, _musicVolume;
        private CameraClearFlags _previousClear;
        private Color _previousColor;
        private AvatarSceneRig.AvatarFramingState _framing;
        private string _failure;
        private readonly bool _acceptance=Environment.GetEnvironmentVariable("KATARUNE_LIVE_ACCEPTANCE")=="1";
        private float _nextDiagnostic;
        internal bool Active => _active;
        internal void Configure(AvatarControlConnection connection, AvatarSpeechPlayer speech, AvatarDancePlayer dance)
        { _connection=connection; _speech=speech; _dance=dance; _rig=FindFirstObjectByType<AvatarSceneRig>(); _window=FindFirstObjectByType<AvatarWindow>(); }
        private static RenderTexture Texture(int width,int height,int depth=0,int samples=1) {
            var texture=new RenderTexture(width,height,depth,RenderTextureFormat.ARGB32) { filterMode=FilterMode.Bilinear, antiAliasing=samples };
            texture.Create(); return texture;
        }
        internal void Begin(string json)
        {
            End();
            var settings=JsonUtility.FromJson<Settings>(json);
            if(settings==null || !Regex.IsMatch(settings.pipe??"",@"^katarune-live-[0-9a-f-]{36}$") || (settings.width!=1280 && settings.width!=1920 && settings.width!=2560) || (settings.fps!=30 && settings.fps!=60)) throw new InvalidOperationException("直播输出配置无效。");
            if(!SystemInfo.supportsAsyncGPUReadback) throw new InvalidOperationException("当前图形设备不支持后台直播读取。");
            _camera=Camera.main; if(_camera==null || _rig==null) throw new InvalidOperationException("直播相机尚未就绪。");
            _settings=settings; var height=settings.width*9/16;
            _framing=_rig.CaptureFraming(); _previousTarget=_camera.targetTexture; _previousAspect=_camera.aspect;
            _previousHdr=_camera.allowHDR; _previousClear=_camera.clearFlags; _previousColor=_camera.backgroundColor;
            _previousEnabled=_camera.enabled;
            _speechVolume=_speech.OutputVolume; _musicVolume=_dance.OutputVolume;
            _previousFrameRate=Application.targetFrameRate;
            try {
                // A target texture overrides URP's MSAA setting. Preserve the
                // desktop pipeline's edge quality, then resolve before readback.
                var samples=_camera.allowMSAA && GraphicsSettings.currentRenderPipeline is UniversalRenderPipelineAsset pipeline ? pipeline.msaaSampleCount : 1;
                _scene=Texture(settings.width,height,24,samples);
                _subtitles=Texture(settings.width,height); _composite=Texture(settings.width,height);
                var shader=Resources.Load<Shader>("Live/Composite"); if(shader==null) throw new InvalidOperationException("直播字幕合成资源缺失。");
                _blend=new Material(shader);
                _camera.targetTexture=_scene; _camera.aspect=settings.width/(float)height; _camera.allowHDR=false;
                _renderRequest=new RenderPipeline.StandardRequest { destination=_scene };
                if(!RenderPipeline.SupportsRenderRequest(_camera,_renderRequest)) throw new InvalidOperationException("当前渲染管线不支持后台直播。");
                _camera.enabled=false;
                _camera.clearFlags=CameraClearFlags.SolidColor;
                _rig.LiveOutputActive=true; _rig.LiveSolidBackground=settings.background=="solid"; _rig.SetPresentationMode(true,settings.camera);
                _panel=ScriptableObject.CreateInstance<PanelSettings>(); _panel.targetTexture=_subtitles;
                _panel.themeStyleSheet=Resources.Load<ThemeStyleSheet>("Live/LiveTheme");
                _panel.clearColor=true; _panel.colorClearValue=Color.clear; _panel.scaleMode=PanelScaleMode.ConstantPixelSize;
                _ui=new GameObject("Live Subtitles"); var document=_ui.AddComponent<UIDocument>(); document.panelSettings=_panel;
                var root=document.rootVisualElement; root.style.width=settings.width; root.style.height=height;
                root.style.justifyContent=Justify.FlexEnd; root.style.alignItems=Align.Center;
                var scale=settings.width/1280f;
                root.style.paddingBottom=AvatarSpeechSubtitles.Layout.BottomMargin(height,scale);
                _font=Font.CreateDynamicFontFromOSFont(AvatarSpeechSubtitles.Layout.FontFamilies,AvatarSpeechSubtitles.Layout.FontSize(scale));
                _label=new Label { enableRichText=false };
                _label.style.unityFontDefinition=FontDefinition.FromFont(_font);
                _label.style.fontSize=AvatarSpeechSubtitles.Layout.FontSize(scale); _label.style.whiteSpace=WhiteSpace.Normal;
                _label.style.unityTextAlign=TextAnchor.MiddleCenter; _label.style.maxWidth=AvatarSpeechSubtitles.Layout.MaxWidth(settings.width,scale,true);
                _label.style.paddingLeft=AvatarSpeechSubtitles.Layout.HorizontalPadding(scale); _label.style.paddingRight=AvatarSpeechSubtitles.Layout.HorizontalPadding(scale); _label.style.paddingTop=AvatarSpeechSubtitles.Layout.VerticalPadding(scale); _label.style.paddingBottom=AvatarSpeechSubtitles.Layout.VerticalPadding(scale);
                _label.style.backgroundColor=new Color(.11f,.10f,.14f,.92f);
                _label.style.borderTopLeftRadius=AvatarSpeechSubtitles.Layout.Radius(scale); _label.style.borderTopRightRadius=AvatarSpeechSubtitles.Layout.Radius(scale); _label.style.borderBottomLeftRadius=AvatarSpeechSubtitles.Layout.Radius(scale); _label.style.borderBottomRightRadius=AvatarSpeechSubtitles.Layout.Radius(scale);
                root.Add(_label);
                _audio=_camera.gameObject.AddComponent<AvatarLiveAudioTap>(); _audio.Acceptance=_acceptance; _audio.Begin();
                _frameBytes=settings.width*height*4; _frames=new BlockingCollection<Frame>(2);
                _lifetime=new CancellationTokenSource(); _active=true; _submitted=-1; _failure=null; _generation++;
                _captured=_dropped=_repeated=_written=_updates=0; _readbackMilliseconds=0; _readbacks=0;
                _videoPipe=Pipe(settings.pipe+"-video"); _audioPipe=Pipe(settings.pipe+"-audio");
                var cancellation=_lifetime.Token; var generation=_generation;
                var frames=_frames; var audio=_audio; var frameBytes=_frameBytes; var fps=settings.fps;
                _=Serve(_videoPipe,stream=>WriteVideo(stream,frames,frameBytes,fps,cancellation),generation,cancellation);
                _=Serve(_audioPipe,stream=>audio.WriteTo(stream,cancellation),generation,cancellation);
                Application.runInBackground=true; Application.targetFrameRate=settings.fps;
                _window?.SetLiveOutput(true); UpdateSettings(json);
            } catch { End(); throw; }
        }
        private static NamedPipeServerStream Pipe(string name) => new NamedPipeServerStream(name,PipeDirection.Out,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous,4096,256*1024);
        private async Task Serve(NamedPipeServerStream pipe,Action<Stream> writer,int generation,CancellationToken cancellation)
        {
            try { await pipe.WaitForConnectionAsync(cancellation); await Task.Run(()=>writer(pipe),cancellation); }
            catch { if(_active && generation==_generation && !cancellation.IsCancellationRequested) _failure="直播媒体传输中断。"; }
        }
        private void WriteVideo(Stream stream,BlockingCollection<Frame> frames,int frameBytes,int fps,CancellationToken cancellation)
        {
            byte[] previous=null; long written=0;
            try {
                foreach(var frame in frames.GetConsumingEnumerable(cancellation)) {
                    if(frame.Index<written) { ArrayPool<byte>.Shared.Return(frame.Bytes); Interlocked.Increment(ref _dropped); continue; }
                    if(frame.Index-written>fps*2) { ArrayPool<byte>.Shared.Return(frame.Bytes); throw new IOException("Live video fell behind."); }
                    while(written<frame.Index) { stream.Write(previous??frame.Bytes,0,frameBytes); written++; Interlocked.Increment(ref _repeated); }
                    stream.Write(frame.Bytes,0,frameBytes); written++;
                    Interlocked.Exchange(ref _written,written);
                    if(previous!=null) ArrayPool<byte>.Shared.Return(previous); previous=frame.Bytes;
                }
            } finally { if(previous!=null) ArrayPool<byte>.Shared.Return(previous); }
        }
        internal void UpdateSettings(string json)
        {
            if(!_active) return;
            var next=JsonUtility.FromJson<Settings>(json); if(next==null) return;
            // Resolution, FPS and pipe ownership remain fixed until restart.
            _settings.subtitles=next.subtitles;
            _settings.background=next.background; _settings.backgroundColor=next.backgroundColor; _settings.camera=next.camera;
            _speech.OutputVolume=next.voiceVolume; _dance.OutputVolume=next.musicVolume;
            _rig.LiveSolidBackground=next.background=="solid"; _rig.SetPresentationMode(true,next.camera);
            if(ColorUtility.TryParseHtmlString(next.backgroundColor,out var color)) _camera.backgroundColor=color;
        }
        private void Update()
        {
            if(!_active) return;
            if(_acceptance && Time.realtimeSinceStartup>_nextDiagnostic) { _nextDiagnostic=Time.realtimeSinceStartup+2; Debug.Log($"LIVE_ACCEPTANCE samples={_audio.Samples} frames={_submitted} updates={_updates} captured={_captured} written={Interlocked.Read(ref _written)} repeated={Interlocked.Read(ref _repeated)} dropped={Interlocked.Read(ref _dropped)} queued={_frames.Count} gpuPending={_readbacks} readbackMs={_readbackMilliseconds/Math.Max(1,_captured):F2} videoConnected={_videoPipe.IsConnected} audioConnected={_audioPipe.IsConnected}"); }
            if(_audio.Overflow) _failure="直播音频输出缓冲已满。";
            if(_audio.FormatChanged || AudioSettings.outputSampleRate!=_audio.SampleRate) _failure="直播期间音频设备格式发生变化，请重新启动直播。";
            if(_failure!=null) { var message=_failure; End(); Debug.LogError(message); return; }
            var text=_settings.subtitles?_connection.CurrentSubtitle:"";
            _label.text=text; _label.style.color=_connection.CurrentSubtitleColor;
            _label.style.backgroundColor=_connection.CurrentSubtitleBackground;
            _label.style.display=string.IsNullOrEmpty(text)?DisplayStyle.None:DisplayStyle.Flex;
        }
        private void LateUpdate()
        {
            if(!_active || _audio.Samples==0) return;
            _updates++;
            var clockIndex=(long)(_audio.TimeSeconds*_settings.fps);
            // The render loop and audio device are not phase locked. Allow one
            // CFR slot of phase tolerance, otherwise sub-frame scheduling jitter
            // alternates duplicate indices and holes despite a steady 60 Hz loop.
            if(clockIndex<_submitted) return;
            var index=Math.Max(clockIndex,_submitted+1);
            // Keep several GPU transfers in flight without letting slow consumers
            // accumulate latency. Raw video still preserves its audio-derived CFR slots.
            if(_readbacks>=4) { Interlocked.Increment(ref _dropped); return; }
            RenderPipeline.SubmitRenderRequest(_camera,_renderRequest);
            Graphics.Blit(_scene,_composite);
            _blend.SetFloat("_AcceptancePulse",_acceptance && _audio.Pulse?1f:0f);
            if(_settings.subtitles || _acceptance) Graphics.Blit(_subtitles,_composite,_blend);
            _submitted=index; _readbacks++; var generation=_generation; var frames=_frames;
            var submittedAt=Time.realtimeSinceStartupAsDouble;
            AsyncGPUReadback.Request(_composite,0,TextureFormat.RGBA32,result=> {
                _readbacks--; if(!_active || generation!=_generation) return;
                if(result.hasError) { _failure="直播画面读取失败。"; return; }
                _captured++; _readbackMilliseconds+=(Time.realtimeSinceStartupAsDouble-submittedAt)*1000;
                var data=result.GetData<byte>(); var bytes=ArrayPool<byte>.Shared.Rent(data.Length); data.CopyTo(bytes);
                if(!frames.TryAdd(new Frame { Bytes=bytes,Index=index })) { ArrayPool<byte>.Shared.Return(bytes); Interlocked.Increment(ref _dropped); }
            });
        }
        internal void End()
        {
            var wasActive=_active; _active=false; _generation++;
            _lifetime?.Cancel(); _lifetime?.Dispose(); _lifetime=null; _audio?.End();
            _videoPipe?.Dispose(); _audioPipe?.Dispose();
            _videoPipe=null; _audioPipe=null;
            if(_frames!=null) { _frames.CompleteAdding(); while(_frames.TryTake(out var frame)) ArrayPool<byte>.Shared.Return(frame.Bytes); }
            if(_readbacks>0) AsyncGPUReadback.WaitAllRequests(); _readbacks=0;
            if(_camera!=null) { _camera.enabled=_previousEnabled; _camera.targetTexture=_previousTarget; _camera.aspect=_previousAspect; _camera.allowHDR=_previousHdr; _camera.clearFlags=_previousClear; _camera.backgroundColor=_previousColor; }
            if(wasActive) { _rig.LiveOutputActive=false; _rig.LiveSolidBackground=false; _rig.RestoreFraming(_framing); _speech.OutputVolume=_speechVolume; _dance.OutputVolume=_musicVolume; Application.targetFrameRate=_previousFrameRate; _window?.SetLiveOutput(false); }
            if(_audio!=null) Destroy(_audio); if(_ui!=null) Destroy(_ui); if(_panel!=null) Destroy(_panel); if(_blend!=null) Destroy(_blend); if(_font!=null) Destroy(_font);
            foreach(var texture in new[]{_scene,_subtitles,_composite}) if(texture!=null) { texture.Release(); Destroy(texture); }
            _scene=null; _subtitles=null; _composite=null; _audio=null; _ui=null; _panel=null; _blend=null; _font=null; _camera=null;
        }
        private void OnDestroy() => End();
    }
}
