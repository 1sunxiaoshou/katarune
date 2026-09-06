using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using Object = UnityEngine.Object;

namespace Katarune.Avatar.Tests
{
    public sealed class AvatarRuntimeFacadeTests
    {
        private GameObject _root;
        private AvatarBehaviorController _behavior;
        private AvatarVisualController _visuals;
        private AvatarMotionController _motions;
        private AvatarSceneRig _sceneRig;
        private FakeAvatarLoader _loader;
        private AvatarRuntimeSession _session;
        private AvatarRuntimeFacade _facade;

        [SetUp]
        public void SetUp()
        {
            _root = new GameObject("Avatar Runtime Facade Test") { tag = "MainCamera" };
            _root.AddComponent<Camera>();
            _sceneRig = _root.AddComponent<AvatarSceneRig>();
            _sceneRig.Configure(true);
            _behavior = _root.AddComponent<AvatarBehaviorController>();
            _visuals = _root.AddComponent<AvatarVisualController>();
            _visuals.Configure();
            _motions = _root.AddComponent<AvatarMotionController>();
            _motions.Configure(null, loadFromResources: false);
            _behavior.SetMotionSource(_motions);
            _loader = new FakeAvatarLoader();
            _session = new AvatarRuntimeSession(
                _loader,
                _sceneRig,
                _behavior,
                _visuals,
                _motions,
                CancellationToken.None);
            _facade = new AvatarRuntimeFacade(
                _session,
                _behavior,
                _visuals,
                _sceneRig,
                _motions,
                new AvatarPresentationSettings(false));
        }

        [TearDown]
        public void TearDown()
        {
            _facade?.Dispose();
            if (_root != null) Object.DestroyImmediate(_root);
        }

        [Test]
        public void FacadeNormalizesSettingsAndPublishesOnlySemanticChanges()
        {
            var changes = 0;
            _facade.Changed += _ => changes += 1;
            var requested = new AvatarBehaviorSettings(
                AvatarAffectPreset.Happy,
                4f,
                false,
                true);

            _facade.ApplyBehavior(requested);
            var snapshot = _facade.Snapshot;

            Assert.That(snapshot.Revision, Is.EqualTo(1));
            Assert.That(changes, Is.EqualTo(1));
            Assert.That(snapshot.Behavior.AffectIntensity, Is.EqualTo(1f));
            Assert.That(snapshot.Behavior.BlinkingEnabled, Is.False);
            Assert.That(snapshot.Behavior.PointerGazeTrackingEnabled, Is.True);

            _facade.ApplyBehavior(snapshot.Behavior);
            Assert.That(_facade.Snapshot.Revision, Is.EqualTo(1));
            Assert.That(changes, Is.EqualTo(1));
        }

        [Test]
        public void PresentationChangesArePublishedAndIdempotent()
        {
            var changes = 0;
            _facade.Changed += _ => changes += 1;
            var requested = new AvatarPresentationSettings(true);

            _facade.ApplyPresentation(requested);

            Assert.That(_facade.Snapshot.Presentation, Is.EqualTo(requested));
            Assert.That(_facade.Snapshot.Revision, Is.EqualTo(1));
            Assert.That(changes, Is.EqualTo(1));

            _facade.ApplyPresentation(requested);
            Assert.That(_facade.Snapshot.Revision, Is.EqualTo(1));
            Assert.That(changes, Is.EqualTo(1));
        }

        [Test]
        public async Task SuccessfulReplacementDisposesPreviousModelOnce()
        {
            var first = new FakePreparedModel("first.vrm");
            var second = new FakePreparedModel("second.vrm");
            _loader.Enqueue(first);
            _loader.Enqueue(second);

            Assert.That((await _facade.LoadAsync("first.vrm")).Outcome, Is.EqualTo(AvatarLoadOutcome.Loaded));
            Assert.That((await _facade.LoadAsync("second.vrm")).Outcome, Is.EqualTo(AvatarLoadOutcome.Loaded));

            Assert.That(first.DisposeCount, Is.EqualTo(1));
            Assert.That(second.DisposeCount, Is.Zero);
            Assert.That(_facade.Snapshot.Model?.Path, Is.EqualTo("second.vrm"));
            Assert.That(_facade.Snapshot.RuntimeState, Is.EqualTo(AvatarRuntimeState.Ready));
        }

