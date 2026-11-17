using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
namespace Katarune.Avatar.Tests
{
    public sealed class AvatarModelFramingTests
    {
        [Serializable] class Measurement { public string name; public Vector3 center,size,portrait,camera; public float fov; }
        [Serializable] class Report { public List<Measurement> rows=new(); }
        [UnityTest]
        public IEnumerator ModelFramingIsIndependentOfAnimationFormatAndPreparationOrder()
        {
            var folder=Environment.GetEnvironmentVariable("KATARUNE_FRAMING_FIXTURES");
            if(string.IsNullOrEmpty(folder))Assert.Ignore("Set KATARUNE_FRAMING_FIXTURES to native.json and vrma.json package inputs.");
            var native=JsonUtility.FromJson<AvatarCharacterPackage>(File.ReadAllText(Path.Combine(folder,"native.json")));
            var vrma=JsonUtility.FromJson<AvatarCharacterPackage>(File.ReadAllText(Path.Combine(folder,"vrma.json")));
            var reversed=JsonUtility.FromJson<AvatarCharacterPackage>(File.ReadAllText(Path.Combine(folder,"native.json")));Array.Reverse(reversed.actions);
            var empty=new AvatarCharacterPackage {id="framing-baseline",model=native.model,actions=Array.Empty<AvatarPackageAction>()};
            var host=new GameObject("Framing regression");var camera=host.AddComponent<Camera>();
            var rig=host.AddComponent<AvatarSceneRig>();rig.Configure(false);rig.enabled=false;
            var visuals=host.AddComponent<AvatarVisualController>();visuals.Configure();
            var motions=host.AddComponent<AvatarMotionController>();motions.Configure();
            var loader=new UniVrmAvatarLoader(visuals,motions);var report=new Report();
            var dance=native.actions.First(a=>a.playback.kind=="performance").playback;
            var track=AvatarDanceCameraTrack.Read(dance.camera.file,dance.camera);
            try
            {
                var packages=new[]{empty,vrma,native,reversed};var names=new[]{"model-only","vrma","native","native-reversed"};
                for(var i=0;i<packages.Length;i++)
                {
                    var task=loader.LoadPackageAsync(packages[i],new AvatarPresentationSettings(false),CancellationToken.None);
                    while(!task.IsCompleted)yield return null;
                    using(var candidate=task.GetAwaiter().GetResult())
                    {
                        var model=candidate.Model;model.Show();rig.ActivateFraming(model.RootTransform,model.Bounds,model.PortraitTarget);
                        var framing=rig.CaptureFraming();rig.SetDanceCameraTrack(track,10f);
                        report.rows.Add(new Measurement {name=names[i],center=model.Bounds.center,size=model.Bounds.size,portrait=framing.PortraitTarget,camera=camera.transform.position,fov=camera.fieldOfView});
                        rig.ClearFraming();model.Hide();
                    }
                    yield return null;
                }
                File.WriteAllText(Path.Combine(folder,"framing-comparison.json"),JsonUtility.ToJson(report,true));
                foreach(var row in report.rows.Skip(1))
                {
                    Assert.That(Vector3.Distance(row.size,report.rows[0].size),Is.LessThan(.0001f),row.name+" must retain model dimensions");
                    Assert.That(Vector3.Distance(row.center,report.rows[0].center),Is.LessThan(.0001f),row.name+" must retain ground/center");
                    Assert.That(Vector3.Distance(row.portrait,report.rows[0].portrait),Is.LessThan(.0001f),row.name+" must retain portrait anchor");
                    Assert.That(Vector3.Distance(row.camera,report.rows[0].camera),Is.LessThan(.0001f),row.name+" must retain authored dance camera position");
                }
            }
            finally { UnityEngine.Object.Destroy(host); }
        }
    }
}
