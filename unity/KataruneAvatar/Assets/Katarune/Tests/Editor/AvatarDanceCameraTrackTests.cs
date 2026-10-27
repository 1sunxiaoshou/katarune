using System;
using System.IO;
using System.Text;
using NUnit.Framework;
using UnityEngine;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarDanceCameraTrackTests
    {
        private static byte[] Fixture(string file="camera-animation.glb") => File.ReadAllBytes(Path.Combine(Application.dataPath,"Katarune/Tests/Fixtures",file));
        private static AvatarPackageCamera Settings() => new AvatarPackageCamera {
            referenceHeight=1.6f,animation="Camera",shots=new[]{new AvatarCameraShot{at=0,node="MainCamera"},new AvatarCameraShot{at=2,node="OrthoCamera"}}
        };
        [Test] public void InterpolatesStandardNodeAndLensCurvesAndSwitchesCameraNodes()
        {
            var track=AvatarDanceCameraTrack.Parse(Fixture(),Settings());
            Assert.That(track.ReferenceHeight,Is.EqualTo(1.6f));
            Assert.That(track.SampleAt(.5f).Position.x,Is.EqualTo(.5f).Within(.0001));
            Assert.That(track.SampleAt(.5f).FieldOfView,Is.EqualTo(32.5f).Within(.0001));
            Assert.That(Quaternion.Angle(track.SampleAt(.5f).Rotation,Quaternion.Euler(0,180,0)),Is.LessThan(.001));
            Assert.That(track.SampleAt(1.999f).Orthographic,Is.False);
            Assert.That(track.SampleAt(2).Orthographic,Is.True);
            Assert.That(track.SampleAt(2).Position.x,Is.EqualTo(-1));
            Assert.That(track.SampleAt(20).OrthographicSize,Is.EqualTo(1));
            Assert.That(track.SampleAt(.25f).Position.x,Is.EqualTo(.25f).Within(.0001));
            Assert.Throws<InvalidDataException>(()=>track.ValidateDuration(2));
            Assert.DoesNotThrow(()=>track.ValidateDuration(3));
            Assert.Throws<ArgumentOutOfRangeException>(()=>track.SampleAt(float.NaN));
        }
        [Test] public void SupportsStepAndCubicSplineWithoutResamplingTheClock()
        {
            var step=AvatarDanceCameraTrack.Parse(Fixture("camera-step.glb"),Settings());
            Assert.That(step.SampleAt(.99f).Position.x,Is.EqualTo(0));
            Assert.That(step.SampleAt(1).Position.x,Is.EqualTo(1));
            var cubic=AvatarDanceCameraTrack.Parse(Fixture("camera-cubic.glb"),Settings());
            Assert.That(cubic.SampleAt(.25f).Position.x,Is.EqualTo(.3125f).Within(.0001));
            Assert.That(cubic.SampleAt(.5f).FieldOfView,Is.EqualTo(45).Within(.0001));
            Assert.That(cubic.SampleAt(.75f).Position.x,Is.EqualTo(1.6875f).Within(.0001));
        }
        [Test] public void PreservesBakedCutsAtAdjacentFloatTimestamps()
        {
            var settings=Settings();settings.shots=new[]{settings.shots[0]};
            var track=AvatarDanceCameraTrack.Parse(Fixture("camera-cut.glb"),settings);
            Assert.That(track.SampleAt(1.75f).Position.x,Is.EqualTo(1));
            Assert.That(track.SampleAt(1.99999f).FieldOfView,Is.EqualTo(35).Within(.0001));
            Assert.That(track.SampleAt(2).Position.x,Is.EqualTo(-1));
            Assert.That(track.SampleAt(2).FieldOfView,Is.EqualTo(25).Within(.0001));
            Assert.That(track.SampleAt(1.75f).Position.x,Is.EqualTo(1));
        }
        [Test] public void RejectsMalformedOrAmbiguousResourcesBeforeTakingTheCamera()
        {
            Assert.Throws<InvalidDataException>(()=>AvatarDanceCameraTrack.Parse(Fixture()));
            Assert.Throws<InvalidDataException>(()=>AvatarDanceCameraTrack.Parse(new byte[32],Settings()));
            Assert.Throws<InvalidDataException>(()=>AvatarDanceCameraTrack.Parse(Encoding.UTF8.GetBytes("{}"),Settings()));
            var settings=Settings();settings.animation="missing";
            Assert.Throws<InvalidDataException>(()=>AvatarDanceCameraTrack.Parse(Fixture(),settings));
            settings=Settings();settings.shots[1].node="missing";
            Assert.Throws<InvalidDataException>(()=>AvatarDanceCameraTrack.Parse(Fixture(),settings));
            var file=Path.Combine(Path.GetTempPath(),Guid.NewGuid().ToString("N"));
            Assert.That(Assert.Throws<InvalidDataException>(()=>AvatarDanceCameraTrack.Read(file)).Message,Does.Not.Contain(file));
        }
        [Test] public void ReadsUnmodifiedNativeBlenderSceneExportWithAnimatedLens()
        {
            var track=AvatarDanceCameraTrack.Parse(Fixture("camera-blender.glb"));
            Assert.That(track.ReferenceHeight,Is.EqualTo(0));
            Assert.That(track.EndSeconds,Is.EqualTo(61f/30).Within(.0001));
            Assert.That(Vector3.Distance(track.SampleAt(0).Position,new Vector3(0,1,3)),Is.LessThan(.0001));
            Assert.That(track.SampleAt(track.EndSeconds).Position.x,Is.EqualTo(-2).Within(.0001));
            Assert.That(track.SampleAt(0).FieldOfView,Is.EqualTo(2*Mathf.Atan(12f/35)*Mathf.Rad2Deg).Within(.001));
            Assert.That(track.SampleAt(track.EndSeconds).FieldOfView,Is.EqualTo(2*Mathf.Atan(12f/70)*Mathf.Rad2Deg).Within(.001));
        }
    }
}
