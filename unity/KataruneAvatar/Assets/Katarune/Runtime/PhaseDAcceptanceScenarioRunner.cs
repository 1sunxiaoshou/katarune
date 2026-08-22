using System;
using UnityEngine;

namespace Katarune.Avatar
{
    public enum PhaseDAcceptanceScenario
    {
        SpeakingWithFullBodyExplain,
        DanceInterruption,
    }

    public sealed class PhaseDAcceptanceScenarioRunner : MonoBehaviour
    {
        [SerializeField] private PhaseDAcceptanceScenario _scenario;
        private IAvatarRuntimeFacade _runtime;
        private string _firstInstanceId;
        private string _secondInstanceId;
        private int _step;
        private float _stepElapsed;
        private string _status = "Waiting for an avatar. Load a repository-external VRM from the HUD or --vrm.";

        internal void Configure(PhaseDAcceptanceScenario scenario) => _scenario = scenario;

        private void Update()
        {
            _runtime ??= FindFirstObjectByType<AvatarBootstrap>()?.Runtime;
            if (_runtime == null || _runtime.Snapshot.RuntimeState != AvatarRuntimeState.Ready) return;
            _stepElapsed += Time.deltaTime;
            if (_scenario == PhaseDAcceptanceScenario.SpeakingWithFullBodyExplain)
                TickSpeakingWithFullBodyExplain();
            else
                TickDanceInterruption();
        }

        private void TickSpeakingWithFullBodyExplain()
        {
            if (_step == 0)
            {
                _runtime.ApplyBehavior(_runtime.Snapshot.Behavior
                    .WithActivity(AvatarActivityState.Speaking)
                    .WithGaze(AvatarGazeMode.Auto, Vector2.zero));
                _runtime.SetManualVisemes(new AvatarVisemeWeights(0.7f, 0.1f, 0f, 0.2f, 0f));
                var result = _runtime.RequestBehavior(new BehaviorIntent(
                    "acceptance-speaking-full-body-explain",
                    "katarune.performance.explain",
                    BehaviorIntentSource.Application));
                _firstInstanceId = result.InstanceId;
                _status = $"Full-body explain request: {result.Outcome} {result.Error}";
                _step = result.Outcome == BehaviorRequestOutcome.Started ? 1 : -1;
                _stepElapsed = 0f;
                return;
            }
            if (_step == 1
                && _runtime.Snapshot.Motion.PerformanceDiagnostics.Contains(
                    $"{_firstInstanceId} behavior=katarune.performance.explain state=Completed"))
            {
                _runtime.SetManualVisemes(default);
                _runtime.ApplyBehavior(_runtime.Snapshot.Behavior.WithActivity(AvatarActivityState.Idle));
                _status = "PASS: full-body explain completed; gaze and visemes remained independent.";
                _step = 2;
            }
        }

        private void TickDanceInterruption()
        {
            if (_step == 0)
            {
                var first = _runtime.RequestBehavior(new BehaviorIntent(
                    "acceptance-dance-safe-exit",
                    "katarune.performance.short-dance",
                    BehaviorIntentSource.Application));
                _firstInstanceId = first.InstanceId;
                var second = _runtime.RequestBehavior(new BehaviorIntent(
                    "acceptance-dance-queued",
                    "katarune.performance.short-dance",
                    BehaviorIntentSource.Application));
                _secondInstanceId = second.InstanceId;
                _status = $"Dance A: {first.Outcome}; dance B: {second.Outcome}.";
                _step = first.Outcome == BehaviorRequestOutcome.Started
                    && second.Outcome == BehaviorRequestOutcome.Queued ? 1 : -1;
                _stepElapsed = 0f;
                return;
            }
            if (_step == 1 && _stepElapsed >= 0.25f)
            {
                var outcome = _runtime.ApplyPerformanceCommand(
                    _firstInstanceId,
                    PerformanceCommand.ExitAtSafePoint());
                _status = $"Safe exit requested: {outcome}; queued dance must remain Requested.";
                _step = outcome == PerformanceTransitionOutcome.Applied ? 2 : -1;
                _stepElapsed = 0f;
                return;
            }
            if (_step == 2
                && _runtime.Snapshot.Motion.PerformanceDiagnostics.Contains(
                    $"{_secondInstanceId} behavior=katarune.performance.short-dance state=Running"))
            {
                _status = "Dance A released at exit.safe; queued dance B started after release.";
                _step = 3;
                _stepElapsed = 0f;
                return;
            }
            if (_step == 3 && _stepElapsed >= 0.25f)
            {
                var outcome = _runtime.ApplyPerformanceCommand(
                    _secondInstanceId,
                    PerformanceCommand.CancelImmediate());
                _status = outcome == PerformanceTransitionOutcome.Applied
                    ? "PASS: safe exit queued correctly and explicit stop cancelled immediately."
                    : $"Immediate cancel failed: {outcome}";
                _step = outcome == PerformanceTransitionOutcome.Applied ? 4 : -1;
            }
        }

        private void OnGUI()
        {
            GUILayout.BeginArea(new Rect(20f, 20f, 720f, 500f), GUI.skin.box);
            GUILayout.Label($"Katarune Phase D — {_scenario}");
            GUILayout.Label(_status);
            if (_runtime != null)
            {
                GUILayout.Space(8f);
                GUILayout.TextArea(_runtime.Snapshot.Motion.PerformanceDiagnostics, GUILayout.ExpandHeight(true));
            }
            GUILayout.EndArea();
        }
    }
}
