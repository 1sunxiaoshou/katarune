using System;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;

namespace Katarune.Avatar
{
    [Serializable] public sealed class AvatarCharacterPackage
    {
        public string id;
        public string version;
        public string model;
        public string idle;
        public string[] idleVariations;
        public AvatarPackageAction[] customActions;
    }
    [Serializable] public sealed class AvatarPackageAction
    {
        public string id;
        public string name;
        public string description;
        public string file;
    }
    public interface IAvatarPackageRuntime
    {
        Task<AvatarLoadResult> LoadPackageAsync(AvatarCharacterPackage package, CancellationToken cancellationToken = default);
        Task ValidatePackageAsync(AvatarCharacterPackage package, CancellationToken cancellationToken = default);
    }
    public interface IAvatarMotionCatalog { IReadOnlyList<AvatarActionInfo> AvailableActions { get; } }
}
