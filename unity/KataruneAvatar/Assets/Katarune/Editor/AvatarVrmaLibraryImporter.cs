using System;
using System.Collections.Generic;
using System.IO;
using UniGLTF;
using UniHumanoid;
using UniVRM10;
using UnityEditor;
using UnityEngine;

namespace Katarune.Avatar.Editor
{
    // Offline format adaptation only. Playback and transitions belong to AvatarMotionInstance.
    public static class AvatarVrmaLibraryImporter
    {
        private const string OutputDirectory = "Assets/KataruneLocal/Motions/Baked";
        private const string LibraryPath = AvatarMotionPackBuilder.LocalLibraryPath;

        [MenuItem("Katarune/Import Local VRMA Motion Library")]
        public static void ImportLocalDefaults()
        {
            if (File.Exists(LibraryPath))
                throw new IOException("Move the previous generated library to the recycle bin before replacing it.");
            Directory.CreateDirectory(OutputDirectory);
            Directory.CreateDirectory(Path.GetDirectoryName(LibraryPath));
            var idle = Bake(AvatarDefaultAssets.IdleMotionPath(Application.dataPath), true);
            var actions = new[]
            {
                AvatarPresetAction.RightHandOffer, AvatarPresetAction.RightHandOpen,
                AvatarPresetAction.RightHandToChest, AvatarPresetAction.LeftHandOpenTwice,
            };
            var definitions = new AvatarActionDefinition[actions.Length];
            for (var i = 0; i < actions.Length; i++)
                definitions[i] = new AvatarActionDefinition(actions[i],
                    Bake(AvatarDefaultAssets.IdleVariationPath(Application.dataPath, i + 1), false));
            var library = ScriptableObject.CreateInstance<AvatarMotionLibrary>();
            // HumanPose curves encode FK muscles, not Unity's optional foot IK goal curves.
            library.Configure(idle, definitions, applyFootIK: false);
            AssetDatabase.CreateAsset(library, LibraryPath);
            AssetDatabase.SaveAssets();
            Debug.Log("KATARUNE_VRMA_LIBRARY_READY: base loop and four manual gestures.");
        }

        private static AnimationClip Bake(string path, bool loop)
        {
            var name = Path.GetFileNameWithoutExtension(path);
            var output = $"{OutputDirectory}/{name}.anim";
            if (File.Exists(output)) throw new IOException("Refusing to overwrite " + output);
            using var data = new AutoGltfFileParser(path).Parse();
            using var importer = new VrmAnimationImporter(new VrmAnimationData(data));
            var source = importer.LoadAsync(new ImmediateCaller()).GetAwaiter().GetResult();
            try
            {
                var animator = source.Root.GetComponent<Animator>();
                animator.enabled = false;
                var animation = source.Root.GetComponent<Animation>();
                animation.enabled = false;
                animation.playAutomatically = false;
                var state = animation[animation.clip.name];
                state.enabled = true;
                state.weight = 1f;
                state.speed = 0f;
                state.wrapMode = WrapMode.ClampForever;
                using var handler = new HumanPoseHandler(animator.avatar, animator.transform);
                var curves = new Dictionary<EditorCurveBinding, AnimationCurve>();
                var pose = new HumanPose();
                var frames = Mathf.RoundToInt(animation.clip.length * 30f);
                for (var frame = 0; frame <= frames; frame++)
                {
                    var time = frame / 30f;
                    state.time = time;
                    animation.Sample();
                    handler.GetHumanPose(ref pose);
                    var sample = AnimationClipUtility.CreateAnimationClipFromHumanPose(pose);
                    foreach (var binding in AnimationUtility.GetCurveBindings(sample))
                    {
                        if (!curves.TryGetValue(binding, out var curve))
                            curves.Add(binding, curve = new AnimationCurve());
                        curve.AddKey(time, AnimationUtility.GetEditorCurve(sample, binding).Evaluate(0f));
                    }
                    UnityEngine.Object.DestroyImmediate(sample);
                }
                var clip = new AnimationClip { name = name, frameRate = 30f };
                foreach (var entry in curves)
                {
                    for (var key = 0; key < entry.Value.length; key++)
                    {
                        AnimationUtility.SetKeyLeftTangentMode(entry.Value, key, AnimationUtility.TangentMode.Linear);
                        AnimationUtility.SetKeyRightTangentMode(entry.Value, key, AnimationUtility.TangentMode.Linear);
                    }
                    AnimationUtility.SetEditorCurve(clip, entry.Key, entry.Value);
                }
                var settings = AnimationUtility.GetAnimationClipSettings(clip);
                settings.loopTime = loop;
                settings.loopBlendOrientation = true;
                settings.loopBlendPositionY = true;
                settings.loopBlendPositionXZ = true;
                settings.keepOriginalOrientation = true;
                AnimationUtility.SetAnimationClipSettings(clip, settings);
                clip.EnsureQuaternionContinuity();
                if (!clip.isHumanMotion || clip.legacy || clip.length <= 0f)
                    throw new InvalidDataException("VRMA bake did not produce an animated Humanoid clip.");
                AssetDatabase.CreateAsset(clip, output);
                Debug.Log($"KATARUNE_VRMA_BAKED {name} duration={clip.length:F3} loop={loop}");
                return clip;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(source.Root);
            }
        }
    }
}
