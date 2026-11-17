using System.Collections;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UniGLTF;
using UniVRM10;
using UnityEngine;
using UnityEngine.TestTools;
using Object = UnityEngine.Object;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarIslandContactTests
    {
        [UnityTest]
        public IEnumerator IslandBackgroundCharacterPushesPropsAndEmitsWaterRipples()
        {
            var path = AvatarDefaultAssets.EditorModelPath(Application.dataPath);
            if (!File.Exists(path)) Assert.Ignore("Default local VRM required.");
            var loading = Vrm10.LoadBytesAsync(File.ReadAllBytes(path), canLoadVrm0X: false, showMeshes: false,
                awaitCaller: new RuntimeOnlyAwaitCaller(), materialGenerator: new UrpVrm10MaterialDescriptorGenerator());
            while (!loading.IsCompleted) yield return null;
            var model = loading.GetAwaiter().GetResult();
            model.UpdateType = Vrm10Instance.UpdateTypes.None;
            var root = new GameObject("Island character physics test");
            try
            {
                var backdrop = root.AddComponent<AvatarImmersiveBackdrop>();
                backdrop.BindAvatar(model.transform);
                backdrop.SetBackground("island-coast");
                backdrop.SetVisible(true);
                backdrop.Advance(1);
                var island = Resources.FindObjectsOfTypeAll<GameObject>().Single(value => value.name == "Katarune island coast" && value.scene.IsValid());
                var followers = island.GetComponentsInChildren<Rigidbody>().Where(value => value.isKinematic).ToArray();
                Assert.That(followers, Has.Length.EqualTo(4), "Loaded humanoid hands and feet must bind to the island.");
                var animator = model.GetComponentsInChildren<Animator>(true).First(value => value.avatar != null && value.isHuman);
                var hand = animator.GetBoneTransform(HumanBodyBones.LeftHand);
                var prop = island.transform.Find("Coconut").GetComponent<Rigidbody>();
                var original = prop.position;
                hand.position = original + Vector3.forward * .26f;
                yield return new WaitForFixedUpdate();
                for (var i = 0; i < 16; i++)
                {
                    hand.position += Vector3.back * .025f;
                    yield return new WaitForFixedUpdate();
                }
                Assert.That(original.z - prop.position.z, Is.GreaterThan(.10f), "An actual bone follower must physically push the prop.");
                Assert.That(prop.position.y, Is.GreaterThan(-.06f), "The prop must remain supported by the baked beach.");
                prop.position = original;
                prop.linearVelocity = Vector3.zero;
                prop.angularVelocity = Vector3.zero;
                hand.position = original + Vector3.left * .26f;
                yield return new WaitForFixedUpdate();
                for (var i = 0; i < 16; i++)
                {
                    hand.position += Vector3.right * .025f;
                    yield return new WaitForFixedUpdate();
                }
                Assert.That(prop.position.y, Is.GreaterThan(-.025f), "Pressing a prop against the crate must not push it through the beach.");
                hand.position = new Vector3(0, AvatarIslandWater.SeaLevel, -6);
                yield return new WaitForFixedUpdate();
                for (var i = 0; i < 8; i++)
                {
                    hand.position += Vector3.right * .02f;
                    yield return new WaitForFixedUpdate();
                }
                yield return null;
                var water = island.transform.Find("Lagoon").GetComponent<MeshRenderer>().sharedMaterial;
                Assert.That(water.GetVectorArray("_ContactRipples").Any(value => value.w > 0), Is.True);
                Object.Destroy(model.gameObject);
                yield return null;
                backdrop.BindAvatar(null);
                yield return null;
                Assert.That(followers.All(value => value == null), Is.True, "Unloading a character must remove collision proxies.");
                backdrop.SetVisible(false);
                backdrop.Advance(1);
                var hidden = prop.position;
                yield return new WaitForSecondsRealtime(.15f);
                Assert.That(prop.position, Is.EqualTo(hidden));
            }
            finally { Object.Destroy(root); if (model != null) Object.Destroy(model.gameObject); }
            yield return null;
        }
    }
}
