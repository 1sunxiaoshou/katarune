using NUnit.Framework;
using UnityEngine;

namespace Katarune.Avatar.Tests
{
    public sealed class HeadEyeGazeCoordinatorTests
    {
        [Test]
        public void FixationShiftMovesEyesBeforeHead()
        {
            var coordinator = CreateCoordinator();
            coordinator.SetFixationTarget(new Vector2(18f, 0f), 0.1f);

            var early = coordinator.Tick(0.03f);
            Assert.That(early.Eyes.x, Is.GreaterThan(0f));
            Assert.That(early.Head.x, Is.EqualTo(0f).Within(0.001f));

            var settled = coordinator.Tick(1f);
            Assert.That(settled.Head.x, Is.GreaterThan(4f));
            Assert.That(settled.Combined.x, Is.EqualTo(18f).Within(0.01f));
        }

        [Test]
        public void ContinuousTrackingUsesTheSameHeadEyeCompensation()
        {
            var coordinator = CreateCoordinator();
            coordinator.TrackTarget(new Vector2(18f, -10f));

            var early = coordinator.Tick(0.03f);
            Assert.That(early.Eyes.x, Is.GreaterThan(0f));
            Assert.That(early.Head, Is.EqualTo(Vector2.zero));

            coordinator.Tick(2f);
            var settled = coordinator.Tick(1f);
            Assert.That(settled.Head.x, Is.GreaterThan(4f));
            Assert.That(settled.Head.y, Is.LessThan(-2f));
            Assert.That(settled.Combined.x, Is.EqualTo(18f).Within(0.01f));
            Assert.That(settled.Combined.y, Is.EqualTo(-10f).Within(0.01f));
        }

        [Test]
        public void SmallTrackedTargetStaysWithinHeadDeadZone()
        {
            var coordinator = CreateCoordinator();
            coordinator.TrackTarget(new Vector2(2f, 1f));

            var pose = coordinator.Tick(2f);
            Assert.That(pose.Eyes.x, Is.EqualTo(2f).Within(0.01f));
            Assert.That(pose.Eyes.y, Is.EqualTo(1f).Within(0.01f));
            Assert.That(pose.Head, Is.EqualTo(Vector2.zero));
        }

        [Test]
        public void HeadMaximumsAllowExpressivePointerTracking()
        {
            var coordinator = CreateCoordinator();
            coordinator.TrackTarget(new Vector2(18f, -10f));

            coordinator.Tick(2f);
            var settled = coordinator.Tick(1f);

            Assert.That(settled.Head.x, Is.EqualTo(12f).Within(0.01f));
            Assert.That(settled.Head.y, Is.EqualTo(-6f).Within(0.01f));
            Assert.That(settled.Combined, Is.EqualTo(new Vector2(18f, -10f)));
        }

        [Test]
        public void LargePointerJumpRestartsEyeLeadWithoutRestartingEveryTrackingFrame()
        {
            var coordinator = CreateCoordinator();
            coordinator.TrackTarget(new Vector2(18f, 0f));
            coordinator.Tick(2f);

            coordinator.TrackTarget(new Vector2(-18f, 0f));
            var afterJump = coordinator.Tick(0.08f);

            Assert.That(afterJump.Head.x, Is.GreaterThan(4f));
            Assert.That(afterJump.Combined.x, Is.LessThan(0f));

            coordinator.TrackTarget(new Vector2(-17.5f, 0f));
            var following = coordinator.Tick(0.2f);
            Assert.That(following.Head.x, Is.LessThan(afterJump.Head.x));
        }

        [Test]
        public void NewFixationKeepsThePreviousHeadPoseDuringEyeLead()
        {
            var coordinator = CreateCoordinator();
            coordinator.SetFixationTarget(new Vector2(18f, 0f), 0.1f);
            var before = coordinator.Tick(2f);

            coordinator.SetFixationTarget(new Vector2(-18f, 0f), 0.1f);
            var early = coordinator.Tick(0.03f);

            Assert.That(early.Head.x, Is.GreaterThan(4f));
            Assert.That(early.Head.x, Is.EqualTo(before.Head.x).Within(0.001f));
            Assert.That(early.Combined.x, Is.LessThan(before.Combined.x));
        }

        private static HeadEyeGazeCoordinator CreateCoordinator()
        {
            return new HeadEyeGazeCoordinator(HeadEyeGazeProfile.Default);
        }
    }
}
