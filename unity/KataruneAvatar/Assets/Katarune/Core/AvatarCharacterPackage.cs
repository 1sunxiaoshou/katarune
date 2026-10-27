using System;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;

namespace Katarune.Avatar
{
    [Serializable] public sealed class AvatarCharacterPackage
    {
        public int formatVersion = 3;
        public string id;
        public string version;
        public string model;
        public AvatarPackageIdle idle;
        public AvatarPackageAction[] actions;
        public AvatarActionBinding[] bindings;
    }
    [Serializable] public sealed class AvatarPackageAction
    {
        public string id;
        public string name;
        public string description;
        public string key;
        public AvatarPackagePlayback playback;

    }
    [Serializable] public sealed class AvatarPackagePlayback
    {
        public string kind;
        public string motion;
        public string enter;
        public string exit;
        public float blendSeconds = .2f;
        public string layer;
        public string blending;
        public string reference;
        public string audio;
        public string subtitles;
        public AvatarPackageCamera camera;
        // JsonUtility can materialize an omitted nested class as an empty object.
        public bool HasCamera => !string.IsNullOrEmpty(camera?.kind) || !string.IsNullOrEmpty(camera?.file) || (camera?.keys?.Length ?? 0) > 0;
    }
    [Serializable] public sealed class AvatarPackageIdle
    {
        public string @base;
        public string[] variations;
    }
    [Serializable] public sealed class AvatarActionBinding
    {
        public string role;
        public string actionId;
    }
    [Serializable] public sealed class AvatarPackageCamera
    {
        public string kind;
        public string file;
        public float referenceHeight;
        public string animation;
        public AvatarCameraShot[] shots;
        public AvatarDanceCameraCue[] keys;
    }
    [Serializable] public sealed class AvatarCameraShot
    {
        public float at;
        public string node;
    }
    [Serializable] public sealed class AvatarDanceCameraCue
    {
        public float at;
        public string view;
    }
    public interface IAvatarDanceRuntime
    {
        bool DanceActive { get; }
        string DanceError { get; }
        AvatarPackagePlayback GetDancePlayback(string actionId);
        void BeginDance(string actionId);
        void SampleDance(string actionId, float seconds);
        void EndDance(bool immediate = false);
    }
    public interface IAvatarActionControl
    {
        bool FinishAction(string actionId, bool completeCycle = false);
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
