using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarPerformanceTests
    {
        private static AvatarPerformanceStep Step(string at, string action = null, string expression = null, int sentence = 0)
            => new() { at = at, sentence = sentence, action = action, expression = expression };
        private static AvatarPerformance Create(FakeRuntime runtime, params AvatarPerformanceStep[] steps)
        {
            var performance = new AvatarPerformance(Guid.NewGuid().ToString(), "tool", "run", new AvatarPerformanceRequest { steps = steps }, runtime, _ => { });
            performance.Armed = true; performance.Bind("dialogue"); return performance;
        }

        [Test] public void SequencesRealActionCompletionAndRunsIndependentChannelsDuringDialogue()
        {
            var runtime = new FakeRuntime();
            var p = Create(runtime, Step("start", "wave", "happy"),
                Step("after_action", "clap"), Step("sentence", "nod", "surprised", 2));
            p.Progress("other-dialogue", 2); Assert.That(runtime.Plays, Is.Empty);
            p.Progress("dialogue", 1); Assert.That(runtime.Plays, Is.EqualTo(new[] { "wave" }));
            p.Progress("dialogue", 2); Assert.That(runtime.Plays, Is.EqualTo(new[] { "wave", "nod" }));
            Assert.That(runtime.Behavior.Affect, Is.EqualTo(AvatarAffectPreset.Surprised));
            runtime.Motions.Tick(.31f); p.Tick(); Assert.That(runtime.Plays, Is.EqualTo(new[] { "wave", "nod", "clap" }));
            p.Progress("dialogue", 2, true); Assert.That(p.Terminal, Is.False);
            runtime.Motions.Tick(.31f); p.Tick(); Assert.That(p.Status.state, Is.EqualTo("completed"));
        }
        [Test] public void SameChannelQueuesAndMissingSentenceDoesNotLeakIntoAnotherDialogue()
        {
            var runtime = new FakeRuntime();
            var p = Create(runtime, Step("start", "wave"), Step("start", "clap"), Step("sentence", expression: "surprised", sentence: 4));
            p.Progress("dialogue", 1); Assert.That(runtime.Plays, Is.EqualTo(new[] { "wave" }));
            runtime.Motions.Tick(.31f); p.Tick(); Assert.That(runtime.Plays, Is.EqualTo(new[] { "wave", "clap" }));
            p.Progress("dialogue", 1, true); Assert.That(p.Status.cues[2].state, Is.EqualTo("skipped"));
            runtime.Motions.Tick(.31f); p.Tick(); p.Progress("next-dialogue", 4);
            Assert.That(p.Status.state, Is.EqualTo("completed")); Assert.That(runtime.Behavior.Affect, Is.Not.EqualTo(AvatarAffectPreset.Surprised));
        }
        [Test] public void CancelIsScopedAndSkipsSuccessorsOfCancelledActions()
        {
            var runtime = new FakeRuntime();
            var p = Create(runtime, Step("start", "wave"), Step("after_action", "clap"));
            runtime.RequestAction("nod"); var unrelated = runtime.GetActionInstanceId("nod");
            p.Progress("dialogue", 1); runtime.CancelAction("wave"); p.Tick();
            Assert.That(p.Status.cues[1].state, Is.EqualTo("skipped")); p.Control(true); p.Control(true);
            Assert.That(runtime.GetActionState(unrelated), Is.EqualTo(PerformanceInstanceState.Running));
            Assert.That(runtime.Plays, Does.Not.Contain("clap")); Assert.That(p.Status.state, Is.EqualTo("cancelled"));
        }
        [Test] public void DialogueEndAndFinishReleaseOwnedLoopsButKeepExistingPoses()
        {
            var runtime = new FakeRuntime();
            var p = Create(runtime, Step("start", "talk"));
            p.Progress("dialogue", 1); p.Progress("dialogue", 1, true);
            Assert.That(p.Terminal, Is.False); runtime.Motions.Tick(1.21f); p.Tick(); Assert.That(p.Terminal, Is.True);
            runtime.RequestAction("talk"); var existing = runtime.GetActionInstanceId("talk");
            var borrowed = Create(runtime, Step("start", "talk"));
            borrowed.Progress("dialogue", 1); borrowed.Control(true);
            Assert.That(runtime.GetActionState(existing), Is.EqualTo(PerformanceInstanceState.Running));
            runtime.CancelAction("talk");
            var finishing = Create(runtime, Step("start", "talk"), Step("sentence", "wave", sentence: 3));
            finishing.Progress("dialogue", 1); finishing.Control(false); runtime.Motions.Tick(1.21f); finishing.Tick();
            Assert.That(finishing.Status.state, Is.EqualTo("completed")); Assert.That(finishing.Status.cues[1].state, Is.EqualTo("skipped"));
        }
        [Test] public void SentenceAnchorsIgnoreSubtitleWidthAndWaitForReliableStreamingAlignment()
        {
            const string text = "价格 3.14。第二句！第三句。";
            Assert.That(AvatarDialogueAnchors.SentenceStarts(text), Is.EqualTo(new[] { 0, 8, 12 }));
            Assert.That(AvatarDialogueAnchors.SentenceStarts("真的吗？！嗯……好。"), Has.Length.EqualTo(3));
            var segments = new[] { new AvatarSpeechSegment { text = "价格 3.14。", startSeconds = 0, endSeconds = 2 },
                new AvatarSpeechSegment { text = "第二句！", startSeconds = 2, endSeconds = 4 } };
            Assert.That(AvatarDialogueAnchors.SentenceAt(text, 2.1f, segments, 6, true), Is.EqualTo(2));
            Assert.That(AvatarDialogueAnchors.SentenceAt(text, 5f, segments, 6, true), Is.EqualTo(2));
            Assert.That(AvatarDialogueAnchors.SentenceAt(text, 5f, null, 6, false), Is.EqualTo(3));
        }
        [Test] public void ShortDialoguePreservesEnterThenCompletesOneLoopBeforeExit()
        {
            var runtime = new FakeRuntime(talkEnter: .5f);
            var p = Create(runtime, Step("start", "talk"));
            p.Progress("dialogue", 1); p.Progress("dialogue", 1, true);
            Assert.That(runtime.Motions.Phase, Is.EqualTo(PackageActionPhase.Enter), "Speech ending must not cut the authored enter clip");
            runtime.Motions.Tick(.5f); p.Tick();
            Assert.That(runtime.Motions.Phase, Is.EqualTo(PackageActionPhase.Loop));
            runtime.Motions.Tick(.9f); p.Tick(); Assert.That(p.Terminal, Is.False);
            runtime.Motions.Tick(.11f); p.Tick(); Assert.That(runtime.Motions.Phase, Is.EqualTo(PackageActionPhase.Exit));
            runtime.Motions.Tick(.21f); p.Tick(); Assert.That(p.Status.state, Is.EqualTo("completed"));
        }
        [Test] public void JsonTransportPreservesOptionalActionsAndExpressions()
        {
            var request = UnityEngine.JsonUtility.FromJson<AvatarPerformanceRequest>("{\"steps\":[{\"at\":\"start\",\"action\":\"wave\"},{\"at\":\"sentence\",\"sentence\":2,\"expression\":\"happy\"}]}");
            var runtime = new FakeRuntime();
            var p = new AvatarPerformance(Guid.NewGuid().ToString(), "tool", "run", request, runtime, _ => { });
            p.Armed = true; p.Bind("dialogue"); p.Progress("dialogue", 2);
            Assert.That(runtime.Plays, Is.EqualTo(new[] { "wave" })); Assert.That(runtime.Behavior.AffectIntensity, Is.EqualTo(1f));
        }

        [TestCase("{\"steps\":[{\"at\":\"after_action\",\"expression\":\"happy\"}]}")]
        [TestCase("{\"steps\":[{\"at\":\"start\",\"action\":\"talk\"},{\"at\":\"after_action\",\"expression\":\"happy\"}]}")]
        [TestCase("{\"steps\":[{\"at\":\"sentence\",\"expression\":\"happy\"}]}")]
        [TestCase("{\"steps\":[{\"at\":\"start\",\"action\":\"missing\"}]}")]
        [TestCase("{\"steps\":[{\"at\":\"start\",\"expression\":\"missing\"}]}")]
        public void RejectsInvalidStepsAtPlayerBoundary(string json)
        {
            var runtime = new FakeRuntime();
            var request = UnityEngine.JsonUtility.FromJson<AvatarPerformanceRequest>(json);
            Assert.Throws<ArgumentException>(() => new AvatarPerformance(Guid.NewGuid().ToString(), "tool", "run", request, runtime, _ => { }));
            Assert.That(runtime.Plays, Is.Empty);
        }

        [Test] public void DependencyUsesNearestEarlierActionAcrossExpressionSteps()
        {
            var runtime = new FakeRuntime();
            var p = Create(runtime, Step("start", "wave"), Step("start", expression: "happy"), Step("after_action", "clap"));
            p.Progress("dialogue", 1);
            Assert.That(runtime.Plays, Is.EqualTo(new[] { "wave" }));
            runtime.Motions.Tick(.31f); p.Tick();
            Assert.That(runtime.Plays, Is.EqualTo(new[] { "wave", "clap" }));
        }

        private sealed class FakeRuntime : IAvatarRuntimeFacade, IAvatarActionControl
        {
            internal readonly PackageActionController Motions = new();
            internal readonly List<string> Plays = new();
            internal AvatarBehaviorSettings Behavior = AvatarBehaviorSettings.Default;
            public IReadOnlyList<AvatarActionInfo> AvailableActions { get; } = new[] {
                new AvatarActionInfo("wave", "问候", .3f, layer: "upperBody"), new AvatarActionInfo("clap", "鼓掌", .3f, layer: "upperBody"),
                new AvatarActionInfo("nod", "点头", .3f, layer: "head"), new AvatarActionInfo("talk", "交谈", kind: "loop", layer: "body") };
            internal FakeRuntime(float talkEnter = 0f)
            {
                Motions.Add(new PackageActionDefinition("wave", false, .3f, layer: PackageActionLayer.UpperBody));
                Motions.Add(new PackageActionDefinition("clap", false, .3f, layer: PackageActionLayer.UpperBody));
                Motions.Add(new PackageActionDefinition("nod", false, .3f, layer: PackageActionLayer.Head));
                Motions.Add(new PackageActionDefinition("talk", true, 1f, enter: talkEnter, exit: .2f));
            }
            public AvatarRuntimeSnapshot Snapshot => new(0, AvatarRuntimeState.Ready, null, null, Behavior, default, new AvatarCapabilitySet((AvatarAffectCapabilities)63));
            public AvatarPoseFrame CurrentPose => new();
            public event Action<AvatarRuntimeSnapshot> Changed { add { } remove { } }
            public void ApplyBehavior(AvatarBehaviorSettings settings) => Behavior = settings;
            public AvatarActionRequestResult RequestAction(string id) { Plays.Add(id); Motions.Request(id); return new(AvatarActionRequestOutcome.Started); }
            public string CurrentInstanceId => Motions.CurrentInstanceId;
            public bool FinishAction(string id, bool completeCycle = false) => Motions.Finish(id, completeCycle);
            public string GetActionInstanceId(string id) => Motions.InstanceFor(id);
            public PerformanceInstanceState? GetActionState(string id) => Motions.GetState(id);
            public bool CancelAction(string id) => Motions.CancelAction(id);
            public void CancelAction() => Motions.Cancel();
            public void ApplyPresentation(AvatarPresentationSettings settings) { }
            public void SetManualVisemes(AvatarVisemeWeights weights, bool immediate = false) { }
            public void RequestBlink() { }
            public Task<AvatarLoadResult> LoadAsync(string path, CancellationToken cancellationToken = default) => throw new NotSupportedException();
            public void Unload() { }
            public AvatarActionRequestResult RequestAction(AvatarPresetAction action) => throw new NotSupportedException();
            public BehaviorRequestResult RequestBehavior(BehaviorIntent intent, PerformanceRequestPolicy policy = PerformanceRequestPolicy.Queue) => throw new NotSupportedException();
            public PerformanceTransitionOutcome ApplyPerformanceCommand(string instanceId, PerformanceCommand command) => throw new NotSupportedException();
            public void Dispose() { }
        }
    }
}
