using System;
using NUnit.Framework;

namespace Katarune.Avatar.Tests
{
    public sealed class PackageActionControllerTests
    {
        private static PackageActionController Create()
        {
            var controller = new PackageActionController();
            controller.Add(new PackageActionDefinition("system.think", true, 2f, .5f, .4f));
            controller.Add(new PackageActionDefinition("system.talk", true, 1f));
            controller.Add(new PackageActionDefinition("gesture", false, .3f));
            return controller;
        }
        [Test] public void LoopHoldsAndRepeatedRequestKeepsItsInstanceAndTime()
        {
            var c = Create(); c.Request("system.think"); var id = c.CurrentInstanceId; var sequence = c.ActionSequence;
            c.Tick(.7f); Assert.That(c.Phase, Is.EqualTo(PackageActionPhase.Loop));
            c.Request("system.think"); Assert.That(c.CurrentInstanceId, Is.EqualTo(id)); Assert.That(c.ActionSequence, Is.EqualTo(sequence));
            Assert.That(c.Time, Is.EqualTo(.2f).Within(.00001)); c.Tick(10f);
            Assert.That(c.CurrentInstanceId, Is.EqualTo(id)); Assert.That(c.GetState(id), Is.EqualTo(PerformanceInstanceState.Running));
        }
        [Test] public void OneShotRestoresHeldInstanceThroughEnterThenLoop()
        {
            var c = Create(); c.Request("system.think"); c.Tick(.7f); var held = c.CurrentInstanceId;
            c.Request("gesture"); var shot = c.CurrentInstanceId;
            Assert.That(c.GetState(held), Is.EqualTo(PerformanceInstanceState.Paused)); Assert.That(c.ActiveCount, Is.EqualTo(2));
            c.Tick(.3f); Assert.That(c.GetState(shot), Is.EqualTo(PerformanceInstanceState.Completed));
            Assert.That(c.CurrentInstanceId, Is.EqualTo(held)); Assert.That(c.Phase, Is.EqualTo(PackageActionPhase.Enter));
            Assert.That(c.Time, Is.Zero); Assert.That(c.ActiveCount, Is.EqualTo(1));
            c.Tick(.5f); Assert.That(c.Phase, Is.EqualTo(PackageActionPhase.Loop)); Assert.That(c.Time, Is.Zero);
        }
        [Test] public void LoopSwitchCompletesOldExitBeforeNewEnterWithoutVisitingIdle()
        {
            var c = Create(); c.Add(new PackageActionDefinition("next", true, 1f, .3f, .2f));
            c.Request("system.think"); var old = c.CurrentInstanceId; c.Tick(.7f);
            c.Request("next"); var next = c.InstanceFor("next");
            Assert.That(c.CurrentActionId, Is.EqualTo("system.think")); Assert.That(c.Phase, Is.EqualTo(PackageActionPhase.Exit));
            Assert.That(c.GetState(old), Is.EqualTo(PerformanceInstanceState.Exiting)); Assert.That(c.GetState(next), Is.EqualTo(PerformanceInstanceState.Requested));
            c.Tick(.4f); Assert.That(c.GetState(old), Is.EqualTo(PerformanceInstanceState.Completed));
            Assert.That(c.CurrentInstanceId, Is.EqualTo(next)); Assert.That(c.Phase, Is.EqualTo(PackageActionPhase.Enter));
            c.Tick(.3f); Assert.That(c.ActiveCount, Is.EqualTo(1));
            Assert.That(c.Phase, Is.EqualTo(PackageActionPhase.Loop));
        }
        [Test] public void RapidSwitchKeepsOnlyLatestPendingPoseWithoutRestartingExit()
        {
            var c = Create(); c.Request("system.think"); c.Tick(.7f); c.Request("system.talk"); var next = c.InstanceFor("system.talk");
            c.Tick(.1f); c.Request("system.talk"); Assert.That(c.InstanceFor("system.talk"), Is.EqualTo(next));
            c.Request("system.think"); var returned = c.InstanceFor("system.think");
            Assert.That(c.GetState(next), Is.EqualTo(PerformanceInstanceState.Cancelled)); Assert.That(c.Time, Is.EqualTo(.1f));
            c.Tick(.31f); Assert.That(c.CurrentInstanceId, Is.EqualTo(returned)); Assert.That(c.Phase, Is.EqualTo(PackageActionPhase.Enter));
        }
        [Test] public void CancelOrFinishPendingPoseDoesNotInterruptOldExit()
        {
            var c = Create(); c.Request("system.think"); var old = c.CurrentInstanceId; c.Request("system.talk");
            var next = c.InstanceFor("system.talk"); Assert.That(c.Finish("system.talk"), Is.True);
            Assert.That(c.GetState(next), Is.EqualTo(PerformanceInstanceState.Cancelled)); Assert.That(c.GetState(old), Is.EqualTo(PerformanceInstanceState.Exiting));
            c.Tick(.4f); Assert.That(c.CurrentActionId, Is.Null);
            c.Request("system.think"); c.Request("system.talk"); next = c.InstanceFor("system.talk"); c.Cancel();
            Assert.That(c.GetState(next), Is.EqualTo(PerformanceInstanceState.Cancelled)); Assert.That(c.QueuedCount, Is.Zero); Assert.That(c.ActiveCount, Is.Zero);
        }
        [Test] public void SwitchingWhileGestureCoversLoopRestoresAndExitsThatLoop()
        {
            var c = Create(); c.Request("system.think"); var old = c.CurrentInstanceId; c.Request("gesture"); var shot = c.CurrentInstanceId;
            c.Request("system.talk"); Assert.That(c.CurrentInstanceId, Is.EqualTo(old)); Assert.That(c.GetState(shot), Is.EqualTo(PerformanceInstanceState.Cancelled));
            Assert.That(c.Phase, Is.EqualTo(PackageActionPhase.Exit)); c.Tick(.4f); Assert.That(c.CurrentActionId, Is.EqualTo("system.talk"));
        }
        [Test] public void NaturalFinishPlaysExitAndReleasesAllChannels()
        {
            var c = Create(); c.Request("system.think"); var id = c.CurrentInstanceId;
            Assert.That(c.Finish("system.talk"), Is.False); Assert.That(c.Finish("system.think"), Is.True);
            Assert.That(c.Finish("system.think"), Is.True); Assert.That(c.GetState(id), Is.EqualTo(PerformanceInstanceState.Exiting));
            c.Tick(.2f); Assert.That(c.Phase, Is.EqualTo(PackageActionPhase.Exit));
            c.Tick(.2f); Assert.That(c.CurrentActionId, Is.Null); Assert.That(c.ActiveCount, Is.Zero);
            Assert.That(c.GetState(id), Is.EqualTo(PerformanceInstanceState.Completed));
        }
        [Test] public void CancellationOfGestureAlsoClearsSavedPoseAndAcceptsNextRequest()
        {
            var c = Create(); c.Request("system.think"); var held = c.CurrentInstanceId;
            c.Request("gesture"); var shot = c.CurrentInstanceId; c.Cancel(); c.Cancel();
            Assert.That(c.CurrentActionId, Is.Null); Assert.That(c.ParentActionId, Is.Null); Assert.That(c.ActiveCount, Is.Zero);
            Assert.That(c.GetState(held), Is.EqualTo(PerformanceInstanceState.Cancelled)); Assert.That(c.GetState(shot), Is.EqualTo(PerformanceInstanceState.Cancelled));
            Assert.That(c.Request("system.talk"), Is.True);
        }
        [Test] public void RequestingSavedLoopResumesItAndCancelsOnlyTheGesture()
        {
            var c = Create(); c.Request("system.think"); c.Tick(.7f); var held = c.CurrentInstanceId;
            c.Request("gesture"); var shot = c.CurrentInstanceId; c.Request("system.think");
            Assert.That(c.CurrentInstanceId, Is.EqualTo(held)); Assert.That(c.GetState(shot), Is.EqualTo(PerformanceInstanceState.Cancelled));
            Assert.That(c.Phase, Is.EqualTo(PackageActionPhase.Enter)); Assert.That(c.Time, Is.Zero);
        }
        [Test] public void ForeignAndReplacedPackageInstancesCannotAffectCurrentPlayback()
        {
            var a = Create(); a.Request("system.think"); var b = Create(); b.Request("system.think");
            Assert.That(b.CurrentInstanceId, Is.Not.EqualTo(a.CurrentInstanceId)); Assert.That(b.GetState(a.CurrentInstanceId), Is.Null);
            Assert.That(b.Request("missing"), Is.False); Assert.That(b.CurrentActionId, Is.EqualTo("system.think"));
        }
        [Test] public void InvalidTimingIsRejectedAndLargeStepsCrossEnterIntoLoop()
        {
            var c = Create(); c.Request("system.think"); c.Tick(5.7f);
            Assert.That(c.Phase, Is.EqualTo(PackageActionPhase.Loop)); Assert.That(c.Time, Is.EqualTo(1.2f).Within(.00001));
            Assert.Throws<ArgumentOutOfRangeException>(() => c.Tick(float.NaN));
            Assert.Throws<ArgumentException>(() => new PackageActionDefinition("bad", true, 0f));
        }
        [Test] public void LoopWithoutEnterOrExitFinishesImmediately()
        {
            var c = Create(); c.Request("system.talk"); var id = c.CurrentInstanceId;
            Assert.That(c.Phase, Is.EqualTo(PackageActionPhase.Loop)); Assert.That(c.Finish("system.talk"), Is.True);
            Assert.That(c.GetState(id), Is.EqualTo(PerformanceInstanceState.Completed)); Assert.That(c.ActiveCount, Is.Zero);
        }
        [Test] public void HeadAndUpperBodyAdvanceAlongsideTheSameBodyLoop()
        {
            var c = Create(); c.Add(new PackageActionDefinition("nod", false, .8f, layer: PackageActionLayer.Head));
            c.Add(new PackageActionDefinition("wave", false, 1f, layer: PackageActionLayer.UpperBody));
            c.Request("system.talk"); c.Tick(.1f); var body = c.CurrentInstanceId;
            c.Request("nod"); var head = c.InstanceFor("nod"); c.Request("wave"); var upper = c.InstanceFor("wave");
            c.Tick(.5f); Assert.That(c.CurrentInstanceId, Is.EqualTo(body)); Assert.That(c.Time, Is.EqualTo(.6f).Within(.00001));
            Assert.That(c.Lane(PackageActionLayer.Head).Time, Is.EqualTo(.5f)); Assert.That(c.ActiveCount, Is.EqualTo(3));
            c.Tick(.3f); Assert.That(c.GetState(head), Is.EqualTo(PerformanceInstanceState.Completed)); Assert.That(c.GetState(upper), Is.EqualTo(PerformanceInstanceState.Running));
            c.Tick(.2f); Assert.That(c.GetState(upper), Is.EqualTo(PerformanceInstanceState.Completed)); Assert.That(c.GetState(body), Is.EqualTo(PerformanceInstanceState.Running));
        }
        [Test] public void UpperGestureRestoresSavedUpperLoopAndTargetedCancelLeavesOtherLanesRunning()
        {
            var c = Create(); c.Add(new PackageActionDefinition("arms", true, 2f, .1f, layer: PackageActionLayer.UpperBody));
            c.Add(new PackageActionDefinition("wave", false, .4f, layer: PackageActionLayer.UpperBody));
            c.Add(new PackageActionDefinition("head", true, 1f, layer: PackageActionLayer.Head));
            c.Request("system.talk"); c.Request("arms"); c.Request("head"); c.Tick(.2f); var arms = c.InstanceFor("arms");
            c.Request("wave"); Assert.That(c.GetState(arms), Is.EqualTo(PerformanceInstanceState.Paused));
            c.Tick(.4f); Assert.That(c.InstanceFor("arms"), Is.EqualTo(arms)); Assert.That(c.Lane(PackageActionLayer.UpperBody).Phase, Is.EqualTo(PackageActionPhase.Enter));
            Assert.That(c.Lane(PackageActionLayer.UpperBody).Time, Is.Zero);
            Assert.That(c.Time, Is.EqualTo(.6f).Within(.00001), "The independent body loop must continue.");
            Assert.That(c.CancelAction("head"), Is.True); Assert.That(c.CancelAction("head"), Is.False); Assert.That(c.ActiveCount, Is.EqualTo(2));
            Assert.That(c.CurrentActionId, Is.EqualTo("system.talk")); Assert.That(c.CancelAction("arms"), Is.True); Assert.That(c.ActiveCount, Is.EqualTo(1));
        }
        [Test] public void CancellingUpperOneShotResumesOnlyItsSavedPose()
        {
            var c = Create(); c.Add(new PackageActionDefinition("arms", true, 2f, layer: PackageActionLayer.UpperBody));
            c.Add(new PackageActionDefinition("wave", false, .4f, layer: PackageActionLayer.UpperBody));
            c.Request("system.talk"); c.Request("arms"); var saved = c.InstanceFor("arms"); c.Request("wave"); var shot = c.InstanceFor("wave");
            Assert.That(c.CancelAction("wave"), Is.True); Assert.That(c.GetState(shot), Is.EqualTo(PerformanceInstanceState.Cancelled));
            Assert.That(c.InstanceFor("arms"), Is.EqualTo(saved)); Assert.That(c.GetState(saved), Is.EqualTo(PerformanceInstanceState.Running));
            Assert.That(c.Lane(PackageActionLayer.UpperBody).Time, Is.Zero, "Without an enter clip, restart the loop at zero.");
            c.Cancel(); Assert.That(c.ActiveCount, Is.Zero);
        }
        [Test] public void IndependentHeadGestureDoesNotReenterBodyPose()
        {
            var c = Create(); c.Add(new PackageActionDefinition("nod", false, .3f, layer: PackageActionLayer.Head));
            c.Request("system.think"); c.Tick(.7f); var body = c.CurrentInstanceId;
            c.Request("nod"); c.Tick(.3f);
            Assert.That(c.CurrentInstanceId, Is.EqualTo(body)); Assert.That(c.Phase, Is.EqualTo(PackageActionPhase.Loop));
            Assert.That(c.Time, Is.EqualTo(.5f).Within(.00001));
        }
    }
}
