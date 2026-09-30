using System;
using System.Collections.Generic;
using UnityEngine;

namespace Katarune.Avatar
{
    [CreateAssetMenu(fileName = "BehaviorDefinitionCatalog", menuName = "Katarune/Behavior Definition Catalog")]
    public sealed class BehaviorDefinitionCatalog : ScriptableObject
    {
        [SerializeField] private BehaviorDefinitionAsset[] _definitions =
            Array.Empty<BehaviorDefinitionAsset>();

        public IReadOnlyList<BehaviorDefinitionAsset> Definitions =>
            Array.AsReadOnly(_definitions ?? Array.Empty<BehaviorDefinitionAsset>());

        public bool IsValid
        {
            get
            {
                if (_definitions == null || _definitions.Length == 0) return false;
                for (var index = 0; index < _definitions.Length; index += 1)
                {
                    if (_definitions[index] == null) return false;
                }
                return true;
            }
        }

        internal void Configure(BehaviorDefinitionAsset[] definitions)
        {
            _definitions = definitions ?? Array.Empty<BehaviorDefinitionAsset>();
        }
    }
}
