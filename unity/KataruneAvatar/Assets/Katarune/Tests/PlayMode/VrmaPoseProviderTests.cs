using NUnit.Framework;
using UniVRM10;
using UnityEngine;

namespace Katarune.Avatar.Tests
{
    public sealed class VrmaPoseProviderTests
    {
        private sealed class HipsPose : INormalizedPoseProvider
        {
            public Vector3 GetRawHipsPosition() => new Vector3(.1f, 1f, .2f);
            public Quaternion GetNormalizedLocalRotation(HumanBodyBones bone, HumanBodyBones parent) => Quaternion.identity;
        }

        [Test]
        public void MissingTargetUpperChestPreservesHeadWorldRotationAndHipsTranslation()
        {
            var root = new GameObject("source");
            try
            {
                var chest = Child(root.transform, "chest");
                var upper = Child(chest, "upperChest");
                var neck = Child(upper, "neck");
                var head = Child(neck, "head");
                var source = new VrmaPoseProvider(root.transform, new[] {
                    (chest, HumanBodyBones.Chest), (upper, HumanBodyBones.UpperChest),
                    (neck, HumanBodyBones.Neck), (head, HumanBodyBones.Head),
                }, new HipsPose());
                chest.localRotation = Quaternion.Euler(12f, 7f, 0f);
                upper.localRotation = Quaternion.Euler(-10f, 0f, 4f);
                neck.localRotation = Quaternion.Euler(3f, -5f, 0f);
                head.localRotation = Quaternion.Euler(-2f, 0f, 0f);
                var targetHead = source.GetNormalizedLocalRotation(HumanBodyBones.Chest, HumanBodyBones.LastBone)
                    * source.GetNormalizedLocalRotation(HumanBodyBones.Neck, HumanBodyBones.Chest)
                    * source.GetNormalizedLocalRotation(HumanBodyBones.Head, HumanBodyBones.Neck);
                Assert.That(Quaternion.Angle(targetHead, head.rotation), Is.LessThan(.01f));
                Assert.That(source.GetRawHipsPosition(), Is.EqualTo(new Vector3(.1f, 1f, .2f)));
            }
            finally { Object.DestroyImmediate(root); }
        }

        [Test]
        public void MissingSourceUpperChestLeavesTargetJointNeutralWithoutDuplicatingChestMotion()
        {
            var root = new GameObject("source");
            try
            {
                var chest = Child(root.transform, "chest"); var neck = Child(chest, "neck");
                var source = new VrmaPoseProvider(root.transform, new[] { (chest, HumanBodyBones.Chest), (neck, HumanBodyBones.Neck) }, new HipsPose());
                chest.localRotation = Quaternion.Euler(15f, 0f, 0f); neck.localRotation = Quaternion.Euler(-8f, 0f, 0f);
                var target = source.GetNormalizedLocalRotation(HumanBodyBones.Chest, HumanBodyBones.LastBone)
                    * source.GetNormalizedLocalRotation(HumanBodyBones.UpperChest, HumanBodyBones.Chest)
                    * source.GetNormalizedLocalRotation(HumanBodyBones.Neck, HumanBodyBones.UpperChest);
                Assert.That(Quaternion.Angle(target, neck.rotation), Is.LessThan(.01f));
            }
            finally { Object.DestroyImmediate(root); }
        }

        [Test]
        public void NonIdentityRestAxesAndUnmappedHelperPreserveNormalizedWorldRotation()
        {
            var root = new GameObject("source");
            try
            {
                root.transform.rotation = Quaternion.Euler(0f, 40f, 0f);
                var chest = Child(root.transform, "chest"); chest.localRotation = Quaternion.Euler(10f, 0f, 20f);
                var helper = Child(chest, "helper"); helper.localRotation = Quaternion.Euler(0f, 5f, 0f);
                var neck = Child(helper, "neck"); neck.localRotation = Quaternion.Euler(-10f, 0f, -20f);
                var rest = neck.rotation; var rootRest = root.transform.rotation;
                var source = new VrmaPoseProvider(root.transform, new[] { (chest, HumanBodyBones.Chest), (neck, HumanBodyBones.Neck) }, new HipsPose());
                Assert.That(Quaternion.Angle(source.GetNormalizedLocalRotation(HumanBodyBones.Neck, HumanBodyBones.Chest), Quaternion.identity), Is.LessThan(.01f));
                chest.localRotation *= Quaternion.Euler(8f, 4f, 0f); helper.localRotation *= Quaternion.Euler(-5f, 2f, 3f);
                neck.localRotation *= Quaternion.Euler(2f, -3f, 1f); root.transform.rotation = Quaternion.Euler(0f, 65f, 0f);
                var target = source.GetNormalizedLocalRotation(HumanBodyBones.Chest, HumanBodyBones.LastBone)
                    * source.GetNormalizedLocalRotation(HumanBodyBones.Neck, HumanBodyBones.Chest);
                var expected = Quaternion.Inverse(root.transform.rotation) * neck.rotation * Quaternion.Inverse(rest) * rootRest;
                Assert.That(Quaternion.Angle(target, expected), Is.LessThan(.01f));
            }
            finally { Object.DestroyImmediate(root); }
        }

        private static Transform Child(Transform parent, string name)
        { var child = new GameObject(name).transform; child.SetParent(parent, false); return child; }
    }
}