        [Test]
        public async Task FailedReloadKeepsPreviousModelAndReportsError()
        {
            var first = new FakePreparedModel("first.vrm");
            _loader.Enqueue(first);
            _loader.EnqueueFailure(new InvalidOperationException("prepare failed"));
            await _facade.LoadAsync("first.vrm");

            LogAssert.Expect(LogType.Exception, new Regex("InvalidOperationException: prepare failed"));
            var result = await _facade.LoadAsync("broken.vrm");

            Assert.That(result.Outcome, Is.EqualTo(AvatarLoadOutcome.Failed));
            Assert.That(_facade.Snapshot.RuntimeState, Is.EqualTo(AvatarRuntimeState.Ready));
            Assert.That(_facade.Snapshot.Model?.Path, Is.EqualTo("first.vrm"));
            Assert.That(_facade.Snapshot.LastError, Is.EqualTo("prepare failed"));
            Assert.That(first.DisposeCount, Is.Zero);
        }

        [Test]
        public async Task CommitFailureRollsBackToPreviousModel()
        {
            var first = new FakePreparedModel("first.vrm");
            var broken = new FakePreparedModel("broken.vrm") { ThrowWhenShown = true };
            _loader.Enqueue(first);
            _loader.Enqueue(broken);
            await _facade.LoadAsync("first.vrm");

            LogAssert.Expect(LogType.Exception, new Regex("InvalidOperationException: commit failed"));
            var result = await _facade.LoadAsync("broken.vrm");

            Assert.That(result.Outcome, Is.EqualTo(AvatarLoadOutcome.Failed));
            Assert.That(_facade.Snapshot.Model?.Path, Is.EqualTo("first.vrm"));
            Assert.That(first.DisposeCount, Is.Zero);
            Assert.That(broken.DisposeCount, Is.EqualTo(1));
            Assert.That(first.ShowCount, Is.EqualTo(1));
        }

        [Test]
        public async Task LatestLoadWinsAndLateCandidateIsDisposed()
        {
            var delayed = new TaskCompletionSource<AvatarLoadCandidate>(TaskCreationOptions.RunContinuationsAsynchronously);
            var late = new FakePreparedModel("late.vrm");
            var latest = new FakePreparedModel("latest.vrm");
            _loader.Enqueue(_ => delayed.Task);
            _loader.Enqueue(latest);

            var firstLoad = _facade.LoadAsync("late.vrm");
            var secondLoad = _facade.LoadAsync("latest.vrm");
            Assert.That((await secondLoad).Outcome, Is.EqualTo(AvatarLoadOutcome.Loaded));
            delayed.SetResult(new AvatarLoadCandidate(late));

            Assert.That((await firstLoad).Outcome, Is.EqualTo(AvatarLoadOutcome.Superseded));
            Assert.That(late.DisposeCount, Is.EqualTo(1));
            Assert.That(_facade.Snapshot.Model?.Path, Is.EqualTo("latest.vrm"));
        }

        [Test]
        public async Task UnloadInvalidatesPendingLoad()
        {
            var delayed = new TaskCompletionSource<AvatarLoadCandidate>(TaskCreationOptions.RunContinuationsAsynchronously);
            var late = new FakePreparedModel("late.vrm");
            _loader.Enqueue(_ => delayed.Task);

            var load = _facade.LoadAsync("late.vrm");
            _facade.Unload();
            delayed.SetResult(new AvatarLoadCandidate(late));

            Assert.That((await load).Outcome, Is.EqualTo(AvatarLoadOutcome.Superseded));
            Assert.That(late.DisposeCount, Is.EqualTo(1));
            Assert.That(_facade.Snapshot.RuntimeState, Is.EqualTo(AvatarRuntimeState.Empty));
            Assert.That(_facade.Snapshot.Model, Is.Null);
        }

