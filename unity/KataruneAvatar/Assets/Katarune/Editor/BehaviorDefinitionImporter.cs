using System;
using System.IO;
using UnityEditor;
using UnityEditor.AssetImporters;
using UnityEngine;

namespace Katarune.Avatar.Editor
{
    public enum BehaviorDefinitionImportErrorCode
    {
        InvalidJson,
        UnknownField,
        MissingField,
        InvalidField,
        MissingClip,
        ValidationFailed,
    }

    public sealed class BehaviorDefinitionImportException : Exception
    {
        internal BehaviorDefinitionImportException(
            BehaviorDefinitionImportErrorCode code,
            string message)
            : base(message)
        {
            Code = code;
        }

        public BehaviorDefinitionImportErrorCode Code { get; }
    }

    [ScriptedImporter(1, "kbehavior", AllowCaching = true)]
    public sealed class BehaviorDefinitionImporter : ScriptedImporter
    {
        public override void OnImportAsset(AssetImportContext context)
        {
            try
            {
                var source = BehaviorDefinitionSourceParser.Parse(
                    File.ReadAllText(context.assetPath));
                var clipPath = AssetDatabase.GUIDToAssetPath(source.ClipGuid);
                if (string.IsNullOrEmpty(clipPath))
                {
                    throw new BehaviorDefinitionImportException(
                        BehaviorDefinitionImportErrorCode.MissingClip,
                        $"Behavior '{source.BehaviorId}' references missing clip GUID '{source.ClipGuid}'.");
                }

                context.DependsOnSourceAsset(clipPath);
                var clip = AssetDatabase.LoadAssetAtPath<AnimationClip>(clipPath);
                if (clip == null)
                {
                    throw new BehaviorDefinitionImportException(
                        BehaviorDefinitionImportErrorCode.MissingClip,
                        $"Behavior '{source.BehaviorId}' clip GUID '{source.ClipGuid}' does not resolve to an AnimationClip.");
                }

                var asset = ScriptableObject.CreateInstance<BehaviorDefinitionAsset>();
                asset.name = source.BehaviorId;
                source.Configure(asset, clip);
                var validation = BehaviorDefinitionAssetValidator.Validate(
                    asset,
                    CharacterRigCapabilities.All,
                    validateCapabilities: false);
                if (!validation.IsValid)
                {
                    throw new BehaviorDefinitionImportException(
                        BehaviorDefinitionImportErrorCode.ValidationFailed,
                        validation.Errors[0].Message);
                }

                context.AddObjectToAsset("definition", asset);
                context.SetMainObject(asset);
            }
            catch (BehaviorDefinitionImportException error)
            {
                context.LogImportError($"[{error.Code}] {error.Message}");
                throw;
            }
        }
    }
}
