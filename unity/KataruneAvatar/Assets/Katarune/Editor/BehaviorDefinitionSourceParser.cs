using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using UnityEngine;

namespace Katarune.Avatar.Editor
{
    internal sealed class BehaviorDefinitionSource
    {
        public int SchemaVersion;
        public string BehaviorId;
        public int Version;
        public CharacterRigCapabilities RequiredCapabilities;
        public BehaviorChannelClaim[] ChannelClaims;
        public string ClipGuid;
        public BehaviorClipSegment Entry;
        public BehaviorClipSegment Loop;
        public BehaviorSyncPoint[] SyncPoints;
        public BehaviorClipSegment Exit;
        public string[] HotUpdateParameters;
        public BehaviorFallbackStrategy FallbackStrategy;
        public string FallbackBehaviorId;
        public BehaviorAssetLicense License;

        public void Configure(BehaviorDefinitionAsset asset, AnimationClip clip)
        {
            asset.Configure(
                SchemaVersion,
                BehaviorId,
                Version,
                RequiredCapabilities,
                ChannelClaims,
                clip,
                Entry,
                Loop,
                SyncPoints,
                Exit,
                HotUpdateParameters,
                FallbackStrategy,
                FallbackBehaviorId,
                License);
        }
    }

    internal static class BehaviorDefinitionSourceParser
    {
        private static readonly string[] RootFields =
        {
            "schemaVersion", "behaviorId", "version", "requiredCapabilities",
            "channelClaims", "clipGuid", "entry", "loop", "syncPoints", "exit",
            "hotUpdateParameters", "fallbackStrategy", "fallbackBehaviorId", "license",
        };

        public static BehaviorDefinitionSource Parse(string json)
        {
            JsonObject root;
            try
            {
                root = new MinimalJsonParser(json).ParseRootObject();
            }
            catch (BehaviorDefinitionImportException)
            {
                throw;
            }
            catch (Exception error)
            {
                throw InvalidJson(error.Message);
            }

            EnsureOnly(root, "$", RootFields);
            return new BehaviorDefinitionSource
            {
                SchemaVersion = RequireInteger(root, "schemaVersion", "$"),
                BehaviorId = RequireString(root, "behaviorId", "$"),
                Version = RequireInteger(root, "version", "$"),
                RequiredCapabilities = ReadCapabilities(
                    RequireArray(root, "requiredCapabilities", "$"),
                    "$.requiredCapabilities"),
                ChannelClaims = ReadClaims(
                    RequireArray(root, "channelClaims", "$"),
                    "$.channelClaims"),
                ClipGuid = RequireString(root, "clipGuid", "$"),
                Entry = ReadOptionalSegment(root, "entry", "$"),
                Loop = ReadOptionalSegment(root, "loop", "$"),
                SyncPoints = ReadSyncPoints(
                    RequireArray(root, "syncPoints", "$"),
                    "$.syncPoints"),
                Exit = ReadOptionalSegment(root, "exit", "$"),
                HotUpdateParameters = ReadStrings(
                    RequireArray(root, "hotUpdateParameters", "$"),
                    "$.hotUpdateParameters"),
                FallbackStrategy = ReadFallbackStrategy(
                    RequireString(root, "fallbackStrategy", "$"),
                    "$.fallbackStrategy"),
                FallbackBehaviorId = OptionalString(root, "fallbackBehaviorId", "$"),
                License = ReadLicense(RequireObject(root, "license", "$"), "$.license"),
            };
        }

        private static CharacterRigCapabilities ReadCapabilities(JsonArray values, string path)
        {
            var result = CharacterRigCapabilities.None;
            for (var index = 0; index < values.Count; index += 1)
            {
                var value = RequireString(values[index], $"{path}[{index}]");
                switch (value)
                {
                    case "HumanoidBody": result |= CharacterRigCapabilities.HumanoidBody; break;
                    case "FaceExpressions": result |= CharacterRigCapabilities.FaceExpressions; break;
                    case "Gaze": result |= CharacterRigCapabilities.Gaze; break;
                    case "Visemes": result |= CharacterRigCapabilities.Visemes; break;
                    default: throw InvalidField($"{path}[{index}]", value);
                }
            }
            return result;
        }

