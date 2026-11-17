using System;
using System.Collections.Generic;
using UnityEngine;

namespace Katarune.Avatar
{
    // Loads finished offline-authored art. Runtime work is limited to presentation,
    // owned material animation and scoped lighting; there is no geometry generation.
    internal sealed class AvatarIslandBackdrop : IDisposable
    {
        private readonly GameObject _root;
        private readonly List<Material> _materials = new();
        private readonly AvatarIslandLighting _lighting;
        private readonly AvatarIslandBuoyancy[] _buoyancy;
        private readonly AvatarIslandContact _contact;

        internal AvatarIslandBackdrop(Camera camera = null)
        {
            var prefab = Resources.Load<GameObject>("Immersive/IslandCoast")
                ?? throw new InvalidOperationException("异世界海岸资源缺失，请在 Editor 中烘焙场景资源。");
            _root = UnityEngine.Object.Instantiate(prefab);
            _root.name = "Katarune island coast";
            _root.hideFlags = HideFlags.DontSave;
            _root.SetActive(false);
            try
            {
                foreach (var renderer in _root.GetComponentsInChildren<MeshRenderer>(true))
                {
                    var material = new Material(renderer.sharedMaterial);
                    material.SetFloat("_Opacity", 0);
                    AvatarIslandWater.Apply(material);
                    renderer.sharedMaterial = material;
                    _materials.Add(material);
                }
                _lighting = new AvatarIslandLighting(_root, camera);
                _buoyancy = _root.GetComponentsInChildren<AvatarIslandBuoyancy>(true);
                _contact = _root.AddComponent<AvatarIslandContact>();
                _contact.Initialize(_root.transform.Find("Lagoon").GetComponent<MeshRenderer>().sharedMaterial);
            }
            catch { Dispose(); throw; }
        }

        internal void Update(float opacity, float time, Vector3 origin, float scale)
        {
            var stageChanged = _root.transform.position != origin ||
                !Mathf.Approximately(_root.transform.localScale.x, scale);
            if (stageChanged && _root.activeSelf) _root.SetActive(false);
            _root.transform.SetPositionAndRotation(origin, Quaternion.identity);
            _root.transform.localScale = Vector3.one * scale;
            foreach (var body in _buoyancy) body.SetTime(time);
            _root.SetActive(opacity > 0);
            _contact.SetTime(time);
            _lighting.Update(opacity);
            if (opacity <= 0) return;
            foreach (var material in _materials)
            {
                material.SetFloat("_Opacity", opacity);
                material.SetFloat("_MotionTime", time);
            }
        }

        internal void BindAvatar(Transform avatar) => _contact.Bind(avatar);

        public void Dispose()
        {
            _lighting?.Dispose();
            Release(_root);
            foreach (var material in _materials) Release(material);
            _materials.Clear();
        }
        private static void Release(UnityEngine.Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value); else UnityEngine.Object.DestroyImmediate(value);
        }
    }
}
