using System;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;

namespace Katarune.Avatar
{
    [Serializable] public sealed class AvatarCharacterPackage
    {
        public int formatVersion = 2;
        public string id;
        public string version;
        public string model;
        public string idle;
        public string[] idleVariations;
        public AvatarPackageAction[] customActions;
        public AvatarPackageAction[] systemBehaviors;
    }
    [Serializable] public sealed class AvatarPackageAction
    {
        public string id;
        public string name;
        public string description;
        public string file;
        public string key;
        public AvatarPackagePlayback playback;

    }
    [Serializable] public sealed class AvatarPackagePlayback
    {
        public string kind;
        public string file;
        public string enter;
        public string loop;
        public string exit;
        public float blendSeconds = .2f;
        public string layer;
        public string blending;
        public string reference;
    }
    public interface IAvatarActionControl
    {
        bool FinishAction(string actionId);
        string CurrentInstanceId { get; }
        PerformanceInstanceState? GetActionState(string instanceId);
        string GetActionInstanceId(string actionId);
        bool CancelAction(string actionId);
    }
    public interface IAvatarPackageRuntime
    {
        Task<AvatarLoadResult> LoadPackageAsync(AvatarCharacterPackage package, CancellationToken cancellationToken = default);
        Task ValidatePackageAsync(AvatarCharacterPackage package, CancellationToken cancellationToken = default);
    }
    public interface IAvatarMotionCatalog { IReadOnlyList<AvatarActionInfo> AvailableActions { get; } }
}