        private static BehaviorChannelClaim[] ReadClaims(JsonArray values, string path)
        {
            var result = new BehaviorChannelClaim[values.Count];
            for (var index = 0; index < values.Count; index += 1)
            {
                var itemPath = $"{path}[{index}]";
                var item = RequireObject(values[index], itemPath);
                EnsureOnly(item, itemPath, "channel", "occupancy");
                result[index] = new BehaviorChannelClaim(
                    ReadChannel(RequireString(item, "channel", itemPath), itemPath + ".channel"),
                    ReadOccupancy(RequireString(item, "occupancy", itemPath), itemPath + ".occupancy"));
            }
            return result;
        }

        private static BehaviorClipSegment ReadOptionalSegment(
            JsonObject root,
            string field,
            string path)
        {
            if (!root.TryGetValue(field, out var raw) || raw == null) return null;
            var segmentPath = path + "." + field;
            var segment = RequireObject(raw, segmentPath);
            EnsureOnly(segment, segmentPath, "startSeconds", "endSeconds");
            return new BehaviorClipSegment(
                RequireFloat(segment, "startSeconds", segmentPath),
                RequireFloat(segment, "endSeconds", segmentPath));
        }

        private static BehaviorSyncPoint[] ReadSyncPoints(JsonArray values, string path)
        {
            var result = new BehaviorSyncPoint[values.Count];
            for (var index = 0; index < values.Count; index += 1)
            {
                var itemPath = $"{path}[{index}]";
                var item = RequireObject(values[index], itemPath);
                EnsureOnly(item, itemPath, "name", "timeSeconds", "safeExit");
                result[index] = new BehaviorSyncPoint(
                    RequireString(item, "name", itemPath),
                    RequireFloat(item, "timeSeconds", itemPath),
                    RequireBoolean(item, "safeExit", itemPath));
            }
            return result;
        }

        private static string[] ReadStrings(JsonArray values, string path)
        {
            var result = new string[values.Count];
            for (var index = 0; index < values.Count; index += 1)
            {
                result[index] = RequireString(values[index], $"{path}[{index}]");
            }
            return result;
        }

        private static BehaviorAssetLicense ReadLicense(JsonObject value, string path)
        {
            EnsureOnly(
                value,
                path,
                "distribution", "sourceName", "sourceUri", "author", "licenseId",
                "licenseUri", "notes");
            return new BehaviorAssetLicense(
                ReadDistribution(RequireString(value, "distribution", path), path + ".distribution"),
                RequireString(value, "sourceName", path),
                OptionalString(value, "sourceUri", path),
                RequireString(value, "author", path),
                RequireString(value, "licenseId", path),
                OptionalString(value, "licenseUri", path),
                OptionalString(value, "notes", path));
        }

        private static PerformanceChannel ReadChannel(string value, string path)
        {
            switch (value)
            {
                case "BodyBase": return PerformanceChannel.BodyBase;
                case "BodyFullPerformance": return PerformanceChannel.BodyFullPerformance;
                case "GestureUpperBody": return PerformanceChannel.GestureUpperBody;
                case "FaceExpression": return PerformanceChannel.FaceExpression;
                case "AttentionGaze": return PerformanceChannel.AttentionGaze;
                case "SpeechViseme": return PerformanceChannel.SpeechViseme;
                default: throw InvalidField(path, value);
            }
        }

        private static PerformanceChannelOccupancy ReadOccupancy(string value, string path)
        {
            switch (value)
            {
                case "Exclusive": return PerformanceChannelOccupancy.Exclusive;
                case "Shared": return PerformanceChannelOccupancy.Shared;
                case "Additive": return PerformanceChannelOccupancy.Additive;
                default: throw InvalidField(path, value);
            }
        }

        private static BehaviorFallbackStrategy ReadFallbackStrategy(string value, string path)
        {
            switch (value)
            {
                case "None": return BehaviorFallbackStrategy.None;
                case "UseBehavior": return BehaviorFallbackStrategy.UseBehavior;
                default: throw InvalidField(path, value);
            }
        }

        private static BehaviorAssetDistribution ReadDistribution(string value, string path)
        {
            switch (value)
            {
                case "dev-only": return BehaviorAssetDistribution.DevOnly;
                case "prototype-distributable": return BehaviorAssetDistribution.PrototypeDistributable;
                case "commercial-candidate": return BehaviorAssetDistribution.CommercialCandidate;
                default: throw InvalidField(path, value);
            }
        }

