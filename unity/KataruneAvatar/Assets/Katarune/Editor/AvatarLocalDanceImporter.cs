using System;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Katarune.Avatar.Editor
{
    public static class AvatarLocalDanceImporter
    {
        private const string ClipPath = "Assets/KataruneLocal/Motions/Baked/dance-delusion-angel.anim";
        private const string LibraryPath = AvatarMotionPackBuilder.LocalLibraryPath;

        [MenuItem("Katarune/Import Local Delusion Angel Dance")]
        public static void Import()
        {
            AssetDatabase.ImportAsset(ClipPath, ImportAssetOptions.ForceSynchronousImport);
            var clip = AssetDatabase.LoadAssetAtPath<AnimationClip>(ClipPath);
            if (clip == null || clip.legacy || !clip.isHumanMotion || clip.length <= 0f)
                throw new InvalidDataException("Export a valid Unity Humanoid animation to " + ClipPath);
            var library = AssetDatabase.LoadAssetAtPath<AvatarMotionLibrary>(LibraryPath);
            if (library == null || !library.IsValid)
                throw new InvalidOperationException("Install the local base motion library first.");

            var serialized = new SerializedObject(library);
            var actions = serialized.FindProperty("_actions");
            var index = -1;
            for (var i = 0; i < actions.arraySize; i++)
                if (actions.GetArrayElementAtIndex(i).FindPropertyRelative("_action").intValue
                    == (int)AvatarPresetAction.DanceDelusionAngel)
                    index = i;
            if (index < 0) { index = actions.arraySize; actions.arraySize++; }
            var entry = actions.GetArrayElementAtIndex(index);
            entry.FindPropertyRelative("_action").intValue = (int)AvatarPresetAction.DanceDelusionAngel;
            entry.FindPropertyRelative("_clip").objectReferenceValue = clip;
            entry.FindPropertyRelative("_speed").floatValue = 1f;
            entry.FindPropertyRelative("_maximumDuration").floatValue = 0f;
            serialized.ApplyModifiedPropertiesWithoutUndo();
            AssetDatabase.SaveAssets();
            Debug.Log($"KATARUNE_LOCAL_DANCE_READY duration={clip.length:F3} humanoid={clip.isHumanMotion} actions={actions.arraySize}");
        }
    }
}
