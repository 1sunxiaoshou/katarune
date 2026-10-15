using System;
using System.Collections.Generic;
using Katarune.Avatar;
using NUnit.Framework;
using UnityEngine;

namespace Katarune.Avatar.Tests
{
    public sealed class AdaptiveIdleTests
    {
        [Test] public void MissingUpperChestIsFoldedIntoTheChildRotation()
        {
            var pose = new FixedIdlePose("{\"hipsOffset\":[0,0,0],\"bones\":[{\"bone\":\"Chest\",\"parent\":\"LastBone\",\"rotation\":[0,0,0,1]},{\"bone\":\"UpperChest\",\"parent\":\"Chest\",\"rotation\":[0,0.258819,0,0.965926]},{\"bone\":\"Neck\",\"parent\":\"UpperChest\",\"rotation\":[0,0.173648,0,0.984808]}]}");
            Assert.That(Quaternion.Angle(pose.RotationBetween(HumanBodyBones.Neck,HumanBodyBones.Chest),Quaternion.Euler(0,50,0)),Is.LessThan(.001f));
            Assert.That(pose.RotationBetween(HumanBodyBones.LeftEye,HumanBodyBones.Head),Is.EqualTo(Quaternion.identity));
        }
        [Test] public void CyclicPoseHierarchyIsRejected()
        {
            Assert.Throws<ArgumentException>(() => new FixedIdlePose("{\"hipsOffset\":[0,0,0],\"bones\":[{\"bone\":\"Chest\",\"parent\":\"Chest\",\"rotation\":[0,0,0,1]}]}"));
        }
        [Test] public void CachedLoopRejectsForeignBonesInvalidRotationsAndOpenSeams()
        {
            var values = new float[AdaptiveIdleBaker.Frames*4]; for(var i=0;i<AdaptiveIdleBaker.Frames;i++) values[i*4+3]=1;
            var clip = new AdaptiveIdleBaker.BakedLoop { channels = new[] { new AdaptiveIdleBaker.Channel { path="hair",rotations=values } } };
            var allowed = new HashSet<string>{"hair"}; Assert.That(AdaptiveIdleBaker.IsValid(clip,allowed),Is.True);
            clip.channels[0].path="hips"; Assert.That(AdaptiveIdleBaker.IsValid(clip,allowed),Is.False);clip.channels[0].path="hair";
            values[0]=float.NaN;Assert.That(AdaptiveIdleBaker.IsValid(clip,allowed),Is.False);values[0]=0;
            values[^4]=.5f;values[^1]=Mathf.Sqrt(.75f);Assert.That(AdaptiveIdleBaker.IsValid(clip,allowed),Is.False);
        }
        [Test] public void CapsuleDistanceIncludesSphericalEndCaps()
        {
            Assert.That(AdaptiveIdleBaker.CapsuleDistance(new Vector3(0,2,0),Vector3.zero,Vector3.up,.25f),Is.EqualTo(.75f).Within(.00001f));
            Assert.That(AdaptiveIdleBaker.CapsuleDistance(new Vector3(.5f,.5f,0),Vector3.zero,Vector3.up,.25f),Is.EqualTo(.25f).Within(.00001f));
        }
    }
}
