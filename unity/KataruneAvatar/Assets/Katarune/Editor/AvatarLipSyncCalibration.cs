using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Katarune.Avatar.Editor
{
    public static class AvatarLipSyncCalibration
    {
        private static readonly string[] Phonemes = { "A", "I", "U", "E", "O", "-" };

        [MenuItem("Katarune/Speech/Calibrate Selected Vowel Clips")]
        public static void CalibrateSelection()
        {
            var clips = Selection.objects.OfType<AudioClip>().ToArray();
            var output = EditorUtility.SaveFilePanel("Save uLipSync Profile (use the voice key as filename)", "", "profile", "json");
            if (!string.IsNullOrEmpty(output)) Calibrate(clips, output);
        }

        // Select six readable clips named A, I, U, E, O and Noise in the Project window.
        public static void Calibrate(AudioClip[] clips, string output)
        {
            var ordered = Phonemes.Select(name => clips.SingleOrDefault(clip =>
                string.Equals(clip.name, name == "-" ? "Noise" : name, StringComparison.OrdinalIgnoreCase))
                ?? throw new ArgumentException("Select readable A, I, U, E, O and Noise AudioClips.")).ToArray();
            var profile = uLipSync.Profile.Create();
            foreach (var name in Phonemes) profile.AddMfcc(name);
            var root = new GameObject("Lip Sync Calibration") { hideFlags = HideFlags.HideAndDontSave };
            var analyzer = root.AddComponent<uLipSync.uLipSync>();
            analyzer.enabled = false;
            try
            {
                analyzer.OnBakeStart(profile);
                for (var index = 0; index < ordered.Length; index++)
                {
                    var clip = ordered[index];
                    var source = new float[clip.samples * clip.channels];
                    if (!clip.GetData(source, 0)) throw new InvalidOperationException("Audio clip must be readable (Decompress On Load).");
                    var rate = AudioSettings.outputSampleRate;
                    var count = Mathf.FloorToInt((float)clip.samples * rate / clip.frequency);
                    var window = Mathf.CeilToInt((float)profile.sampleCount * rate / profile.targetSampleRate);
                    var buffer = new float[window];
                    var calibrated = 0;
                    for (var offset = 0; offset + window <= count; offset += window)
                    {
                        var energy = 0f;
                        for (var sample = 0; sample < window; sample++)
                        {
                            var sourcePosition = (float)(offset + sample) * clip.frequency / rate;
                            var first = Mathf.Min((int)sourcePosition, clip.samples - 1);
                            var next = Mathf.Min(first + 1, clip.samples - 1);
                            var value = 0f;
                            for (var channel = 0; channel < clip.channels; channel++)
                                value += Mathf.Lerp(source[first * clip.channels + channel], source[next * clip.channels + channel], sourcePosition - first);
                            buffer[sample] = value / clip.channels;
                            energy += buffer[sample] * buffer[sample];
                        }
                        if (Mathf.Sqrt(energy / window) < (index < 5 ? .003f : .0000001f)) continue;
                        analyzer.OnBakeUpdate(buffer, 1);
                        var finite = true;
                        for (var coefficient = 0; coefficient < analyzer.mfcc.Length; coefficient++)
                            if (!float.IsFinite(analyzer.mfcc[coefficient])) finite = false;
                        if (!finite) continue;
                        profile.UpdateMfcc(index, analyzer.mfcc, true);
                        calibrated++;
                    }
                    if (calibrated < profile.mfccDataCount) throw new InvalidOperationException($"{clip.name}: need at least {profile.mfccDataCount} analysis windows of usable audio.");
                }
                if (!profile.Export(output)) throw new IOException("Unable to save profile.");
                Debug.Log("KATARUNE_LIPSYNC_PROFILE_SAVED " + output);
            }
            finally
            {
                analyzer.OnBakeEnd();
                UnityEngine.Object.DestroyImmediate(root);
                UnityEngine.Object.DestroyImmediate(profile);
            }
        }
    }
}
