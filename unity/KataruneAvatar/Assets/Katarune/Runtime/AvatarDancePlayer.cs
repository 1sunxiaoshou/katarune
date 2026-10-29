using System;
using System.Collections;
using System.Linq;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Networking;

namespace Katarune.Avatar
{
    // Owns one independent dance. Dialogue generation and its drain barrier never own this lifetime.
    internal sealed class AvatarDancePlayer : MonoBehaviour
    {
        internal float OutputVolume { get => _source != null ? _source.volume : 1f; set { if (_source != null) _source.volume = Mathf.Clamp01(value); } }
        private IAvatarRuntimeFacade _runtime;
        private IAvatarDanceRuntime _motion;
        private AvatarSceneRig _rig;
        private AudioSource _source;
        private AudioClip _audio;
        private UnityWebRequest _loadingAudio;
        private AvatarDanceSubtitles _subtitles;
        private AvatarDanceCameraTrack _cameraTrack;
        private Action<string, string> _notify;
        private Coroutine _playing;
        private AvatarSceneRig.AvatarFramingState _framing;
        private bool _hasFraming;
        private string _action;
        private int _generation;
        internal bool Active { get; private set; }
        internal string ActionId => Active ? _action : null;
        internal bool Started { get; private set; }
        internal float PositionSeconds { get; private set; }
        internal float DurationSeconds { get; private set; }
        internal string SubtitleText { get; private set; } = "";

        internal void Configure(IAvatarRuntimeFacade runtime, AvatarSceneRig rig)
        {
            _runtime = runtime; _motion = runtime as IAvatarDanceRuntime; _rig = rig;
            _source = gameObject.AddComponent<AudioSource>();
            _source.playOnAwake = false; _source.spatialBlend = 0f; _source.loop = false;
        }

        internal void Play(string action, Action<string, string> notify)
        {
            if (Active) throw new InvalidOperationException("舞蹈正在播放。");
            var info = _runtime.AvailableActions.FirstOrDefault(value => value.Id == action && value.IsDance);
            var playback = _motion?.GetDancePlayback(action);
            if (playback == null || info.Id == null) throw new InvalidOperationException("当前角色没有该舞蹈。");
            if (_runtime.Snapshot.RuntimeState != AvatarRuntimeState.Ready) throw new InvalidOperationException("角色尚未就绪。");
            _action = action; _notify = notify; Active = true; Started = false; PositionSeconds = 0; DurationSeconds = info.DurationSeconds;
            _subtitles = null; _cameraTrack = null; SubtitleText = "";
            var generation = ++_generation;
            _playing = StartCoroutine(PlayRoutine(playback, generation));
        }

