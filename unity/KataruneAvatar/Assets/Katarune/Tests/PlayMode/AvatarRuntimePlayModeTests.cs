using System.Collections;
using System.Threading;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarRuntimePlayModeTests
    {
        [UnityTest]
        public IEnumerator BehaviorControllerAppliesFramesToBoundDriver()
        {
            var gameObject = new GameObject("Behavior Controller Test");
            var controller = gameObject.AddComponent<AvatarBehaviorController>();
            var driver = new RecordingAvatarDriver();
            controller.Bind(driver);
            controller.SetActivity(AvatarActivityState.Speaking);

            yield return null;
            yield return null;

            Assert.That(driver.ApplyCount, Is.GreaterThan(0));
            Assert.That(driver.LastFrame.Activity, Is.EqualTo(AvatarActivityState.Speaking));
            Object.Destroy(gameObject);
            yield return null;
        }

        [UnityTest]
        public IEnumerator DebugPanelCanToggleWithoutLoadedModel()
        {
            var gameObject = new GameObject("Debug Panel Test");
            var sceneRig = gameObject.AddComponent<AvatarSceneRig>();
            sceneRig.Configure(false);
            var controller = gameObject.AddComponent<AvatarBehaviorController>();
            var session = new AvatarRuntimeSession(sceneRig, controller, CancellationToken.None);
            var panel = gameObject.AddComponent<AvatarDebugPanel>();
            panel.Configure(session, controller, null, false, false, true);

            panel.ToggleVisible();
            Assert.That(panel.Visible, Is.True);
            panel.ToggleVisible();
            Assert.That(panel.Visible, Is.False);

            session.Dispose();
            Object.Destroy(gameObject);
            yield return null;
        }

        private sealed class RecordingAvatarDriver : IAvatarDriver
        {
            public int ApplyCount { get; private set; }
            public AvatarPoseFrame LastFrame { get; private set; }

            public bool SupportsAffect(AvatarAffectPreset preset) => true;

            public void Apply(AvatarPoseFrame frame)
            {
                ApplyCount += 1;
                LastFrame = frame;
            }

            public void ResetPose()
            {
            }

            public void Dispose()
            {
            }
        }
    }
}