        [Test]
        public async Task LoadedCapabilitiesArePublished()
        {
            var model = new FakePreparedModel(
                "limited.vrm",
                new AvatarCapabilitySet(AvatarAffectCapabilities.Neutral | AvatarAffectCapabilities.Happy));
            _loader.Enqueue(model);

            await _facade.LoadAsync("limited.vrm");

            Assert.That(_facade.Snapshot.Capabilities.SupportsAffect(AvatarAffectPreset.Happy), Is.True);
            Assert.That(_facade.Snapshot.Capabilities.SupportsAffect(AvatarAffectPreset.Sad), Is.False);
        }

        [Test]
        public async Task PresetActionPublishesSemanticStartRestartAndCancel()
        {
            var motion = new FakeMotion();
            var model = new FakePreparedModel(
                "motion.vrm",
                new AvatarCapabilitySet(AvatarAffectCapabilities.All, AvatarActionCapabilities.All),
                motion);
            _loader.Enqueue(model);
            await _facade.LoadAsync("motion.vrm");
            var loadedRevision = _facade.Snapshot.Revision;

            Assert.That(_facade.RequestAction(AvatarPresetAction.GreetWave).Outcome,
                Is.EqualTo(AvatarActionRequestOutcome.Started));
            Assert.That(_facade.Snapshot.Motion.CurrentAction, Is.EqualTo(AvatarPresetAction.GreetWave));
            Assert.That(_facade.Snapshot.Motion.ActionSequence, Is.EqualTo(1UL));
            Assert.That(_facade.Snapshot.Revision, Is.EqualTo(loadedRevision + 1));

            _facade.RequestAction(AvatarPresetAction.GreetWave);
            Assert.That(_facade.Snapshot.Motion.ActionSequence, Is.EqualTo(2UL));

            _facade.CancelAction();
            Assert.That(_facade.Snapshot.Motion.CurrentAction, Is.Null);
            Assert.That(_facade.Snapshot.Revision, Is.EqualTo(loadedRevision + 3));
        }

        [Test]
        public async Task FailedReplacementPreservesCurrentMotionAndDisposesCandidateMotion()
        {
            var currentMotion = new FakeMotion();
            var candidateMotion = new FakeMotion();
            var capabilities = new AvatarCapabilitySet(
                AvatarAffectCapabilities.All,
                AvatarActionCapabilities.All);
            var current = new FakePreparedModel("current.vrm", capabilities, currentMotion);
            var broken = new FakePreparedModel("broken.vrm", capabilities, candidateMotion)
            {
                ThrowWhenShown = true,
            };
            _loader.Enqueue(current);
            _loader.Enqueue(broken);
            await _facade.LoadAsync("current.vrm");
            _facade.RequestAction(AvatarPresetAction.Explain);

            LogAssert.Expect(LogType.Exception, new Regex("InvalidOperationException: commit failed"));
            var result = await _facade.LoadAsync("broken.vrm");

            Assert.That(result.Outcome, Is.EqualTo(AvatarLoadOutcome.Failed));
            Assert.That(_facade.Snapshot.Motion.CurrentAction, Is.EqualTo(AvatarPresetAction.Explain));
            Assert.That(currentMotion.DisposeCount, Is.Zero);
            Assert.That(candidateMotion.DisposeCount, Is.EqualTo(1));
        }

        [Test]
        public void PresetActionBeforeModelIsNotReady()
        {
            var result = _facade.RequestAction(AvatarPresetAction.Explain);

            Assert.That(result.Outcome, Is.EqualTo(AvatarActionRequestOutcome.NotReady));
            Assert.That(_facade.Snapshot.Revision, Is.Zero);
        }

        [Test]
        public void BehaviorBeforeModelIsUnavailableWithoutSnapshotMutation()
        {
            var result = _facade.RequestBehavior(new BehaviorIntent(
                "intent-explain",
                "katarune.performance.explain",
                BehaviorIntentSource.User));

            Assert.That(result.Outcome, Is.EqualTo(BehaviorRequestOutcome.Unavailable));
            Assert.That(_facade.Snapshot.Revision, Is.Zero);
        }