        private IEnumerator PlayRoutine(AvatarPackagePlayback playback, int generation)
        {
            string error = null;
            var loadingSubtitles = string.IsNullOrEmpty(playback.subtitles) ? null : Task.Run(() => AvatarDanceSubtitles.Read(playback.subtitles));
            var loadingCamera = playback.camera?.kind != "track" ? null : Task.Run(() => AvatarDanceCameraTrack.Read(playback.camera.file, playback.camera));
            if (!string.IsNullOrEmpty(playback.audio))
            {
                UnityWebRequestAsyncOperation loading = null;
                try { _loadingAudio = AvatarAudioClipLoader.CreateRequest(playback.audio); loading = _loadingAudio.SendWebRequest(); }
                catch (Exception problem) { error = "舞蹈伴奏" + problem.Message; }
                if (error != null) { Complete("failed", error); yield break; }
                yield return loading;
                if (!Active || generation != _generation) yield break;
                try
                {
                    _audio = AvatarAudioClipLoader.GetDecodedClip(_loadingAudio);
                    if (_audio.length > 3600f) throw new InvalidOperationException("舞蹈伴奏不能超过一小时。");
                    if (_audio.length + .05f < DurationSeconds) throw new InvalidOperationException("舞蹈伴奏短于动作。");
                    _source.clip = _audio;
                }
                catch (Exception problem) { error = problem.Message; }
                _loadingAudio.Dispose(); _loadingAudio = null;
                if (error != null) { Complete("failed", error); yield break; }
            }
            if (loadingSubtitles != null)
            {
                while (!loadingSubtitles.IsCompleted && Active && generation == _generation) yield return null;
                if (!Active || generation != _generation) yield break;
                try
                {
                    _subtitles = loadingSubtitles.GetAwaiter().GetResult();
                    _subtitles.ValidateDuration(DurationSeconds);
                }
                catch (Exception problem) { error = problem.Message; }
                if (error != null) { Complete("failed", error); yield break; }
            }
            if (loadingCamera != null)
            {
                while (!loadingCamera.IsCompleted && Active && generation == _generation) yield return null;
                if (!Active || generation != _generation) yield break;
                try
                {
                    if ((playback.camera?.keys?.Length ?? 0) > 0) throw new InvalidOperationException("镜头轨道与预设镜头不能同时配置。");
                    _cameraTrack = loadingCamera.GetAwaiter().GetResult(); _cameraTrack.ValidateDuration(DurationSeconds);
                }
                catch (Exception problem) { error = problem.Message; }
                if (error != null) { Complete("failed", error); yield break; }
            }
            try
            {
                if (_rig != null) { _framing = _rig.CaptureFraming(); _hasFraming = true; _rig.DancePresentationActive = true; _rig.SetCharacterShowcaseControlEnabled(false); }
                _motion.BeginDance(_action); _motion.SampleDance(_action, 0f);
                if (_cameraTrack != null) _rig?.SetDanceCameraTrack(_cameraTrack, 0f);
                if (_audio != null) _source.Play();
            }
            catch (Exception problem) { error = problem.Message; }
            if (error != null) { Complete("failed", error); yield break; }
            // A successful start response is sent only after a rendered frame and a real audio start.
            yield return null;
            if (!Active || generation != _generation) yield break;
            if (_motion.DanceError != null) { Complete("failed", _motion.DanceError); yield break; }
            if (_audio != null && !_source.isPlaying) { Complete("failed", "舞蹈伴奏未能启动。"); yield break; }
            Started = true; _notify?.Invoke("started", null);
            var began = Time.realtimeSinceStartupAsDouble;
            var previousPosition = 0f;
            var cueIndex = 0;
            var cues = playback.camera?.keys ?? Array.Empty<AvatarDanceCameraCue>();
            while (Active && generation == _generation)
            {
                try
                {
                    if (_motion.DanceError != null) throw new InvalidOperationException(_motion.DanceError);
                    if (_runtime.Snapshot.RuntimeState != AvatarRuntimeState.Ready || !_motion.DanceActive)
                        throw new InvalidOperationException("舞蹈角色已卸载。");
                    PositionSeconds = _audio != null ? (float)_source.timeSamples / _audio.frequency : (float)(Time.realtimeSinceStartupAsDouble - began);
                    if (_audio != null && !_source.isPlaying)
                    {
                        if (previousPosition + Mathf.Max(.05f, Time.unscaledDeltaTime * 2f) < Mathf.Min(DurationSeconds, _audio.length))
                            throw new InvalidOperationException("舞蹈伴奏提前结束。");
                        PositionSeconds = DurationSeconds;
                    }
                    PositionSeconds = Mathf.Min(PositionSeconds, DurationSeconds);
                    previousPosition = PositionSeconds;
                    _motion.SampleDance(_action, PositionSeconds);
                    if (_cameraTrack != null) _rig?.SetDanceCameraTrack(_cameraTrack, PositionSeconds);
                    SubtitleText = PositionSeconds < DurationSeconds ? _subtitles?.TextAt(PositionSeconds) ?? "" : "";
                    while (cueIndex < cues.Length && cues[cueIndex].at <= PositionSeconds)
                    { _rig?.SetDanceCamera(cues[cueIndex].view); cueIndex++; }
                }
                catch (Exception problem) { error = problem.Message; }
                if (error != null) { Complete("failed", error); yield break; }
                if (PositionSeconds >= DurationSeconds) break;
                yield return null;
            }
            if (!Active || generation != _generation) yield break;
            _source.Stop();
            // Keep the last dance pose until the next LateUpdate samples the endpoint.
            yield return null;
            if (_motion.DanceError != null) { Complete("failed", _motion.DanceError); yield break; }
            _motion.EndDance();
            while (Active && generation == _generation && _motion.DanceActive)
            {
                if (_motion.DanceError != null) { Complete("failed", _motion.DanceError); yield break; }
                yield return null;
            }
            if (Active && generation == _generation && _hasFraming && (cues.Length > 0 || _cameraTrack != null) && _rig != null)
            {
                _rig.BeginDanceCameraRestore(_framing);
                while (Active && generation == _generation && _rig.DanceCameraRestoring) yield return null;
            }
            if (Active && generation == _generation) Complete("completed", null);
        }

        internal void Cancel(string reason)
        {
            if (!Active) return;
            ++_generation;
            if (_playing != null) StopCoroutine(_playing);
            Complete("cancelled", reason);
        }
        private void Complete(string status, string error)
        {
            if (!Active) return;
            _source?.Stop();
            _loadingAudio?.Abort(); _loadingAudio?.Dispose(); _loadingAudio = null;
            SubtitleText = ""; _subtitles = null; _cameraTrack = null;
            _motion?.EndDance(true);
            if (_hasFraming && _rig != null) { _rig.DancePresentationActive = false; _rig.RestoreDanceCamera(_framing); }
            _hasFraming = false;
            if (_source != null) _source.clip = null;
            AvatarAudioClipLoader.Release(_audio);
            _audio = null; Active = false; Started = false; _playing = null;
            var notify = _notify; _notify = null; notify?.Invoke(status, error);
        }
        private void OnDestroy() => Cancel("舞蹈播放已中断。");
    }
}
