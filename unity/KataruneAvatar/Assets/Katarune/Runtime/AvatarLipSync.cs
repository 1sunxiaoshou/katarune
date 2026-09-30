using UnityEngine;
using uLipSync;

namespace Katarune.Avatar
{
    // uLipSync invokes its analysis callback on Update, never on the audio thread.
    [RequireComponent(typeof(AudioSource), typeof(uLipSyncAudioSource))]
    public sealed class AvatarLipSync : MonoBehaviour
    {
        private IAvatarRuntimeFacade _runtime;
        private AudioSource _source;
        private uLipSync.uLipSync _analyzer;
        private uLipSyncAudioSource _proxy;
        private readonly object _audioGate = new object();
        private bool _acceptAudio;

        public void Configure(IAvatarRuntimeFacade runtime, Profile profile)
        {
            Release();
            _runtime = runtime;
            _source = GetComponent<AudioSource>();
            var analysisObject = new GameObject("Speech Analysis");
            analysisObject.transform.SetParent(transform);
            analysisObject.SetActive(false);
            _analyzer = analysisObject.AddComponent<uLipSync.uLipSync>();
            _analyzer.profile = profile;
            _analyzer.enabled = false;
            _analyzer.onLipSyncUpdate.AddListener(OnLipSyncUpdate);
            analysisObject.SetActive(true);
            _proxy = GetComponent<uLipSyncAudioSource>();
            _proxy.onAudioFilterRead.AddListener(OnSamples);
        }

        public void Begin() { lock (_audioGate) { _analyzer.enabled = true; _acceptAudio = true; } }
        public void End() { lock (_audioGate) { _acceptAudio = false; if (_analyzer != null) _analyzer.enabled = false; } Clear(); }
        private void OnSamples(float[] samples, int channels)
        {
            lock (_audioGate) { if (_acceptAudio) _analyzer.OnDataReceived(samples, channels); }
        }

        public static AvatarVisemeWeights Map(LipSyncInfo info)
        {
            if (info.phonemeRatios == null || !float.IsFinite(info.rawVolume) || info.rawVolume <= 0f)
                return default;
            var volume = Mathf.Clamp01((Mathf.Log10(info.rawVolume) - Common.DefaultMinVolume)
                / (Common.DefaultMaxVolume - Common.DefaultMinVolume));
            float Ratio(string key)
            {
                return info.phonemeRatios.TryGetValue(key, out var value) && float.IsFinite(value)
                    ? Mathf.Clamp01(value) : 0f;
            }
            var a = Ratio("A"); var i = Ratio("I"); var u = Ratio("U");
            var e = Ratio("E"); var o = Ratio("O");
            // Do not redistribute noise/consonant probability into an open vowel.
            var gain = volume / Mathf.Max(1f, a + i + u + e + o);
            return new AvatarVisemeWeights(a * gain, i * gain, u * gain, e * gain, o * gain);
        }

        private void OnLipSyncUpdate(LipSyncInfo info)
        {
            if (_runtime == null) return;
            if (_source.isPlaying && _runtime.Snapshot.RuntimeState == AvatarRuntimeState.Ready)
                _runtime.SetManualVisemes(Map(info));
            else Clear();
        }

        public void Clear() => _runtime?.SetManualVisemes(default, immediate: true);

        public void Release()
        {
            End();
            if (_proxy != null) _proxy.onAudioFilterRead.RemoveListener(OnSamples);
            if (_analyzer != null)
            {
                _analyzer.onLipSyncUpdate.RemoveListener(OnLipSyncUpdate);
                Destroy(_analyzer.gameObject);
                _analyzer = null;
            }
            Clear();
            _runtime = null;
        }

        private void OnDisable() => Release();
    }
}
