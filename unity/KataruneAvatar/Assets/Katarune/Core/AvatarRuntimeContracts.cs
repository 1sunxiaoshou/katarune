using System;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace Katarune.Avatar
{
    public enum AvatarRuntimeState
    {
        Empty,
        Loading,
        Ready,
        Error,
    }

    public enum AvatarLightingMode
    {
        LightDesktop,
        DarkDesktop,
    }

    public enum AvatarLoadOutcome
    {
        Loaded,
        Superseded,
        Cancelled,
        Failed,
    }

    public enum AvatarPresetAction
    {
        GreetWave,
        Explain,
        Celebrate,
        Cough,
    }

    public enum AvatarActionRequestOutcome
    {
        Started,
        NotReady,
        Unavailable,
    }

    [Flags]
    public enum AvatarActionCapabilities
    {
        None = 0,
        GreetWave = 1 << (int)AvatarPresetAction.GreetWave,
        Explain = 1 << (int)AvatarPresetAction.Explain,
        Celebrate = 1 << (int)AvatarPresetAction.Celebrate,
        Cough = 1 << (int)AvatarPresetAction.Cough,
        All = GreetWave | Explain | Celebrate | Cough,
    }

    [Flags]
    public enum AvatarAffectCapabilities
    {
        None = 0,
        Neutral = 1 << 0,
        Happy = 1 << 1,
        Relaxed = 1 << 2,
        Sad = 1 << 3,
        Angry = 1 << 4,
        Surprised = 1 << 5,
        All = Neutral | Happy | Relaxed | Sad | Angry | Surprised,
    }

    public readonly struct AvatarVisemeWeights : IEquatable<AvatarVisemeWeights>
    {
        public AvatarVisemeWeights(float aa, float ih, float ou, float ee, float oh)
        {
            Aa = aa;
            Ih = ih;
            Ou = ou;
            Ee = ee;
            Oh = oh;
        }

        public float Aa { get; }
        public float Ih { get; }
        public float Ou { get; }
        public float Ee { get; }
        public float Oh { get; }

        public bool Equals(AvatarVisemeWeights other)
        {
            return Aa.Equals(other.Aa)
                && Ih.Equals(other.Ih)
                && Ou.Equals(other.Ou)
                && Ee.Equals(other.Ee)
                && Oh.Equals(other.Oh);
        }

        public override bool Equals(object obj) => obj is AvatarVisemeWeights other && Equals(other);
        public override int GetHashCode() => HashCode.Combine(Aa, Ih, Ou, Ee, Oh);
    }

    public readonly struct AvatarBehaviorSettings : IEquatable<AvatarBehaviorSettings>
    {
        public AvatarBehaviorSettings(
            AvatarAffectPreset affect,
            float affectIntensity,
            bool breathingEnabled,
            bool blinkingEnabled,
            bool swayEnabled,
            float breathingIntensity,
            float swayIntensity,
            AvatarGazeMode gazeMode,
            Vector2 manualGaze)
        {
            Affect = affect;
            AffectIntensity = affectIntensity;
            BreathingEnabled = breathingEnabled;
            BlinkingEnabled = blinkingEnabled;
            SwayEnabled = swayEnabled;
            BreathingIntensity = breathingIntensity;
            SwayIntensity = swayIntensity;
            GazeMode = gazeMode;
            ManualGaze = manualGaze;
        }

        public static AvatarBehaviorSettings Default => new AvatarBehaviorSettings(
            AvatarAffectPreset.Neutral,
            0f,
            true,
            true,
            true,
            1f,
            1f,
            AvatarGazeMode.Auto,
            Vector2.zero);

        public AvatarAffectPreset Affect { get; }
        public float AffectIntensity { get; }
        public bool BreathingEnabled { get; }
        public bool BlinkingEnabled { get; }
        public bool SwayEnabled { get; }
        public float BreathingIntensity { get; }
        public float SwayIntensity { get; }
        public AvatarGazeMode GazeMode { get; }
        public Vector2 ManualGaze { get; }

        public AvatarBehaviorSettings WithAffect(AvatarAffectPreset value, float intensity) => new AvatarBehaviorSettings(
            value, intensity, BreathingEnabled, BlinkingEnabled, SwayEnabled,
            BreathingIntensity, SwayIntensity, GazeMode, ManualGaze);

        public AvatarBehaviorSettings WithMotion(
            bool breathingEnabled,
            bool blinkingEnabled,
            bool swayEnabled,
            float breathingIntensity,
            float swayIntensity) => new AvatarBehaviorSettings(
            Affect, AffectIntensity, breathingEnabled, blinkingEnabled, swayEnabled,
            breathingIntensity, swayIntensity, GazeMode, ManualGaze);

        public AvatarBehaviorSettings WithGaze(AvatarGazeMode mode, Vector2 manualGaze) => new AvatarBehaviorSettings(
            Affect, AffectIntensity, BreathingEnabled, BlinkingEnabled, SwayEnabled,
            BreathingIntensity, SwayIntensity, mode, manualGaze);

        public bool Equals(AvatarBehaviorSettings other)
        {
            return Affect == other.Affect
                && AffectIntensity.Equals(other.AffectIntensity)
                && BreathingEnabled == other.BreathingEnabled
                && BlinkingEnabled == other.BlinkingEnabled
                && SwayEnabled == other.SwayEnabled
                && BreathingIntensity.Equals(other.BreathingIntensity)
                && SwayIntensity.Equals(other.SwayIntensity)
                && GazeMode == other.GazeMode
                && ManualGaze.Equals(other.ManualGaze);
        }

        public override bool Equals(object obj) => obj is AvatarBehaviorSettings other && Equals(other);

        public override int GetHashCode()
        {
            var first = HashCode.Combine(
                Affect, AffectIntensity, BreathingEnabled, BlinkingEnabled,
                SwayEnabled, BreathingIntensity, SwayIntensity);
            return HashCode.Combine(first, GazeMode, ManualGaze);
        }
    }

    public readonly struct AvatarPresentationSettings : IEquatable<AvatarPresentationSettings>
    {
        public AvatarPresentationSettings(AvatarLightingMode lightingMode, bool softOutlineEnabled)
        {
            LightingMode = lightingMode;
            SoftOutlineEnabled = softOutlineEnabled;
        }

        public AvatarLightingMode LightingMode { get; }
        public bool SoftOutlineEnabled { get; }

        public AvatarPresentationSettings WithLightingMode(AvatarLightingMode value) =>
            new AvatarPresentationSettings(value, SoftOutlineEnabled);

        public AvatarPresentationSettings WithSoftOutline(bool value) =>
            new AvatarPresentationSettings(LightingMode, value);

        public bool Equals(AvatarPresentationSettings other) =>
            LightingMode == other.LightingMode && SoftOutlineEnabled == other.SoftOutlineEnabled;

        public override bool Equals(object obj) => obj is AvatarPresentationSettings other && Equals(other);
        public override int GetHashCode() => HashCode.Combine((int)LightingMode, SoftOutlineEnabled);
    }

    public readonly struct AvatarCapabilitySet : IEquatable<AvatarCapabilitySet>
    {
        public AvatarCapabilitySet(
            AvatarAffectCapabilities affects,
            AvatarActionCapabilities actions = AvatarActionCapabilities.None)
        {
            Affects = affects | AvatarAffectCapabilities.Neutral;
            Actions = actions;
        }

        public static AvatarCapabilitySet Empty => new AvatarCapabilitySet(AvatarAffectCapabilities.Neutral);
        public AvatarAffectCapabilities Affects { get; }
        public AvatarActionCapabilities Actions { get; }

        public bool SupportsAffect(AvatarAffectPreset preset)
        {
            var capability = (AvatarAffectCapabilities)(1 << (int)preset);
            return (Affects & capability) != 0;
        }

        public bool SupportsAction(AvatarPresetAction action)
        {
            var capability = (AvatarActionCapabilities)(1 << (int)action);
            return (Actions & capability) != 0;
        }

        public bool Equals(AvatarCapabilitySet other) => Affects == other.Affects && Actions == other.Actions;
        public override bool Equals(object obj) => obj is AvatarCapabilitySet other && Equals(other);
        public override int GetHashCode() => HashCode.Combine((int)Affects, (int)Actions);
    }

    public readonly struct AvatarActionRequestResult
    {
        public AvatarActionRequestResult(AvatarActionRequestOutcome outcome, string error = null)
        {
            Outcome = outcome;
            Error = error;
        }

        public AvatarActionRequestOutcome Outcome { get; }
        public string Error { get; }
    }

    public readonly struct AvatarMotionSnapshot : IEquatable<AvatarMotionSnapshot>
    {
        public AvatarMotionSnapshot(
            bool libraryAvailable,
            bool authoredBaseActive,
            AvatarPresetAction? currentAction,
            ulong actionSequence,
            long performanceRevision = 0,
            int activePerformanceCount = 0,
            int queuedPerformanceCount = 0,
            string performanceDiagnostics = null)
        {
            LibraryAvailable = libraryAvailable;
            AuthoredBaseActive = authoredBaseActive;
            CurrentAction = currentAction;
            ActionSequence = actionSequence;
            PerformanceRevision = performanceRevision;
            ActivePerformanceCount = activePerformanceCount;
            QueuedPerformanceCount = queuedPerformanceCount;
            PerformanceDiagnostics = performanceDiagnostics ?? string.Empty;
        }

        public bool LibraryAvailable { get; }
        public bool AuthoredBaseActive { get; }
        public AvatarPresetAction? CurrentAction { get; }
        public ulong ActionSequence { get; }
        public long PerformanceRevision { get; }
        public int ActivePerformanceCount { get; }
        public int QueuedPerformanceCount { get; }
        public string PerformanceDiagnostics { get; }

        public bool Equals(AvatarMotionSnapshot other) =>
            LibraryAvailable == other.LibraryAvailable
            && AuthoredBaseActive == other.AuthoredBaseActive
            && CurrentAction == other.CurrentAction
            && ActionSequence == other.ActionSequence
            && PerformanceRevision == other.PerformanceRevision
            && ActivePerformanceCount == other.ActivePerformanceCount
            && QueuedPerformanceCount == other.QueuedPerformanceCount
            && string.Equals(PerformanceDiagnostics, other.PerformanceDiagnostics, StringComparison.Ordinal);

        public override bool Equals(object obj) => obj is AvatarMotionSnapshot other && Equals(other);
        public override int GetHashCode()
        {
            var first = HashCode.Combine(
                LibraryAvailable,
                AuthoredBaseActive,
                CurrentAction,
                ActionSequence);
            return HashCode.Combine(
                first,
                PerformanceRevision,
                ActivePerformanceCount,
                QueuedPerformanceCount,
                PerformanceDiagnostics);
        }
    }

    public readonly struct AvatarModelInfo : IEquatable<AvatarModelInfo>
    {
        public AvatarModelInfo(string path, string name, float height)
        {
            Path = path;
            Name = name;
            Height = height;
        }

        public string Path { get; }
        public string Name { get; }
        public float Height { get; }

        public bool Equals(AvatarModelInfo other) =>
            string.Equals(Path, other.Path, StringComparison.Ordinal)
            && string.Equals(Name, other.Name, StringComparison.Ordinal)
            && Height.Equals(other.Height);

        public override bool Equals(object obj) => obj is AvatarModelInfo other && Equals(other);
        public override int GetHashCode() => HashCode.Combine(Path, Name, Height);
    }

    public sealed class AvatarRuntimeSnapshot
    {
        public AvatarRuntimeSnapshot(
            long revision,
            AvatarRuntimeState runtimeState,
            AvatarModelInfo? model,
            string lastError,
            AvatarBehaviorSettings behavior,
            AvatarPresentationSettings presentation,
            AvatarCapabilitySet capabilities,
            AvatarMotionSnapshot motion = default)
        {
            Revision = revision;
            RuntimeState = runtimeState;
            Model = model;
            LastError = lastError;
            Behavior = behavior;
            Presentation = presentation;
            Capabilities = capabilities;
            Motion = motion;
        }

        public long Revision { get; }
        public AvatarRuntimeState RuntimeState { get; }
        public AvatarModelInfo? Model { get; }
        public string LastError { get; }
        public AvatarBehaviorSettings Behavior { get; }
        public AvatarPresentationSettings Presentation { get; }
        public AvatarCapabilitySet Capabilities { get; }
        public AvatarMotionSnapshot Motion { get; }

        internal bool ContentEquals(AvatarRuntimeSnapshot other)
        {
            if (other == null) return false;
            return RuntimeState == other.RuntimeState
                && Nullable.Equals(Model, other.Model)
                && string.Equals(LastError, other.LastError, StringComparison.Ordinal)
                && Behavior.Equals(other.Behavior)
                && Presentation.Equals(other.Presentation)
                && Capabilities.Equals(other.Capabilities)
                && Motion.Equals(other.Motion);
        }
    }

    public readonly struct AvatarLoadResult
    {
        public AvatarLoadResult(AvatarLoadOutcome outcome, string error = null)
        {
            Outcome = outcome;
            Error = error;
        }

        public AvatarLoadOutcome Outcome { get; }
        public string Error { get; }
    }

    public interface IAvatarRuntimeFacade : IDisposable
    {
        AvatarRuntimeSnapshot Snapshot { get; }
        AvatarPoseFrame CurrentPose { get; }
        event Action<AvatarRuntimeSnapshot> Changed;

        Task<AvatarLoadResult> LoadAsync(string path, CancellationToken cancellationToken = default);
        void Unload();
        void ApplyBehavior(AvatarBehaviorSettings settings);
        void ApplyPresentation(AvatarPresentationSettings settings);
        void SetManualVisemes(AvatarVisemeWeights weights);
        void RequestBlink();
        void ResetBehavior();
        AvatarActionRequestResult RequestAction(AvatarPresetAction action);
        void CancelAction();
        BehaviorRequestResult RequestBehavior(
            BehaviorIntent intent,
            PerformanceRequestPolicy policy = PerformanceRequestPolicy.Queue);
        PerformanceTransitionOutcome ApplyPerformanceCommand(
            string instanceId,
            PerformanceCommand command);
    }

    public interface IAvatarMotionPoseSource
    {
        bool HasAuthoredBodyPose { get; }
        float ProceduralBodyWeight { get; }
        float ProceduralArmWeight { get; }
    }

    public interface IAvatarMotionInstance : IAvatarMotionPoseSource, IDisposable
    {
        AvatarActionCapabilities Actions { get; }
        AvatarPresetAction? CurrentAction { get; }
        ulong ActionSequence { get; }
        long PerformanceRevision { get; }
        int ActivePerformanceCount { get; }
        int QueuedPerformanceCount { get; }
        string PerformanceDiagnostics { get; }
        event Action Changed;

        AvatarActionRequestResult RequestAction(AvatarPresetAction action);
        void CancelAction();
        BehaviorRequestResult RequestBehavior(BehaviorIntent intent, PerformanceRequestPolicy policy);
        PerformanceTransitionOutcome ApplyPerformanceCommand(string instanceId, PerformanceCommand command);
        void CancelAllBehaviors();
        void Tick(float deltaTime);
    }

    public interface IAvatarVisualInstance : IDisposable
    {
        void ApplySoftOutline(bool enabled);
    }
}
