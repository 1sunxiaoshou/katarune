using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using UnityEngine;

namespace Katarune.Avatar
{
    public enum BehaviorFallbackStrategy
    {
        None,
        UseBehavior,
    }

    public enum BehaviorAssetDistribution
    {
        DevOnly,
        PrototypeDistributable,
        CommercialCandidate,
    }

    public enum BehaviorDefinitionValidationErrorCode
    {
        UnsupportedSchemaVersion,
        InvalidBehaviorId,
        InvalidVersion,
        MissingCapabilityRequirement,
        MissingChannelClaim,
        ChannelConflict,
        MissingClip,
        MissingAvatarMask,
        InvalidSegment,
        InvalidLoopIterations,
        InvalidSyncPoint,
        InvalidExitSyncPoint,
        InvalidFallback,
        InvalidLicenseMetadata,
        CapabilityMismatch,
    }

    [Serializable]
    public sealed class BehaviorChannelClaim
    {
        [SerializeField] private PerformanceChannel _channel;
        [SerializeField] private PerformanceChannelOccupancy _occupancy;

        internal BehaviorChannelClaim(
            PerformanceChannel channel,
            PerformanceChannelOccupancy occupancy)
        {
            _channel = channel;
            _occupancy = occupancy;
        }

        public PerformanceChannel Channel => _channel;
        public PerformanceChannelOccupancy Occupancy => _occupancy;
        internal PerformanceChannelClaim ToDomainClaim() =>
            new PerformanceChannelClaim(_channel, _occupancy);
    }

    [Serializable]
    public sealed class BehaviorClipSegment
    {
        [SerializeField] private float _startSeconds;
        [SerializeField] private float _endSeconds;

        internal BehaviorClipSegment(float startSeconds, float endSeconds)
        {
            _startSeconds = startSeconds;
            _endSeconds = endSeconds;
        }

        public float StartSeconds => _startSeconds;
        public float EndSeconds => _endSeconds;
    }

    [Serializable]
    public sealed class BehaviorSyncPoint
    {
        [SerializeField] private string _name;
        [SerializeField] private float _timeSeconds;
        [SerializeField] private bool _safeExit;

        internal BehaviorSyncPoint(string name, float timeSeconds, bool safeExit)
        {
            _name = name;
            _timeSeconds = timeSeconds;
            _safeExit = safeExit;
        }

        public string Name => _name;
        public float TimeSeconds => _timeSeconds;
        public bool SafeExit => _safeExit;
    }

    [Serializable]
    public sealed class BehaviorAssetLicense
    {
        [SerializeField] private BehaviorAssetDistribution _distribution;
        [SerializeField] private string _sourceName;
        [SerializeField] private string _sourceUri;
        [SerializeField] private string _author;
        [SerializeField] private string _licenseId;
        [SerializeField] private string _licenseUri;
        [SerializeField] private string _acquiredOn;
        [SerializeField] private string _originalFormat;
        [SerializeField] private bool _commercialUseAllowed;
        [SerializeField] private bool _modificationAllowed;
        [SerializeField] private bool _redistributionAllowed;
        [SerializeField] private string _repositoryPolicy;
        [SerializeField] private string _notes;

        internal BehaviorAssetLicense(
            BehaviorAssetDistribution distribution,
            string sourceName,
            string sourceUri,
            string author,
            string licenseId,
            string licenseUri,
            string acquiredOn,
            string originalFormat,
            bool commercialUseAllowed,
            bool modificationAllowed,
            bool redistributionAllowed,
            string repositoryPolicy,
            string notes)
        {
            _distribution = distribution;
            _sourceName = sourceName;
            _sourceUri = sourceUri;
            _author = author;
            _licenseId = licenseId;
            _licenseUri = licenseUri;
            _acquiredOn = acquiredOn;
            _originalFormat = originalFormat;
            _commercialUseAllowed = commercialUseAllowed;
            _modificationAllowed = modificationAllowed;
            _redistributionAllowed = redistributionAllowed;
            _repositoryPolicy = repositoryPolicy;
            _notes = notes;
        }

