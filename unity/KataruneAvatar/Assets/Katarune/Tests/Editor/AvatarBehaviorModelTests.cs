using NUnit.Framework;
using UnityEngine;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarBehaviorModelTests
    {
        [TestCase(AvatarActivityState.Idle, AvatarActivityState.Listening)]
        [TestCase(AvatarActivityState.Listening, AvatarActivityState.Thinking)]
        [TestCase(AvatarActivityState.Thinking, AvatarActivityState.Speaking)]
        [TestCase(AvatarActivityState.Speaking, AvatarActivityState.Idle)]
        public void ActivityTransitionCompletesInQuarterSecond(
            AvatarActivityState start,
            AvatarActivityState target)
        {
            var model = CreateModel();
            model.SetActivity(start);
            model.Tick(AvatarBehaviorModel.StateTransitionSeconds, Vector2.zero);
            model.SetActivity(target);

            var partial = model.Tick(0.1f, Vector2.zero);
            Assert.That(partial.Activity, Is.EqualTo(target));
            Assert.That(partial.TransitionProgress, Is.InRange(0.39f, 0.41f));

            var completed = model.Tick(0.15f, Vector2.zero);
            Assert.That(completed.TransitionProgress, Is.EqualTo(1f).Within(0.001f));
        }

        [Test]
        public void AutomaticBlinkClosesAndReopens()
        {
            var model = CreateModel();
            model.Tick(2.51f, Vector2.zero);
            var closing = model.Tick(0.04f, Vector2.zero);
            Assert.That(closing.Blink, Is.GreaterThan(0f));

            AvatarPoseFrame reopened = null;
            for (var frame = 0; frame < 80; frame += 1)
            {
                reopened = model.Tick(0.01f, Vector2.zero);
            }
            Assert.That(reopened.Blink, Is.EqualTo(0f).Within(0.001f));
        }

        [Test]
        public void AutomaticBlinkCanProduceDoubleBlink()
        {
            var model = CreateModel();
            model.Tick(2.51f, Vector2.zero);
            var peaks = 0;
            var wasClosed = false;
            for (var frameIndex = 0; frameIndex < 80; frameIndex += 1)
            {
                var closed = model.Tick(0.01f, Vector2.zero).Blink > 0.95f;
                if (closed && !wasClosed) peaks += 1;
                wasClosed = closed;
            }

            Assert.That(peaks, Is.EqualTo(2));
        }

        [Test]
        public void ManualBlinkInterruptsScheduledWait()
        {
            var model = CreateModel();
            model.RequestBlink();

            Assert.That(model.Tick(0.04f, Vector2.zero).Blink, Is.GreaterThan(0.5f));
        }

        [Test]
        public void ManualGazeIsClampedToSafeRange()
        {
            var model = CreateModel();
            model.GazeMode = AvatarGazeMode.Manual;
            model.ManualGaze = new Vector2(100f, -100f);

            var frame = model.Tick(2f, Vector2.zero);
            Assert.That(frame.GazeYaw, Is.InRange(17.9f, 18f));
            Assert.That(frame.GazePitch, Is.InRange(-10f, -9.9f));
        }

        [Test]
        public void GazeModesSwitchSmoothlyWithinLimits()
        {
            var model = CreateModel();
            model.GazeMode = AvatarGazeMode.Pointer;
            var earlyPointer = model.Tick(0.01f, Vector2.one);
            Assert.That(earlyPointer.GazeYaw, Is.GreaterThan(0f).And.LessThan(18f));

            model.GazeMode = AvatarGazeMode.Manual;
            model.ManualGaze = new Vector2(-18f, -10f);
            var manual = model.Tick(1f, Vector2.one);
            Assert.That(manual.GazeYaw, Is.InRange(-18f, 18f));
            Assert.That(manual.GazePitch, Is.InRange(-10f, 10f));

            model.GazeMode = AvatarGazeMode.Auto;
            var automatic = model.Tick(1f, Vector2.zero);
            Assert.That(automatic.GazeYaw, Is.InRange(-18f, 18f));
            Assert.That(automatic.GazePitch, Is.InRange(-10f, 10f));
        }

        [Test]
        public void ViewportYawConvertsToOppositeAvatarYaw()
        {
            Assert.That(AvatarCoordinateSpace.ViewportYawToAvatarYaw(12f), Is.EqualTo(-12f));
            Assert.That(AvatarCoordinateSpace.ViewportYawToAvatarYaw(-8f), Is.EqualTo(8f));
        }

        [Test]
        public void AffectTransitionClearsPreviousPreset()
        {
            var model = CreateModel();
            model.SetAffect(AvatarAffectPreset.Happy, 1f);
            model.Tick(1f, Vector2.zero);
            Assert.That(model.CurrentFrame.Happy, Is.GreaterThan(0.98f));

            model.SetAffect(AvatarAffectPreset.Sad, 1f);
            model.Tick(1f, Vector2.zero);
            Assert.That(model.CurrentFrame.Happy, Is.LessThan(0.02f));
            Assert.That(model.CurrentFrame.Sad, Is.GreaterThan(0.98f));
        }

        [Test]
        public void SpeakingGeneratesMouthMotionAndIdleClosesIt()
        {
            var model = CreateModel();
            model.SetActivity(AvatarActivityState.Speaking);
            var speaking = model.Tick(0.2f, Vector2.zero);
            Assert.That(SumMouth(speaking), Is.GreaterThan(0.05f));

            model.SetActivity(AvatarActivityState.Idle);
            var idle = model.Tick(1f, Vector2.zero);
            Assert.That(SumMouth(idle), Is.LessThan(0.001f));
        }

        [Test]
        public void ManualMouthWorksWithoutSpeaking()
        {
            var model = CreateModel();
            model.AutoMouthEnabled = false;
            model.SetManualVisemes(1f, 0f, 0f, 0f, 0f);

            var frame = model.Tick(0.5f, Vector2.zero);
            Assert.That(frame.Aa, Is.GreaterThan(0.99f));
            Assert.That(frame.Ih, Is.LessThan(0.001f));
        }

        [Test]
        public void LongRunningPoseOffsetsRemainBounded()
        {
            var model = CreateModel();
            for (var index = 0; index < 18000; index += 1)
            {
                model.Tick(1f / 60f, Vector2.zero);
            }

            var frame = model.CurrentFrame;
            Assert.That(frame.HipsPositionOffset.magnitude, Is.LessThan(0.01f));
            Assert.That(frame.HeadEuler.magnitude, Is.LessThan(12f));
            Assert.That(Mathf.Abs(frame.LeftUpperArmEuler.z), Is.LessThan(80f));
            Assert.That(Mathf.Abs(frame.RightUpperArmEuler.z), Is.LessThan(80f));
        }

        [Test]
        public void ResetRestoresDefaultBehavior()
        {
            var model = CreateModel();
            model.SetActivity(AvatarActivityState.Speaking);
            model.SetAffect(AvatarAffectPreset.Angry, 1f);
            model.GazeMode = AvatarGazeMode.Manual;
            model.Reset();

            Assert.That(model.Activity, Is.EqualTo(AvatarActivityState.Idle));
            Assert.That(model.Affect, Is.EqualTo(AvatarAffectPreset.Neutral));
            Assert.That(model.GazeMode, Is.EqualTo(AvatarGazeMode.Auto));
            Assert.That(SumMouth(model.CurrentFrame), Is.EqualTo(0f));
        }

        [Test]
        public void OlderLoadRequestBecomesStale()
        {
            var gate = new AvatarLoadRequestGate();
            var first = gate.Begin();
            var second = gate.Begin();

            Assert.That(gate.IsCurrent(first), Is.False);
            Assert.That(gate.IsCurrent(second), Is.True);
            gate.Invalidate();
            Assert.That(gate.IsCurrent(second), Is.False);
        }

        private static AvatarBehaviorModel CreateModel()
        {
            return new AvatarBehaviorModel(new MinimumAvatarRandom());
        }

        private static float SumMouth(AvatarPoseFrame frame)
        {
            return frame.Aa + frame.Ih + frame.Ou + frame.Ee + frame.Oh;
        }

        private sealed class MinimumAvatarRandom : IAvatarRandom
        {
            public float Range(float minimum, float maximum) => minimum;
            public int Range(int minimumInclusive, int maximumExclusive) => minimumInclusive;
        }
    }
}
