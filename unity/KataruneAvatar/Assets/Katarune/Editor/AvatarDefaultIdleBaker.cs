using System;
using System.IO;
using System.Threading;
using UniGLTF;
using UniVRM10;
using UnityEditor;
using UnityEngine;

namespace Katarune.Avatar.Editor
{
    public static class AvatarDefaultIdleBaker
    {
        [MenuItem("Katarune/Avatar/Bake Default Secondary Idle")]
        public static void Bake()
        {
            var bytes = File.ReadAllBytes(AvatarDefaultAssets.ModelPath(Application.dataPath));
            var model = Vrm10.LoadBytesAsync(bytes, canLoadVrm0X: false, showMeshes: false,
                awaitCaller: new ImmediateCaller(), materialGenerator: new UrpVrm10MaterialDescriptorGenerator()).GetAwaiter().GetResult();
            try
            {
                var clip = AdaptiveIdleBaker.PrepareAsync(model, bytes, CancellationToken.None, useCache: false, yieldDuringBake: false).GetAwaiter().GetResult();
                const string path = "Assets/Katarune/Resources/AdaptiveIdleDefault.json";
                File.WriteAllText(Path.Combine(Application.dataPath,"Katarune/Resources/AdaptiveIdleDefault.json"), JsonUtility.ToJson(clip));
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceUpdate);
                Debug.Log($"KATARUNE_DEFAULT_IDLE_READY channels={clip.channels.Length}");
            }
            finally { UnityEngine.Object.DestroyImmediate(model.gameObject); }
        }
    }
}
