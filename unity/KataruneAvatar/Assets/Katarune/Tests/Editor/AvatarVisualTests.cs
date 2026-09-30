using System.IO;
using System.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using VRM10.MToon10;

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
        public void SoftOutlineProfileUsesTheApprovedRoleWidths()
        {
            var profile = ScriptableObject.CreateInstance<AvatarVisualProfile>();

            Assert.That(profile.OutlineIntensity, Is.EqualTo(0.55f));
            Assert.That(profile.OutlineColorBlend, Is.EqualTo(0.86f));
            Assert.That(profile.OutlineLightingMix, Is.EqualTo(0.18f));
            Assert.That(profile.GetSoftOutline(AvatarMaterialRole.Face).Width, Is.EqualTo(0.0008f));
            Assert.That(profile.GetSoftOutline(AvatarMaterialRole.Skin).Width, Is.EqualTo(0.001f));
            Assert.That(profile.GetSoftOutline(AvatarMaterialRole.Hair).Width, Is.EqualTo(0.0015f));
            Assert.That(profile.GetSoftOutline(AvatarMaterialRole.Clothing).Width, Is.EqualTo(0.0013f));
            Assert.That(profile.GetSoftOutline(AvatarMaterialRole.Generic).Width, Is.EqualTo(0.0012f));
            Assert.That(profile.GetSoftOutline(AvatarMaterialRole.Eye).Enabled, Is.False);
            Assert.That(profile.GetSoftOutline(AvatarMaterialRole.Detail).Enabled, Is.False);

            Object.DestroyImmediate(profile);
        }

        [Test]
        public void DefaultSettingsKeepSoftOutlineDisabled()
        {
            var settings = new AvatarVisualSettings();

            settings.Reset();

            Assert.That(settings.SoftOutlineEnabled, Is.False);
        }

        [Test]
        public void SoftOutlineChangesOnlyOutlinePropertiesAndRestoresExactly()
        {
            var shader = Shader.Find("VRM10/Universal Render Pipeline/MToon10");
            Assert.That(shader, Is.Not.Null);
            var avatar = new GameObject("Avatar Outline Test");
            var renderer = avatar.AddComponent<MeshRenderer>();
            var material = new Material(shader) { name = "Hair_Main" };
            renderer.sharedMaterial = material;
            var baseline = new MToon10Context(material)
            {
                ShadingToonyFactor = 0.43f,
                ShadingShiftFactor = 0.12f,
                GiEqualizationFactor = 0.37f,
                ParametricRimColorFactorSrgb = new Color(0.2f, 0.3f, 0.4f, 1f),
                OutlineWidthMode = MToon10OutlineMode.World,
                OutlineWidthFactor = 0.003f,
                OutlineColorFactorSrgb = new Color(0.7f, 0.1f, 0.2f, 1f),
                OutlineLightingMixFactor = 0.73f,
            };
            baseline.Validate();
            var originalToony = baseline.ShadingToonyFactor;
            var originalShift = baseline.ShadingShiftFactor;
            var originalGi = baseline.GiEqualizationFactor;
            var originalRim = baseline.ParametricRimColorFactorSrgb;
            var originalOutlineColor = baseline.OutlineColorFactorSrgb;
            var profile = ScriptableObject.CreateInstance<AvatarVisualProfile>();
            var settings = new AvatarVisualSettings();
            var visuals = AvatarVisualInstance.Create(avatar, profile, settings);

            settings.Reset(true);
            visuals.Apply(settings);
            var outlined = new MToon10Context(material);

            Assert.That(outlined.ShadingToonyFactor, Is.EqualTo(originalToony).Within(0.00001f));
            Assert.That(outlined.ShadingShiftFactor, Is.EqualTo(originalShift).Within(0.00001f));
            Assert.That(outlined.GiEqualizationFactor, Is.EqualTo(originalGi).Within(0.00001f));
            Assert.That(outlined.ParametricRimColorFactorSrgb, Is.EqualTo(originalRim));
            Assert.That(outlined.OutlineWidthMode, Is.EqualTo(MToon10OutlineMode.Screen));
            Assert.That(outlined.OutlineWidthFactor, Is.EqualTo(0.0015f * 0.55f).Within(0.000001f));

            var firstOutlineColor = outlined.OutlineColorFactorSrgb;
            visuals.Apply(settings);
            Assert.That(new MToon10Context(material).OutlineColorFactorSrgb, Is.EqualTo(firstOutlineColor));

            settings.Reset(false);
            visuals.Apply(settings);
            var restored = new MToon10Context(material);
            Assert.That(restored.OutlineWidthMode, Is.EqualTo(MToon10OutlineMode.World));
            Assert.That(restored.OutlineWidthFactor, Is.EqualTo(0.003f).Within(0.000001f));
            Assert.That(restored.OutlineColorFactorSrgb.r, Is.EqualTo(originalOutlineColor.r).Within(0.00001f));
            Assert.That(restored.OutlineColorFactorSrgb.g, Is.EqualTo(originalOutlineColor.g).Within(0.00001f));
            Assert.That(restored.OutlineColorFactorSrgb.b, Is.EqualTo(originalOutlineColor.b).Within(0.00001f));
            Assert.That(restored.OutlineColorFactorSrgb.a, Is.EqualTo(originalOutlineColor.a).Within(0.00001f));
            Assert.That(restored.OutlineLightingMixFactor, Is.EqualTo(0.73f).Within(0.00001f));

            visuals.Dispose();
            Object.DestroyImmediate(material);
            Object.DestroyImmediate(profile);
            Object.DestroyImmediate(avatar);
        }

        [Test]
        public void EyeMaterialsHaveNoSoftOutline()
        {
            var shader = Shader.Find("VRM10/Universal Render Pipeline/MToon10");
            Assert.That(shader, Is.Not.Null);
            var avatar = new GameObject("Avatar Eye Outline Test");
            var renderer = avatar.AddComponent<MeshRenderer>();
            var material = new Material(shader) { name = "Iris" };
            renderer.sharedMaterial = material;
            var profile = ScriptableObject.CreateInstance<AvatarVisualProfile>();
            var settings = new AvatarVisualSettings();
            settings.Reset(true);
            var visuals = AvatarVisualInstance.Create(avatar, profile, settings);
            var context = new MToon10Context(material);

            Assert.That(context.OutlineWidthMode, Is.EqualTo(MToon10OutlineMode.None));
            Assert.That(context.OutlineWidthFactor, Is.Zero);

            visuals.Dispose();
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

        [Test]
        public void RuntimeSceneHasNoPostProcessingOrGlobalVolume()
        {
            var scene = File.ReadAllText("Assets/Scenes/AvatarRuntime.unity");
            var profile = File.ReadAllText("Assets/Settings/AvatarRuntimeProfile.asset");

            Assert.That(scene, Does.Contain("m_RenderPostProcessing: 0"));
            Assert.That(scene, Does.Not.Contain("m_Name: Global Volume"));
            Assert.That(profile, Does.Contain("components: []"));
            Assert.That(profile, Does.Not.Contain("m_Name: Bloom"));
            Assert.That(profile, Does.Not.Contain("m_Name: Vignette"));
            Assert.That(profile, Does.Not.Contain("m_Name: Tonemapping"));
        }
    }
}