        private static int RequireInteger(JsonObject value, string field, string path)
        {
            var number = RequireNumber(RequireValue(value, field, path), path + "." + field);
            if (number < int.MinValue || number > int.MaxValue || Math.Abs(number % 1d) > double.Epsilon)
            {
                throw InvalidField(path + "." + field, number.ToString(CultureInfo.InvariantCulture));
            }
            return (int)number;
        }

        private static float RequireFloat(JsonObject value, string field, string path) =>
            (float)RequireNumber(RequireValue(value, field, path), path + "." + field);

        private static bool RequireBoolean(JsonObject value, string field, string path)
        {
            var raw = RequireValue(value, field, path);
            if (raw is bool result) return result;
            throw InvalidField(path + "." + field, Describe(raw));
        }

        private static string RequireString(JsonObject value, string field, string path) =>
            RequireString(RequireValue(value, field, path), path + "." + field);

        private static string OptionalString(JsonObject value, string field, string path)
        {
            if (!value.TryGetValue(field, out var raw) || raw == null) return string.Empty;
            return RequireString(raw, path + "." + field);
        }

        private static JsonObject RequireObject(JsonObject value, string field, string path) =>
            RequireObject(RequireValue(value, field, path), path + "." + field);

        private static JsonArray RequireArray(JsonObject value, string field, string path)
        {
            var raw = RequireValue(value, field, path);
            if (raw is JsonArray result) return result;
            throw InvalidField(path + "." + field, Describe(raw));
        }

        private static object RequireValue(JsonObject value, string field, string path)
        {
            if (value.TryGetValue(field, out var result)) return result;
            throw new BehaviorDefinitionImportException(
                BehaviorDefinitionImportErrorCode.MissingField,
                $"Required field '{path}.{field}' is missing.");
        }

        private static JsonObject RequireObject(object value, string path)
        {
            if (value is JsonObject result) return result;
            throw InvalidField(path, Describe(value));
        }

        private static string RequireString(object value, string path)
        {
            if (value is string result) return result;
            throw InvalidField(path, Describe(value));
        }

        private static double RequireNumber(object value, string path)
        {
            if (value is double result && !double.IsNaN(result) && !double.IsInfinity(result)) return result;
            throw InvalidField(path, Describe(value));
        }

        private static void EnsureOnly(JsonObject value, string path, params string[] allowed)
        {
            var set = new HashSet<string>(allowed, StringComparer.Ordinal);
            foreach (var field in value.Keys)
            {
                if (set.Contains(field)) continue;
                throw new BehaviorDefinitionImportException(
                    BehaviorDefinitionImportErrorCode.UnknownField,
                    $"Unknown field '{path}.{field}'.");
            }
        }

        private static BehaviorDefinitionImportException InvalidJson(string message) =>
            new BehaviorDefinitionImportException(
                BehaviorDefinitionImportErrorCode.InvalidJson,
                "Behavior definition is not valid JSON: " + message);

        private static BehaviorDefinitionImportException InvalidField(string path, string value) =>
            new BehaviorDefinitionImportException(
                BehaviorDefinitionImportErrorCode.InvalidField,
                $"Field '{path}' has unsupported value '{value}'.");

        private static string Describe(object value) => value == null ? "null" : value.GetType().Name;

        private sealed class JsonObject : Dictionary<string, object>
        {
            public JsonObject() : base(StringComparer.Ordinal) { }
        }

        private sealed class JsonArray : List<object> { }

        private sealed class MinimalJsonParser
        {
            private readonly string _text;
            private int _position;

            public MinimalJsonParser(string text)
            {
                _text = text ?? throw InvalidJson("Input is null.");
            }

            public JsonObject ParseRootObject()
            {
                SkipWhitespace();
                var result = ParseObject();
                SkipWhitespace();
                if (_position != _text.Length) throw Error("Trailing content.");
                return result;
            }

            private object ParseValue()
            {
                SkipWhitespace();
                if (_position >= _text.Length) throw Error("Unexpected end of input.");
                switch (_text[_position])
                {
                    case '{': return ParseObject();
                    case '[': return ParseArray();
                    case '"': return ParseString();
                    case 't': ReadLiteral("true"); return true;
                    case 'f': ReadLiteral("false"); return false;
                    case 'n': ReadLiteral("null"); return null;
                    default: return ParseNumber();
                }
            }