        [Test]
        public async Task BehaviorRequestsAndCommandsPublishAuthoritativePerformanceSnapshot()
        {
            var motion = new FakeMotion();
            _loader.Enqueue(new FakePreparedModel("behavior.vrm", motion: motion));
            await _facade.LoadAsync("behavior.vrm");

            var request = _facade.RequestBehavior(new BehaviorIntent(
                "intent-explain",
                "katarune.performance.explain",
                BehaviorIntentSource.User));

            Assert.That(request.Outcome, Is.EqualTo(BehaviorRequestOutcome.Started));
            Assert.That(_facade.Snapshot.Motion.ActivePerformanceCount, Is.EqualTo(1));
            Assert.That(_facade.Snapshot.Motion.PerformanceDiagnostics, Does.Contain("state=Running"));

            Assert.That(
                _facade.ApplyPerformanceCommand(request.InstanceId, PerformanceCommand.CancelImmediate()),
                Is.EqualTo(PerformanceTransitionOutcome.Applied));
            Assert.That(_facade.Snapshot.Motion.ActivePerformanceCount, Is.Zero);
            Assert.That(_facade.Snapshot.Motion.PerformanceDiagnostics, Does.Contain("CancelledImmediate"));
        }

        [Test]
        public async Task PresentationChangedDuringLoadIsPreparedBeforeCandidateIsShown()
        {
            var delayed = new TaskCompletionSource<AvatarLoadCandidate>(TaskCreationOptions.RunContinuationsAsynchronously);
            var model = new FakePreparedModel("delayed.vrm");
            _loader.Enqueue(_ => delayed.Task);

            var load = _facade.LoadAsync("delayed.vrm");
            _facade.ApplyPresentation(new AvatarPresentationSettings(true));
            delayed.SetResult(new AvatarLoadCandidate(model));

            Assert.That((await load).Outcome, Is.EqualTo(AvatarLoadOutcome.Loaded));
            Assert.That(model.FakeVisual.LastSoftOutlineEnabled, Is.True);
            Assert.That(model.FakeVisual.WasAppliedAfterShow, Is.False);
        }

        private sealed class FakeAvatarLoader : IAvatarModelLoader
        {
            private readonly Queue<Func<CancellationToken, Task<AvatarLoadCandidate>>> _loads = new();

            public void Enqueue(FakePreparedModel model) =>
                Enqueue(_ => Task.FromResult(new AvatarLoadCandidate(model)));

            public void Enqueue(Func<CancellationToken, Task<AvatarLoadCandidate>> load) => _loads.Enqueue(load);

            public void EnqueueFailure(Exception error) =>
                Enqueue(_ => Task.FromException<AvatarLoadCandidate>(error));

            public Task<AvatarLoadCandidate> LoadAsync(
                string path,
                AvatarPresentationSettings presentation,
                CancellationToken cancellationToken) => _loads.Dequeue()(cancellationToken);
        }

        private sealed class FakePreparedModel : IAvatarPreparedModel
        {
            public FakePreparedModel(
                string path,
                AvatarCapabilitySet? capabilities = null,
                IAvatarMotionInstance motion = null)
            {
                Path = path;
                Name = path;
                RootObject = new GameObject($"Fake Avatar {path}");
                Bounds = new Bounds(Vector3.zero, new Vector3(1f, 1.7f, 1f));
                Capabilities = capabilities ?? new AvatarCapabilitySet(AvatarAffectCapabilities.All);
                Driver = new FakeDriver(Capabilities);
                FakeVisual = new FakeVisual(this);
                Visual = FakeVisual;
                Motion = motion;
            }

            private GameObject RootObject { get; }
            public Transform RootTransform => RootObject.transform;
            public IAvatarDriver Driver { get; }
            public IAvatarVisualInstance Visual { get; }
            public IAvatarMotionInstance Motion { get; }
            public FakeVisual FakeVisual { get; }
            public Bounds Bounds { get; }
            public string Path { get; }
            public string Name { get; }
            public AvatarCapabilitySet Capabilities { get; }
            public bool ThrowWhenShown { get; set; }
            public int ShowCount { get; private set; }
            public int DisposeCount { get; private set; }