        public BehaviorAssetDistribution Distribution => _distribution;
        public string SourceName => _sourceName;
        public string SourceUri => _sourceUri;
        public string Author => _author;
        public string LicenseId => _licenseId;
        public string LicenseUri => _licenseUri;
        public string AcquiredOn => _acquiredOn;
        public string OriginalFormat => _originalFormat;
        public bool CommercialUseAllowed => _commercialUseAllowed;
        public bool ModificationAllowed => _modificationAllowed;
        public bool RedistributionAllowed => _redistributionAllowed;
        public string RepositoryPolicy => _repositoryPolicy;
        public string Notes => _notes;
    }

    public sealed class BehaviorDefinitionAsset : ScriptableObject
    {
        public const int CurrentSchemaVersion = 2;

        [SerializeField] private int _schemaVersion;
        [SerializeField] private string _behaviorId;
        [SerializeField] private int _version;
        [SerializeField] private CharacterRigCapabilities _requiredCapabilities;
        [SerializeField] private BehaviorChannelClaim[] _channelClaims =
            Array.Empty<BehaviorChannelClaim>();
        [SerializeField] private AnimationClip _clip;
        [SerializeField] private AvatarMask _avatarMask;
        [SerializeField] private bool _hasEntry;
        [SerializeField] private BehaviorClipSegment _entry;
        [SerializeField] private bool _hasLoop;
        [SerializeField] private BehaviorClipSegment _loop;
        [SerializeField] private int _loopIterations;
        [SerializeField] private BehaviorSyncPoint[] _syncPoints =
            Array.Empty<BehaviorSyncPoint>();
        [SerializeField] private string _exitSyncPoint;
        [SerializeField] private bool _hasExit;
        [SerializeField] private BehaviorClipSegment _exit;
        [SerializeField] private BehaviorFallbackStrategy _fallbackStrategy;
        [SerializeField] private string _fallbackBehaviorId;
        [SerializeField] private BehaviorAssetLicense _license;

        public int SchemaVersion => _schemaVersion;
        public string BehaviorId => _behaviorId;
        public int Version => _version;
        public CharacterRigCapabilities RequiredCapabilities => _requiredCapabilities;
        public IReadOnlyList<BehaviorChannelClaim> ChannelClaims =>
            Array.AsReadOnly(_channelClaims ?? Array.Empty<BehaviorChannelClaim>());
        public AnimationClip Clip => _clip;
        public AvatarMask AvatarMask => _avatarMask;
        public BehaviorClipSegment Entry => _hasEntry ? _entry : null;
        public BehaviorClipSegment Loop => _hasLoop ? _loop : null;
        public int LoopIterations => _loopIterations;
        public float NaturalDurationSeconds
        {
            get
            {
                if (Loop != null && _loopIterations == 0) return float.PositiveInfinity;
                var result = SegmentDuration(Entry) + SegmentDuration(Exit);
                if (Loop != null) result += SegmentDuration(Loop) * _loopIterations;
                if (Loop != null && TryGetExitSyncPoint(out var exitPoint))
                {
                    result += exitPoint.TimeSeconds - Loop.StartSeconds;
                }
                return result;
            }
        }
        public IReadOnlyList<BehaviorSyncPoint> SyncPoints =>
            Array.AsReadOnly(_syncPoints ?? Array.Empty<BehaviorSyncPoint>());
        public string ExitSyncPoint => _exitSyncPoint;
        public BehaviorClipSegment Exit => _hasExit ? _exit : null;
        public BehaviorFallbackStrategy FallbackStrategy => _fallbackStrategy;
        public string FallbackBehaviorId => _fallbackBehaviorId;
        public BehaviorAssetLicense License => _license;