            private JsonObject ParseObject()
            {
                Expect('{');
                var result = new JsonObject();
                SkipWhitespace();
                if (TryRead('}')) return result;
                while (true)
                {
                    SkipWhitespace();
                    if (_position >= _text.Length || _text[_position] != '"')
                        throw Error("Object field name must be a string.");
                    var name = ParseString();
                    if (result.ContainsKey(name)) throw Error($"Duplicate field '{name}'.");
                    SkipWhitespace();
                    Expect(':');
                    result.Add(name, ParseValue());
                    SkipWhitespace();
                    if (TryRead('}')) return result;
                    Expect(',');
                }
            }

            private JsonArray ParseArray()
            {
                Expect('[');
                var result = new JsonArray();
                SkipWhitespace();
                if (TryRead(']')) return result;
                while (true)
                {
                    result.Add(ParseValue());
                    SkipWhitespace();
                    if (TryRead(']')) return result;
                    Expect(',');
                }
            }

            private string ParseString()
            {
                Expect('"');
                var result = new StringBuilder();
                while (_position < _text.Length)
                {
                    var character = _text[_position++];
                    if (character == '"') return result.ToString();
                    if (character < 0x20) throw Error("Control character in string.");
                    if (character != '\\')
                    {
                        result.Append(character);
                        continue;
                    }
                    if (_position >= _text.Length) throw Error("Unterminated escape sequence.");
                    var escape = _text[_position++];
                    switch (escape)
                    {
                        case '"': result.Append('"'); break;
                        case '\\': result.Append('\\'); break;
                        case '/': result.Append('/'); break;
                        case 'b': result.Append('\b'); break;
                        case 'f': result.Append('\f'); break;
                        case 'n': result.Append('\n'); break;
                        case 'r': result.Append('\r'); break;
                        case 't': result.Append('\t'); break;
                        case 'u': result.Append(ParseUnicodeEscape()); break;
                        default: throw Error($"Unsupported escape '\\{escape}'.");
                    }
                }
                throw Error("Unterminated string.");
            }

            private char ParseUnicodeEscape()
            {
                if (_position + 4 > _text.Length) throw Error("Incomplete unicode escape.");
                var hex = _text.Substring(_position, 4);
                _position += 4;
                if (!ushort.TryParse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var value))
                    throw Error($"Invalid unicode escape '{hex}'.");
                return (char)value;
            }

            private double ParseNumber()
            {
                var start = _position;
                if (TryRead('-')) { }
                ReadDigits(required: true);
                if (TryRead('.')) ReadDigits(required: true);
                if (_position < _text.Length && (_text[_position] == 'e' || _text[_position] == 'E'))
                {
                    _position += 1;
                    if (!TryRead('+')) TryRead('-');
                    ReadDigits(required: true);
                }
                var raw = _text.Substring(start, _position - start);
                if (!double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var value))
                    throw Error($"Invalid number '{raw}'.");
                return value;
            }

            private void ReadDigits(bool required)
            {
                var start = _position;
                while (_position < _text.Length && char.IsDigit(_text[_position])) _position += 1;
                if (required && start == _position) throw Error("Expected a digit.");
            }

            private void ReadLiteral(string literal)
            {
                if (_position + literal.Length > _text.Length
                    || !string.Equals(
                        _text.Substring(_position, literal.Length),
                        literal,
                        StringComparison.Ordinal))
                    throw Error($"Expected '{literal}'.");
                _position += literal.Length;
            }

            private void Expect(char value)
            {
                SkipWhitespace();
                if (!TryRead(value)) throw Error($"Expected '{value}'.");
            }

            private bool TryRead(char value)
            {
                if (_position >= _text.Length || _text[_position] != value) return false;
                _position += 1;
                return true;
            }

            private void SkipWhitespace()
            {
                while (_position < _text.Length && char.IsWhiteSpace(_text[_position])) _position += 1;
            }

            private BehaviorDefinitionImportException Error(string message) =>
                InvalidJson($"{message} (offset {_position}).");
        }
    }
}
