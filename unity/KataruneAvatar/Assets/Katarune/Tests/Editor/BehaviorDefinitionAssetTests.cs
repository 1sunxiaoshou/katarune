using System;
using System.IO;
using System.Linq;
using Katarune.Avatar.Editor;
using NUnit.Framework;
using UnityEngine;

namespace Katarune.Avatar.Tests
{
    public sealed class BehaviorDefinitionAssetTests
    {
        private const string DefinitionPath =
            "Assets/Katarune/Behaviors/KataruneQuietIdle.kbehavior";

        [Test]
        public void StrictSourceParserRejectsUnknownFields()
        {
            var json = File.ReadAllText(Path.GetFullPath(DefinitionPath));
            json = json.Replace(
                "\"schemaVersion\": 2,",
                "\"schemaVersion\": 2, \"unexpectedField\": true,");

            var error = Assert.Throws<BehaviorDefinitionImportException>(
                () => BehaviorDefinitionSourceParser.Parse(json));

            Assert.That(error.Code, Is.EqualTo(BehaviorDefinitionImportErrorCode.UnknownField));
            Assert.That(error.Message, Does.Contain("$.unexpectedField"));
        }

        [Test]
        public void ValidatorReportsMissingClip()
        {
            var definition = CreateDefinition(clip: null);

            var validation = BehaviorDefinitionAssetValidator.Validate(
                definition,
                CharacterRigCapabilities.HumanoidBody);

            Assert.That(validation.Errors.Select(error => error.Code),
                Does.Contain(BehaviorDefinitionValidationErrorCode.MissingClip));
        }

        [Test]
        public void ValidatorRejectsIllegalSyncPoint()
        {
            var clip = CreateOneSecondClip();
            var definition = CreateDefinition(
                clip,
                syncPoints: new[] { new BehaviorSyncPoint("exit.safe", 1.5f, true) });

            var validation = BehaviorDefinitionAssetValidator.Validate(
                definition,
                CharacterRigCapabilities.HumanoidBody);

            Assert.That(validation.Errors.Select(error => error.Code),
                Does.Contain(BehaviorDefinitionValidationErrorCode.InvalidSyncPoint));
        }

        [Test]
        public void ValidatorRejectsDuplicateChannelClaims()
        {
            var definition = CreateDefinition(
                CreateOneSecondClip(),
                claims: new[]
                {
                    new BehaviorChannelClaim(
                        PerformanceChannel.BodyBase,
                        PerformanceChannelOccupancy.Exclusive),
                    new BehaviorChannelClaim(
                        PerformanceChannel.BodyBase,
                        PerformanceChannelOccupancy.Shared),
                });

            var validation = BehaviorDefinitionAssetValidator.Validate(
                definition,
                CharacterRigCapabilities.HumanoidBody);

            Assert.That(validation.Errors.Select(error => error.Code),
                Does.Contain(BehaviorDefinitionValidationErrorCode.ChannelConflict));
        }

        [Test]
        public void ValidatorReportsMissingCharacterCapabilities()
        {
            var definition = CreateDefinition(
                CreateOneSecondClip(),
                requiredCapabilities: CharacterRigCapabilities.HumanoidBody
                    | CharacterRigCapabilities.Gaze);

            var validation = BehaviorDefinitionAssetValidator.Validate(
                definition,
                CharacterRigCapabilities.HumanoidBody);

            var error = validation.Errors.Single(candidate =>
                candidate.Code == BehaviorDefinitionValidationErrorCode.CapabilityMismatch);
            Assert.That(error.Message, Does.Contain("Gaze"));
        }

        [Test]
        public void GenericMotionAssemblyDoesNotReferenceUniVrm()
        {
            var assembly = typeof(AvatarMotionController).Assembly;

            Assert.That(assembly.GetName().Name, Is.EqualTo("Katarune.Avatar.Motion"));
            Assert.That(typeof(AvatarMotionLibrary).Assembly, Is.SameAs(assembly));
            Assert.That(typeof(ICharacterRigBinding).Assembly, Is.SameAs(assembly));
            Assert.That(
                assembly.GetReferencedAssemblies().Select(reference => reference.Name),
                Does.Not.Contain("Katarune.Avatar.UniVrm"));
        }

        [Test]
        public void DistributionMetadataDistinguishesThreeReadinessClasses()
        {
            Assert.That(Enum.GetValues(typeof(BehaviorAssetDistribution)), Is.EquivalentTo(new[]
            {
                BehaviorAssetDistribution.DevOnly,
                BehaviorAssetDistribution.PrototypeDistributable,
                BehaviorAssetDistribution.CommercialCandidate,
            }));
        }

        private static BehaviorDefinitionAsset CreateDefinition(
            AnimationClip clip,
            CharacterRigCapabilities requiredCapabilities = CharacterRigCapabilities.HumanoidBody,
            BehaviorChannelClaim[] claims = null,
            BehaviorSyncPoint[] syncPoints = null)
        {
            var definition = ScriptableObject.CreateInstance<BehaviorDefinitionAsset>();
            definition.Configure(
                BehaviorDefinitionAsset.CurrentSchemaVersion,
                "test.behavior",
                1,
                requiredCapabilities,
                claims ?? new[]
                {
                    new BehaviorChannelClaim(
                        PerformanceChannel.BodyBase,
                        PerformanceChannelOccupancy.Exclusive),
                },
                clip,
                null,
                null,
                new BehaviorClipSegment(0f, 0.8f),
                1,
                syncPoints ?? Array.Empty<BehaviorSyncPoint>(),
                syncPoints != null && syncPoints.Any(point => point.SafeExit) ? "exit.safe" : string.Empty,
                new BehaviorClipSegment(0.8f, 1f),
                Array.Empty<string>(),
                BehaviorFallbackStrategy.None,
                string.Empty,
                new BehaviorAssetLicense(
                    BehaviorAssetDistribution.DevOnly,
                    "test",
                    string.Empty,
                    "Katarune tests",
                    "test-only",
                    string.Empty,
                    "2026-08-22",
                    "generated Unity AnimationClip",
                    false,
                    true,
                    false,
                    "Test fixture is not shipped.",
                    string.Empty));
            return definition;
        }

        private static AnimationClip CreateOneSecondClip()
        {
            var clip = new AnimationClip();
            clip.SetCurve(
                string.Empty,
                typeof(Transform),
                "m_LocalPosition.x",
                AnimationCurve.Linear(0f, 0f, 1f, 0f));
            return clip;
        }
    }
}
