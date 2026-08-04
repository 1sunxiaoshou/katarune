using System.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarVisualTests
    {
        [TestCase("Face", "Renderer", AvatarMaterialRole.Face)]
        [TestCase("Hair_Main", "Renderer", AvatarMaterialRole.Hair)]
        [TestCase("Iris", "Face", AvatarMaterialRole.Eye)]
        [TestCase("Eyelash", "Face", AvatarMaterialRole.Detail)]
        [TestCase("Skin", "Body", AvatarMaterialRole.Skin)]
        [TestCase("Uniform", "Body", AvatarMaterialRole.Clothing)]
        [TestCase("Material_01", "Mesh", AvatarMaterialRole.Generic)]
        public void ClassifierRecognizesCommonVrmMaterialNames(
            string materialName,
            string rendererName,
            AvatarMaterialRole expected)
        {
            Assert.That(AvatarMaterialClassifier.Classify(materialName, rendererName), Is.EqualTo(expected));
        }

        [Test]
        public void MaterialStylingIsRecomputedFromBaselineWithoutDrift()
        {
            var shader = Shader.Find("VRM10/Universal Render Pipeline/MToon10");
            Assert.That(shader, Is.Not.Null);
            var avatar = new GameObject("Avatar Visual Test");
            var renderer = avatar.AddComponent<MeshRenderer>();
            var material = new Material(shader) { name = "Hair_Main" };
            renderer.sharedMaterial = material;
            var profile = ScriptableObject.CreateInstance<AvatarVisualProfile>();
            var settings = new AvatarVisualSettings();
            settings.Reset(profile);
            var originalToony = material.GetFloat("_ShadingToonyFactor");
            var visuals = AvatarVisualInstance.Create(avatar, profile, settings);

            var firstToony = material.GetFloat("_ShadingToonyFactor");
            visuals.Apply(settings);
            var secondToony = material.GetFloat("_ShadingToonyFactor");

            Assert.That(firstToony, Is.Not.EqualTo(originalToony));
            Assert.That(secondToony, Is.EqualTo(firstToony).Within(0.00001f));
            Assert.That(visuals.Statistics.GetCount(AvatarMaterialRole.Hair), Is.EqualTo(1));

            visuals.Dispose();
            Assert.That(material.GetFloat("_ShadingToonyFactor"), Is.EqualTo(originalToony).Within(0.00001f));
            Object.DestroyImmediate(material);
            Object.DestroyImmediate(profile);
            Object.DestroyImmediate(avatar);
        }

        [TestCase("Assets/Settings/PC_Renderer.asset")]
        [TestCase("Assets/Settings/Mobile_Renderer.asset")]
        public void UrpRendererIncludesMToonOutlineFeature(string path)
        {
            var assets = AssetDatabase.LoadAllAssetsAtPath(path);
            Assert.That(assets.Any(asset => asset != null && asset.GetType().Name == "MToonOutlineRenderFeature"), Is.True);
        }
    }
}
