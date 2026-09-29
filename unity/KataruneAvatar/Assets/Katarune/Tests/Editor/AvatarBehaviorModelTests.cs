using NUnit.Framework;
using UnityEngine;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarBehaviorModelTests
    {
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
        public void PointerGazeIsClampedToSafeRange()
        {
            var model = CreateModel();
            model.ApplySettings(model.Settings.WithPointerGazeTracking(true));

            var frame = model.Tick(2f, new Vector2(100f, -100f));
            var combined = CombinedGaze(frame);
            Assert.That(combined.x, Is.InRange(17.9f, 18f));
            Assert.That(combined.y, Is.InRange(-10f, -9.9f));
            Assert.That(frame.GazeYaw, Is.LessThan(combined.x));
            Assert.That(frame.GazePitch, Is.GreaterThan(combined.y));
        }

        [Test]
        public void EyesLeadBeforeHeadFollowsLargeGazeShift()
        {
            var model = CreateModel();
            model.ApplySettings(model.Settings.WithPointerGazeTracking(true));

            var early = model.Tick(0.03f, new Vector2(18f, 0f));
            Assert.That(early.GazeYaw, Is.GreaterThan(0f));
            Assert.That(early.HeadEuler.y, Is.Zero.Within(0.001f));
            Assert.That(early.NeckEuler.y, Is.Zero.Within(0.001f));

            var settled = model.Tick(1f, new Vector2(18f, 0f));
            Assert.That(settled.HeadEuler.y, Is.LessThan(-0.5f));
            Assert.That(settled.NeckEuler.y, Is.LessThan(-0.25f));
            Assert.That(CombinedGaze(settled).x, Is.GreaterThan(17.8f));
        }

        [Test]
        public void SmallGazeShiftDoesNotRecruitHead()
        {
            var model = CreateModel();
            model.ApplySettings(model.Settings.WithPointerGazeTracking(true));

            var frame = model.Tick(2f, new Vector2(2f, 1f));
            Assert.That(CombinedGaze(frame).x, Is.EqualTo(2f).Within(0.01f));
            Assert.That(CombinedGaze(frame).y, Is.EqualTo(1f).Within(0.01f));
            Assert.That(frame.HeadEuler.x, Is.Zero.Within(0.001f));
            Assert.That(frame.HeadEuler.y, Is.Zero.Within(0.001f));
            Assert.That(frame.NeckEuler.x, Is.Zero.Within(0.001f));
            Assert.That(frame.NeckEuler.y, Is.Zero.Within(0.001f));
        }

        [Test]
        public void PointerGazeToggleReturnsSmoothlyToCenter()
        {
            var model = CreateModel();
            model.ApplySettings(model.Settings.WithPointerGazeTracking(true));
            var earlyPointer = model.Tick(0.01f, new Vector2(18f, 10f));
            Assert.That(earlyPointer.GazeYaw, Is.GreaterThan(0f).And.LessThan(18f));

            model.ApplySettings(model.Settings.WithPointerGazeTracking(false));
            var fixedForward = model.Tick(1f, Vector2.one);
            Assert.That(CombinedGaze(fixedForward).magnitude, Is.LessThan(0.01f));
        }

        [Test]
        public void PointerGazeTrackingIsDisabledByDefault()
        {
            var model = CreateModel();

            var fixedFrame = model.Tick(30f, new Vector2(1f, -1f));
            Assert.That(CombinedGaze(fixedFrame).magnitude, Is.LessThan(0.001f));
            Assert.That(model.PointerGazeTrackingEnabled, Is.False);
        }

        [Test]
        public void EnablingPointerGazeContinuouslyTracksPointer()
        {
            var model = CreateModel();
            model.ApplySettings(model.Settings.WithPointerGazeTracking(true));

            model.Tick(1f, new Vector2(18f, 10f));
            var frame = model.Tick(1f, new Vector2(-18f, -10f));

            Assert.That(CombinedGaze(frame).x, Is.LessThan(-17.9f));
            Assert.That(CombinedGaze(frame).y, Is.LessThan(-9.9f));
        }

        [Test]
        public void ViewportYawConvertsToOppositeAvatarYaw()
        {
            Assert.That(AvatarCoordinateSpace.ViewportYawToAvatarYaw(12f), Is.EqualTo(-12f));
            Assert.That(AvatarCoordinateSpace.ViewportYawToAvatarYaw(-8f), Is.EqualTo(8f));
            Assert.That(AvatarCoordinateSpace.AvatarYawToViewportYaw(12f), Is.EqualTo(-12f));
            Assert.That(AvatarCoordinateSpace.AvatarYawToViewportYaw(-8f), Is.EqualTo(8f));
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
        public void AffectTransitionUsesFastResponse()
        {
            var model = CreateModel();
            model.SetAffect(AvatarAffectPreset.Happy, 1f);

            model.Tick(0.12f, Vector2.zero);

            Assert.That(model.CurrentFrame.Happy, Is.EqualTo(1f - Mathf.Exp(-1f)).Within(0.001f));
        }

        [Test]
        public void MouthRemainsClosedWithoutVisemeInput()
        {
            var model = CreateModel();
            Assert.That(SumMouth(model.Tick(2f, Vector2.zero)), Is.LessThan(0.001f));
        }

        [Test]
        public void ManualVisemesDriveAndReleaseMouthIndependently()
        {
            var model = CreateModel();
            model.SetManualVisemes(1f, 0f, 0f, 0f, 0f);

            var frame = model.Tick(0.5f, Vector2.zero);
            Assert.That(frame.Aa, Is.GreaterThan(0.99f));
            Assert.That(frame.Ih, Is.LessThan(0.001f));

            model.SetManualVisemes(default(AvatarVisemeWeights));
            Assert.That(SumMouth(model.Tick(0.9f, Vector2.zero)), Is.LessThan(0.001f));
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
        public void IdleDoesNotAddProceduralBreathingOrHeadSway()
        {
            var model = CreateModel();

            var frame = model.Tick(37f, Vector2.zero);

            Assert.That(frame.HipsPositionOffset, Is.EqualTo(Vector3.zero));
            Assert.That(frame.SpineEuler, Is.EqualTo(Vector3.zero));
            Assert.That(frame.ChestEuler, Is.EqualTo(Vector3.zero));
            Assert.That(frame.UpperChestEuler, Is.EqualTo(Vector3.zero));
            Assert.That(frame.NeckEuler, Is.EqualTo(Vector3.zero));
            Assert.That(frame.HeadEuler, Is.EqualTo(Vector3.zero));
            Assert.That(frame.ProceduralGazeCompensation, Is.EqualTo(Vector2.zero));
        }

        [Test]
        public void StaticFallbackDoesNotDevelopMotionOverTime()
        {
            var model = CreateModel();
            for (var frame = 1; frame <= 18000; frame += 1)
            {
                var current = model.Tick(1f / 60f, Vector2.zero);
                Assert.That(current.SpineEuler, Is.EqualTo(Vector3.zero));
                Assert.That(current.ChestEuler, Is.EqualTo(Vector3.zero));
                Assert.That(current.HeadEuler, Is.EqualTo(Vector3.zero));
            }
        }

        [Test]
        public void AmbientWindRemainsWeakContinuousAndBounded()
        {
            var previous = AvatarAmbientWind.Sample(0f);
            var changed = false;
            var maximumObserved = previous.magnitude;
            var minimumHorizontal = previous.x;
            var maximumHorizontal = previous.x;
            Assert.That(previous.magnitude, Is.GreaterThan(0f));

            for (var frame = 1; frame <= 3600; frame += 1)
            {
                var current = AvatarAmbientWind.Sample(frame / 60f);
                Assert.That(current.magnitude, Is.LessThanOrEqualTo(AvatarAmbientWind.MaximumForce + 0.0001f));
                Assert.That(Vector3.Distance(previous, current), Is.LessThan(0.01f));
                if (Vector3.Distance(previous, current) > 0.00001f) changed = true;
                maximumObserved = Mathf.Max(maximumObserved, current.magnitude);
                minimumHorizontal = Mathf.Min(minimumHorizontal, current.x);
                maximumHorizontal = Mathf.Max(maximumHorizontal, current.x);
                previous = current;
            }

            Assert.That(changed, Is.True);
            Assert.That(maximumObserved, Is.GreaterThan(0.002f));
            Assert.That(minimumHorizontal, Is.LessThan(0f));
            Assert.That(maximumHorizontal, Is.GreaterThan(0f));
        }

        [Test]
        public void ResetRestoresDefaultBehavior()
        {
            var model = CreateModel();
            model.SetAffect(AvatarAffectPreset.Angry, 1f);
            model.ApplySettings(model.Settings.WithPointerGazeTracking(true));
            model.SetManualVisemes(1f, 0f, 0f, 0f, 0f);
            model.Reset();

            Assert.That(model.Affect, Is.EqualTo(AvatarAffectPreset.Neutral));
            Assert.That(model.PointerGazeTrackingEnabled, Is.False);
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

        private static Vector2 CombinedGaze(AvatarPoseFrame frame)
        {
            return new Vector2(
                frame.GazeYaw
                    + frame.ProceduralGazeCompensation.x
                    - frame.SpineEuler.y
                    - frame.ChestEuler.y
                    - frame.UpperChestEuler.y
                    - frame.NeckEuler.y
                    - frame.HeadEuler.y,
                frame.GazePitch
                    + frame.ProceduralGazeCompensation.y
                    - frame.SpineEuler.x
                    - frame.ChestEuler.x
                    - frame.UpperChestEuler.x
                    - frame.NeckEuler.x
                    - frame.HeadEuler.x);
        }

        private sealed class MinimumAvatarRandom : IAvatarRandom
        {
            public float Range(float minimum, float maximum) => minimum;
            public int Range(int minimumInclusive, int maximumExclusive) => minimumInclusive;
        }

    }
}
