using UnityEngine;

namespace Katarune.Avatar
{
    // Native mesh sub-assets share a binary container instead of enormous YAML arrays.
    // The authored prefab references these immutable meshes directly.
    [PreferBinarySerialization]
    public sealed class AvatarIslandMeshLibrary : ScriptableObject { }
}