        public BehaviorDefinition CreateDomainDefinition()
        {
            var validation = BehaviorDefinitionAssetValidator.Validate(
                this,
                CharacterRigCapabilities.All,
                validateCapabilities: false);
            validation.ThrowIfInvalid();
            var claims = new PerformanceChannelClaim[_channelClaims.Length];
            for (var index = 0; index < claims.Length; index += 1)
            {
                claims[index] = _channelClaims[index].ToDomainClaim();
            }

            var controls = PerformanceControlCapabilities.None;
            for (var index = 0; index < _syncPoints.Length; index += 1)
            {
                if (_syncPoints[index].SafeExit)
                {
                    controls |= PerformanceControlCapabilities.SafePointExit;
                    break;
                }
            }

            return new BehaviorDefinition(_behaviorId, claims, controls);
        }

        internal void Configure(
            int schemaVersion,
            string behaviorId,
            int version,
            CharacterRigCapabilities requiredCapabilities,
            BehaviorChannelClaim[] channelClaims,
            AnimationClip clip,
            AvatarMask avatarMask,
            BehaviorClipSegment entry,
            BehaviorClipSegment loop,
            int loopIterations,
            BehaviorSyncPoint[] syncPoints,
            string exitSyncPoint,
            BehaviorClipSegment exit,
            BehaviorFallbackStrategy fallbackStrategy,
            string fallbackBehaviorId,
            BehaviorAssetLicense license)
        {
            _schemaVersion = schemaVersion;
            _behaviorId = behaviorId;
            _version = version;
            _requiredCapabilities = requiredCapabilities;
            _channelClaims = channelClaims ?? Array.Empty<BehaviorChannelClaim>();
            _clip = clip;
            _avatarMask = avatarMask;
            _hasEntry = entry != null;
            _entry = entry;
            _hasLoop = loop != null;
            _loop = loop;
            _loopIterations = loopIterations;
            _syncPoints = syncPoints ?? Array.Empty<BehaviorSyncPoint>();
            _exitSyncPoint = exitSyncPoint;
            _hasExit = exit != null;
            _exit = exit;
            _fallbackStrategy = fallbackStrategy;
            _fallbackBehaviorId = fallbackBehaviorId;
            _license = license;
        }

        public bool TryGetExitSyncPoint(out BehaviorSyncPoint point)
        {
            for (var index = 0; index < _syncPoints.Length; index += 1)
            {
                var candidate = _syncPoints[index];
                if (candidate != null
                    && string.Equals(candidate.Name, _exitSyncPoint, StringComparison.Ordinal))
                {
                    point = candidate;
                    return true;
                }
            }
            point = null;
            return false;
        }

        private static float SegmentDuration(BehaviorClipSegment segment) =>
            segment == null ? 0f : segment.EndSeconds - segment.StartSeconds;
    }

    public readonly struct BehaviorDefinitionValidationError
    {
        public BehaviorDefinitionValidationError(
            BehaviorDefinitionValidationErrorCode code,
            string message)
        {
            Code = code;
            Message = message;
        }

        public BehaviorDefinitionValidationErrorCode Code { get; }
        public string Message { get; }
    }

    public sealed class BehaviorDefinitionValidationResult
    {
        private readonly ReadOnlyCollection<BehaviorDefinitionValidationError> _errors;

        internal BehaviorDefinitionValidationResult(
            IReadOnlyList<BehaviorDefinitionValidationError> errors)
        {
            var copy = new BehaviorDefinitionValidationError[errors.Count];
            for (var index = 0; index < errors.Count; index += 1) copy[index] = errors[index];
            _errors = Array.AsReadOnly(copy);
        }

        public bool IsValid => _errors.Count == 0;
        public IReadOnlyList<BehaviorDefinitionValidationError> Errors => _errors;

        public void ThrowIfInvalid()
        {
            if (IsValid) return;
            throw new InvalidOperationException(_errors[0].Message);
        }
    }

