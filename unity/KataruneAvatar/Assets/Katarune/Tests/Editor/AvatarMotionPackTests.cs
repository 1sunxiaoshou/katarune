using System;
using System.IO;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarMotionPackTests
    {
        private AvatarMotionLibrary _library;
        private AnimationClip _clip;

        [SetUp]
        public void SetUp()
        {
            _clip = new AnimationClip();
            AnimationUtility.SetEditorCurve(_clip,
                EditorCurveBinding.FloatCurve(string.Empty, typeof(Animator), "Spine Front-Back"),
                AnimationCurve.Linear(0f, 0f, 2f, 0.1f));
            _library = ScriptableObject.CreateInstance<AvatarMotionLibrary>();
            _library.Configure(null, new[] { new AvatarActionDefinition("custom.salute", "自定义敬礼", _clip) });
            _library.StampPack("test-pack");
        }

        [TearDown]
        public void TearDown() { Object.DestroyImmediate(_library); Object.DestroyImmediate(_clip); }

        [Test]
        public void ArbitraryActionsHaveNamesAndDoNotInventPresetCapabilities()
        {
            AvatarMotionPacks.Validate(_library);
            Assert.That(_library.TryGetAction("custom.salute", out var action), Is.True);
            Assert.That(action.DisplayName, Is.EqualTo("自定义敬礼"));
            Assert.That(_library.Actions, Is.EqualTo(AvatarActionCapabilities.None));
            var options = AvatarCommandLine.Parse(new[] { "app", "--action", action.Id, "--motion-packs", "my-packs" });
            Assert.That(options.InitialAction, Is.EqualTo("custom.salute"));
            Assert.That(options.MotionPacksDirectory, Is.EqualTo(Path.GetFullPath("my-packs")));
        }

        [TestCase("../escape")]
        [TestCase("UPPER")]
        [TestCase("")]
        [TestCase("has space")]
        public void UnsafeIdsAreRejected(string id)
        {
            Assert.That(AvatarActionIds.IsValid(id), Is.False);
            Assert.Throws<ArgumentException>(() => AvatarCommandLine.Parse(new[] { "app", "--action", id }));
        }

        [TestCase("_formatVersion", "2")]
        [TestCase("_unityVersion", "old-version")]
        [TestCase("_platform", "Android")]
        public void IncompatiblePacksAreRejected(string field, string value)
        {
            var serialized = new SerializedObject(_library);
            var property = serialized.FindProperty(field);
            if (field == "_formatVersion") property.intValue = int.Parse(value);
            else property.stringValue = value;
            serialized.ApplyModifiedPropertiesWithoutUndo();
            Assert.Throws<InvalidDataException>(() => AvatarMotionPacks.Validate(_library));
        }

        [Test]
        public void DuplicateIdsAndInvalidSpeedsAreRejected()
        {
            var action = new AvatarActionDefinition("same", "Same", _clip);
            _library.Configure(null, new[] { action, action });
            Assert.Throws<InvalidDataException>(() => AvatarMotionPacks.Validate(_library));
            _library.Configure(null, new[] { new AvatarActionDefinition("speed", "Speed", _clip, speed: float.NaN) });
            Assert.Throws<InvalidDataException>(() => AvatarMotionPacks.Validate(_library));
        }

        [Test]
        public void AnimationEventsAreNotAcceptedFromExternalPacks()
        {
            AnimationUtility.SetAnimationEvents(_clip, new[] { new AnimationEvent { functionName = "InvokeSomething" } });
            Assert.Throws<InvalidDataException>(() => AvatarMotionPacks.Validate(_library));
        }

        [Test]
        public void SnapshotDistinguishesDifferentExternalActions()
        {
            var a = new AvatarMotionSnapshot(true, true, null, 1, currentActionId: "custom.a");
            var b = new AvatarMotionSnapshot(true, true, null, 1, currentActionId: "custom.b");
            Assert.That(a.Equals(b), Is.False);
            Assert.That(a.CurrentAction, Is.Null);
            Assert.That(a.CurrentActionId, Is.EqualTo("custom.a"));
        }

        [TestCase("Left Index 1 Stretched", false)]
        [TestCase("Left Thumb Spread", false)]
        [TestCase("RightHand.Little.Spread", false)]
        [TestCase("LeftHand.Index.1 Stretched", true)]
        [TestCase("RightHand.Thumb Spread", true)]
        [TestCase("Unknown Muscle", false)]
        public void PackBuilderRejectsNonstandardBindingsInsteadOfSilentlyDroppingThem(string property, bool valid)
        {
            AnimationUtility.SetEditorCurve(_clip,
                EditorCurveBinding.FloatCurve(string.Empty, typeof(Animator), property),
                AnimationCurve.Linear(0f, 0f, 2f, 0.5f));
            if (valid) Assert.DoesNotThrow(() => Editor.AvatarHumanoidClipValidator.ValidateBindings(_clip));
            else Assert.Throws<InvalidDataException>(() => Editor.AvatarHumanoidClipValidator.ValidateBindings(_clip));
        }
    }
}