            public void Show()
            {
                ShowCount += 1;
                if (ThrowWhenShown) throw new InvalidOperationException("commit failed");
            }

            public void Hide() { }

            public void Dispose()
            {
                DisposeCount += 1;
                Driver.Dispose();
                Visual.Dispose();
                Motion?.Dispose();
                if (RootObject != null) Object.DestroyImmediate(RootObject);
            }
        }

        private sealed class FakeMotion : IAvatarMotionInstance
        {
            public string CurrentActionId => CurrentAction.HasValue ? AvatarActionIds.FromPreset(CurrentAction.Value) : null;
            public AvatarActionRequestResult RequestAction(string id) => RequestAction(AvatarActionIds.ToPreset(id).Value);
            public AvatarActionCapabilities Actions => AvatarActionCapabilities.All;
            public bool HasAuthoredBodyPose => true;
            public float ProceduralBodyWeight => CurrentAction.HasValue ? 0f : 0.45f;
            public float ProceduralArmWeight => 0f;
            public AvatarPresetAction? CurrentAction { get; private set; }
            public ulong ActionSequence { get; private set; }
            public long PerformanceRevision { get; private set; }
            public int ActivePerformanceCount { get; private set; }
            public int QueuedPerformanceCount => 0;
            public string PerformanceDiagnostics { get; private set; } = string.Empty;
            public event Action Changed;
            public int DisposeCount { get; private set; }

            public AvatarActionRequestResult RequestAction(AvatarPresetAction action)
            {
                CurrentAction = action;
                ActionSequence += 1;
                Changed?.Invoke();
                return new AvatarActionRequestResult(AvatarActionRequestOutcome.Started);
            }

            public void CancelAction()
            {
                if (!CurrentAction.HasValue) return;
                CurrentAction = null;
                Changed?.Invoke();
            }

            public BehaviorRequestResult RequestBehavior(
                BehaviorIntent intent,
                PerformanceRequestPolicy policy)
            {
                PerformanceRevision += 1;
                ActivePerformanceCount = 1;
                PerformanceDiagnostics = "instance-fake behavior=katarune.performance.explain state=Running";
                Changed?.Invoke();
                return new BehaviorRequestResult(BehaviorRequestOutcome.Started, "instance-fake");
            }

            public PerformanceTransitionOutcome ApplyPerformanceCommand(
                string instanceId,
                PerformanceCommand command)
            {
                if (instanceId != "instance-fake") return PerformanceTransitionOutcome.Rejected;
                PerformanceRevision += 1;
                ActivePerformanceCount = 0;
                PerformanceDiagnostics = "instance-fake state=Cancelled end=CancelledImmediate";
                Changed?.Invoke();
                return PerformanceTransitionOutcome.Applied;
            }
            public void CancelAllBehaviors()
            {
                ActivePerformanceCount = 0;
            }

            public void Tick(float deltaTime) { }
            public void Dispose() => DisposeCount += 1;
        }

        private sealed class FakeDriver : IAvatarDriver
        {
            private readonly AvatarCapabilitySet _capabilities;

            public FakeDriver(AvatarCapabilitySet capabilities)
            {
                _capabilities = capabilities;
            }

            public bool SupportsAffect(AvatarAffectPreset preset) => _capabilities.SupportsAffect(preset);
            public void Apply(AvatarPoseFrame frame) { }
            public void ResetPose() { }
            public void Dispose() { }
        }

        private sealed class FakeVisual : IAvatarVisualInstance
        {
            private readonly FakePreparedModel _model;

            public FakeVisual(FakePreparedModel model)
            {
                _model = model;
            }

            public bool LastSoftOutlineEnabled { get; private set; }
            public bool WasAppliedAfterShow { get; private set; }

            public void ApplySoftOutline(bool enabled)
            {
                LastSoftOutlineEnabled = enabled;
                WasAppliedAfterShow |= _model.ShowCount > 0;
            }
            public void Dispose() { }
        }
    }
}