    public static class BehaviorDefinitionAssetValidator
    {
        private const float TimeTolerance = 0.001f;

        public static BehaviorDefinitionValidationResult Validate(
            BehaviorDefinitionAsset definition,
            CharacterRigCapabilities availableCapabilities,
            bool validateCapabilities = true)
        {
            if (definition == null) throw new ArgumentNullException(nameof(definition));
            var errors = new List<BehaviorDefinitionValidationError>();
            if (definition.SchemaVersion != BehaviorDefinitionAsset.CurrentSchemaVersion)
            {
                Add(errors, BehaviorDefinitionValidationErrorCode.UnsupportedSchemaVersion,
                    $"Behavior '{definition.BehaviorId}' uses unsupported schema version {definition.SchemaVersion}.");
            }
            if (!IsStableIdentifier(definition.BehaviorId))
            {
                Add(errors, BehaviorDefinitionValidationErrorCode.InvalidBehaviorId,
                    "Behavior ID must start with a lowercase letter or digit and contain only lowercase letters, digits, '.', '-' or '_'.");
            }
            if (definition.Version <= 0)
            {
                Add(errors, BehaviorDefinitionValidationErrorCode.InvalidVersion,
                    $"Behavior '{definition.BehaviorId}' must use a positive version.");
            }
            if (definition.RequiredCapabilities == CharacterRigCapabilities.None)
            {
                Add(errors, BehaviorDefinitionValidationErrorCode.MissingCapabilityRequirement,
                    $"Behavior '{definition.BehaviorId}' must declare at least one character capability.");
            }
            ValidateClaims(definition, errors);
            ValidateClip(definition, errors);
            ValidateLoopIterations(definition, errors);
            ValidateAvatarMask(definition, errors);
            ValidateSyncPoints(definition, errors);
            ValidateExitSyncPoint(definition, errors);
            ValidateFallback(definition, errors);
            ValidateLicense(definition, errors);

            if (validateCapabilities)
            {
                var missing = definition.RequiredCapabilities & ~availableCapabilities;
                if (missing != CharacterRigCapabilities.None)
                {
                    Add(errors, BehaviorDefinitionValidationErrorCode.CapabilityMismatch,
                        $"Behavior '{definition.BehaviorId}' requires unavailable character capabilities: {missing}.");
                }
            }

            return new BehaviorDefinitionValidationResult(errors);
        }

        private static void ValidateClaims(
            BehaviorDefinitionAsset definition,
            List<BehaviorDefinitionValidationError> errors)
        {
            if (definition.ChannelClaims.Count == 0)
            {
                Add(errors, BehaviorDefinitionValidationErrorCode.MissingChannelClaim,
                    $"Behavior '{definition.BehaviorId}' must claim at least one performance channel.");
                return;
            }

            var seen = new HashSet<PerformanceChannel>();
            for (var index = 0; index < definition.ChannelClaims.Count; index += 1)
            {
                var claim = definition.ChannelClaims[index];
                if (claim == null
                    || !Enum.IsDefined(typeof(PerformanceChannel), claim.Channel)
                    || !Enum.IsDefined(typeof(PerformanceChannelOccupancy), claim.Occupancy))
                {
                    Add(errors, BehaviorDefinitionValidationErrorCode.ChannelConflict,
                        $"Behavior '{definition.BehaviorId}' contains an invalid channel claim at index {index}.");
                    continue;
                }
                if (!seen.Add(claim.Channel))
                {
                    Add(errors, BehaviorDefinitionValidationErrorCode.ChannelConflict,
                        $"Behavior '{definition.BehaviorId}' claims channel '{claim.Channel}' more than once.");
                }
            }
        }

