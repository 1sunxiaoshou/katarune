using NUnit.Framework;

namespace Katarune.Avatar.Tests
{
    public sealed class PerformanceSchedulerTests
    {
        [Test]
        public void IndependentChannelsRunInParallelAndReleaseIndependently()
        {
            var scheduler = new PerformanceScheduler();
            var body = Submit(scheduler, "body", PerformanceChannel.BodyBase);
            var gesture = Submit(scheduler, "gesture", PerformanceChannel.GestureUpperBody);
            var gaze = Submit(scheduler, "gaze", PerformanceChannel.AttentionGaze);

            Assert.That(scheduler.ActiveInstances, Has.Count.EqualTo(3));
            Assert.That(scheduler.ChannelOwners, Has.Count.EqualTo(3));

            Assert.That(scheduler.Complete(gesture.InstanceId), Is.EqualTo(PerformanceTransitionOutcome.Applied));
            Assert.That(scheduler.ActiveInstances, Is.EquivalentTo(new[] { body, gaze }));
            Assert.That(scheduler.ChannelOwners, Has.None.Matches<PerformanceChannelOwner>(
                owner => owner.Channel == PerformanceChannel.GestureUpperBody));
        }

        [Test]
        public void ExclusiveConflictCanQueueOrRejectAndQueuedStartsOnlyAfterRelease()
        {
            var scheduler = new PerformanceScheduler();
            var dance = Submit(scheduler, "dance-a", PerformanceChannel.BodyFullPerformance);
            var queued = scheduler.Submit(
                Intent("dance-b"),
                Definition("dance-b", PerformanceChannel.BodyFullPerformance),
                PerformanceRequestPolicy.Queue);
            var rejected = scheduler.Submit(
                Intent("dance-c"),
                Definition("dance-c", PerformanceChannel.BodyFullPerformance),
                PerformanceRequestPolicy.Reject);

            Assert.That(queued.Outcome, Is.EqualTo(PerformanceRequestOutcome.Queued));
            Assert.That(queued.Instance.State, Is.EqualTo(PerformanceInstanceState.Requested));
            Assert.That(rejected.Outcome, Is.EqualTo(PerformanceRequestOutcome.Rejected));
            Assert.That(rejected.Instance, Is.Null);

            Assert.That(
                scheduler.Apply(dance.InstanceId, PerformanceCommand.ExitAtSafePoint()),
                Is.EqualTo(PerformanceTransitionOutcome.Applied));
            Assert.That(queued.Instance.State, Is.EqualTo(PerformanceInstanceState.Requested));
            Assert.That(scheduler.Complete(dance.InstanceId), Is.EqualTo(PerformanceTransitionOutcome.Applied));
            Assert.That(queued.Instance.State, Is.EqualTo(PerformanceInstanceState.Running));
            Assert.That(scheduler.ChannelOwners, Has.Exactly(1).Matches<PerformanceChannelOwner>(
                owner => owner.InstanceId == queued.Instance.InstanceId));
        }

        [Test]
        public void ImmediateCancelReleasesOnceAndPromotesQueueOnce()
        {
            var scheduler = new PerformanceScheduler();
            var ended = 0;
            var started = 0;
            scheduler.Ended += _ => ended += 1;
            scheduler.Started += _ => started += 1;
            var first = Submit(scheduler, "first", PerformanceChannel.BodyFullPerformance);
            var second = scheduler.Submit(
                Intent("second"),
                Definition("second", PerformanceChannel.BodyFullPerformance));

            var firstRevision = scheduler.Revision;
            Assert.That(
                scheduler.Apply(first.InstanceId, PerformanceCommand.CancelImmediate()),
                Is.EqualTo(PerformanceTransitionOutcome.Applied));
            var terminalRevision = scheduler.Revision;
            Assert.That(second.Instance.State, Is.EqualTo(PerformanceInstanceState.Running));
            Assert.That(started, Is.EqualTo(2));
            Assert.That(ended, Is.EqualTo(1));
            Assert.That(terminalRevision, Is.GreaterThan(firstRevision));

            Assert.That(
                scheduler.Apply(first.InstanceId, PerformanceCommand.CancelImmediate()),
                Is.EqualTo(PerformanceTransitionOutcome.AlreadyTerminal));
            Assert.That(scheduler.Revision, Is.EqualTo(terminalRevision));
            Assert.That(started, Is.EqualTo(2));
            Assert.That(ended, Is.EqualTo(1));
        }

        [Test]
        public void SafeExitRetainsOwnershipUntilPlaybackCompletes()
        {
            var scheduler = new PerformanceScheduler();
            var dance = Submit(scheduler, "dance", PerformanceChannel.BodyFullPerformance);

            scheduler.Apply(dance.InstanceId, PerformanceCommand.ExitAtSafePoint());

            Assert.That(dance.State, Is.EqualTo(PerformanceInstanceState.Exiting));
            Assert.That(scheduler.ChannelOwners, Has.Count.EqualTo(1));
            Assert.That(scheduler.QueuedInstances, Is.Empty);
            Assert.That(scheduler.Complete(dance.InstanceId), Is.EqualTo(PerformanceTransitionOutcome.Applied));
            Assert.That(dance.EndReason, Is.EqualTo(PerformanceEndReason.ExitedAtSafePoint));
            Assert.That(scheduler.ChannelOwners, Is.Empty);
        }

        [Test]
        public void UnrelatedQueuedInstanceIsNotBlockedByEarlierConflict()
        {
            var scheduler = new PerformanceScheduler();
            Submit(scheduler, "dance-a", PerformanceChannel.BodyFullPerformance);
            var waiting = scheduler.Submit(
                Intent("dance-b"),
                Definition("dance-b", PerformanceChannel.BodyFullPerformance));
            var gaze = scheduler.Submit(
                Intent("gaze"),
                Definition("gaze", PerformanceChannel.AttentionGaze));

            Assert.That(waiting.Outcome, Is.EqualTo(PerformanceRequestOutcome.Queued));
            Assert.That(gaze.Outcome, Is.EqualTo(PerformanceRequestOutcome.Started));
        }

        private static PerformanceInstance Submit(
            PerformanceScheduler scheduler,
            string id,
            PerformanceChannel channel)
        {
            var result = scheduler.Submit(Intent(id), Definition(id, channel));
            Assert.That(result.Outcome, Is.EqualTo(PerformanceRequestOutcome.Started));
            return result.Instance;
        }

        private static BehaviorIntent Intent(string id) =>
            new BehaviorIntent($"intent-{id}", id, BehaviorIntentSource.Application);

        private static BehaviorDefinition Definition(string id, PerformanceChannel channel) =>
            new BehaviorDefinition(
                id,
                new[] { new PerformanceChannelClaim(channel, PerformanceChannelOccupancy.Exclusive) },
                PerformanceControlCapabilities.SafePointExit);
    }
}