        private static void ValidateClip(
            BehaviorDefinitionAsset definition,
            List<BehaviorDefinitionValidationError> errors)
        {
            if (definition.Clip == null)
            {
                Add(errors, BehaviorDefinitionValidationErrorCode.MissingClip,
                    $"Behavior '{definition.BehaviorId}' does not resolve an AnimationClip.");
                return;
            }

            var hasSegment = false;
            hasSegment |= ValidateSegment("entry", definition.Entry, definition.Clip.length, errors);
            hasSegment |= ValidateSegment("loop", definition.Loop, definition.Clip.length, errors);
            hasSegment |= ValidateSegment("exit", definition.Exit, definition.Clip.length, errors);
            if (!hasSegment)
            {
                Add(errors, BehaviorDefinitionValidationErrorCode.InvalidSegment,
                    $"Behavior '{definition.BehaviorId}' must declare at least one clip segment.");
            }
        }

        private static void ValidateAvatarMask(
            BehaviorDefinitionAsset definition,
            List<BehaviorDefinitionValidationError> errors)
        {
            var claimsUpperBody = false;
            for (var index = 0; index < definition.ChannelClaims.Count; index += 1)
            {
                var claim = definition.ChannelClaims[index];
                if (claim != null && claim.Channel == PerformanceChannel.GestureUpperBody)
                {
                    claimsUpperBody = true;
                    break;
                }
            }

            if (claimsUpperBody && definition.AvatarMask == null)
            {
                Add(errors, BehaviorDefinitionValidationErrorCode.MissingAvatarMask,
                    $"Behavior '{definition.BehaviorId}' claims the upper-body gesture channel but has no Avatar Mask.");
            }
        }

        private static void ValidateLoopIterations(
            BehaviorDefinitionAsset definition,
            List<BehaviorDefinitionValidationError> errors)
        {
            if (definition.LoopIterations < 0
                || (definition.Loop == null && definition.LoopIterations != 0))
            {
                Add(errors, BehaviorDefinitionValidationErrorCode.InvalidLoopIterations,
                    $"Behavior '{definition.BehaviorId}' has invalid loop iteration count {definition.LoopIterations}.");
            }
        }

        private static bool ValidateSegment(
            string name,
            BehaviorClipSegment segment,
            float clipLength,
            List<BehaviorDefinitionValidationError> errors)
        {
            if (segment == null) return false;
            if (segment.StartSeconds < 0f
                || segment.EndSeconds <= segment.StartSeconds
                || segment.EndSeconds > clipLength + TimeTolerance)
            {
                Add(errors, BehaviorDefinitionValidationErrorCode.InvalidSegment,
                    $"Behavior {name} segment [{segment.StartSeconds:F3}, {segment.EndSeconds:F3}] is outside clip length {clipLength:F3}.");
            }
            return true;
        }

        private static void ValidateSyncPoints(
            BehaviorDefinitionAsset definition,
            List<BehaviorDefinitionValidationError> errors)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            for (var index = 0; index < definition.SyncPoints.Count; index += 1)
            {
                var point = definition.SyncPoints[index];
                if (point == null || !IsStableIdentifier(point.Name))
                {
                    Add(errors, BehaviorDefinitionValidationErrorCode.InvalidSyncPoint,
                        $"Behavior '{definition.BehaviorId}' has an invalid sync point name at index {index}.");
                    continue;
                }
                if (!seen.Add(point.Name))
                {
                    Add(errors, BehaviorDefinitionValidationErrorCode.InvalidSyncPoint,
                        $"Behavior '{definition.BehaviorId}' repeats sync point '{point.Name}'.");
                }
                if (definition.Clip != null
                    && (point.TimeSeconds < 0f
                        || point.TimeSeconds > definition.Clip.length + TimeTolerance))
                {
                    Add(errors, BehaviorDefinitionValidationErrorCode.InvalidSyncPoint,
                        $"Sync point '{point.Name}' at {point.TimeSeconds:F3}s is outside clip length {definition.Clip.length:F3}s.");
                }
                if (point.SafeExit && definition.Exit == null)
                {
                    Add(errors, BehaviorDefinitionValidationErrorCode.InvalidSyncPoint,
                        $"Safe-exit sync point '{point.Name}' requires an exit segment.");
                }
            }
        }

        private static void ValidateExitSyncPoint(
            BehaviorDefinitionAsset definition,
            List<BehaviorDefinitionValidationError> errors)
        {
            var hasSafePoint = false;
            for (var index = 0; index < definition.SyncPoints.Count; index += 1)
            {
                hasSafePoint |= definition.SyncPoints[index] != null
                    && definition.SyncPoints[index].SafeExit;
            }
            if (!hasSafePoint && string.IsNullOrEmpty(definition.ExitSyncPoint)) return;
            if (!definition.TryGetExitSyncPoint(out var point)
                || !point.SafeExit
                || definition.Exit == null
                || definition.Loop == null
                || point.TimeSeconds < definition.Loop.StartSeconds
                || point.TimeSeconds > definition.Loop.EndSeconds)
            {
                Add(errors, BehaviorDefinitionValidationErrorCode.InvalidExitSyncPoint,
                    $"Behavior '{definition.BehaviorId}' must map its exit segment to a safe sync point inside the loop.");
            }
        }

        private static void ValidateFallback(
            BehaviorDefinitionAsset definition,
            List<BehaviorDefinitionValidationError> errors)
        {
            if (!Enum.IsDefined(typeof(BehaviorFallbackStrategy), definition.FallbackStrategy)
                || (definition.FallbackStrategy == BehaviorFallbackStrategy.UseBehavior
                    && !IsStableIdentifier(definition.FallbackBehaviorId))
                || (definition.FallbackStrategy == BehaviorFallbackStrategy.None
                    && !string.IsNullOrEmpty(definition.FallbackBehaviorId)))
            {
                Add(errors, BehaviorDefinitionValidationErrorCode.InvalidFallback,
                    $"Behavior '{definition.BehaviorId}' has an inconsistent fallback strategy.");
            }
        }

        private static void ValidateLicense(
            BehaviorDefinitionAsset definition,
            List<BehaviorDefinitionValidationError> errors)
        {
            var license = definition.License;
            if (license == null
                || !Enum.IsDefined(typeof(BehaviorAssetDistribution), license.Distribution)
                || string.IsNullOrWhiteSpace(license.SourceName)
                || string.IsNullOrWhiteSpace(license.Author)
                || string.IsNullOrWhiteSpace(license.LicenseId)
                || string.IsNullOrWhiteSpace(license.AcquiredOn)
                || !DateTime.TryParseExact(
                    license.AcquiredOn,
                    "yyyy-MM-dd",
                    System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None,
                    out _)
                || string.IsNullOrWhiteSpace(license.OriginalFormat)
                || string.IsNullOrWhiteSpace(license.RepositoryPolicy)
                || (license.Distribution != BehaviorAssetDistribution.DevOnly
                    && string.IsNullOrWhiteSpace(license.LicenseUri)))
            {
                Add(errors, BehaviorDefinitionValidationErrorCode.InvalidLicenseMetadata,
                    $"Behavior '{definition.BehaviorId}' has incomplete license metadata for its distribution class.");
            }
        }

        private static bool IsStableIdentifier(string value)
        {
            if (string.IsNullOrEmpty(value)) return false;
            if (!IsLowerAlphaNumeric(value[0])) return false;
            for (var index = 1; index < value.Length; index += 1)
            {
                var character = value[index];
                if (!IsLowerAlphaNumeric(character)
                    && character != '.'
                    && character != '-'
                    && character != '_') return false;
            }
            return true;
        }

        private static bool IsLowerAlphaNumeric(char value) =>
            (value >= 'a' && value <= 'z') || (value >= '0' && value <= '9');

        private static void Add(
            List<BehaviorDefinitionValidationError> errors,
            BehaviorDefinitionValidationErrorCode code,
            string message) => errors.Add(new BehaviorDefinitionValidationError(code, message));
    }
}
