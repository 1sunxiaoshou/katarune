using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UniGLTF.SpringBoneJobs.Blittables;
using UniVRM10;
using UnityEngine;

namespace Katarune.Avatar
{
    // Native counterpart of the independent adapter: geometry/skin measurements,
    // periodic local bending, coupled amplitude calibration and proxy collision limits.
    public static class AdaptiveIdleBaker
    {
        public const float Period = 2f;
        public const int Frames = 121;
        private const int SamplesPerChain = 192;
        [Serializable] public sealed class Channel { public string path; public float[] rotations; }
        [Serializable] public sealed class ChainResult { public string name, role; public float target, actual, penetration; public bool limited; }
        [Serializable] public sealed class BakedLoop { public int version = 2; public string fingerprint; public float period = Period; public Channel[] channels; public ChainResult[] chains; }
        [Serializable] private sealed class Harmonic { public int harmonic; public float cos, sin; }
        [Serializable] private sealed class Style { public Harmonic[] hair, cloth, accessory; }
        private sealed class Vertex
        {
            public Transform[] bones; public Vector3[] local; public float[] weights;
            public Vector3 Evaluate() { var v = Vector3.zero; for (var i = 0; i < bones.Length; i++) v += bones[i].TransformPoint(local[i]) * weights[i]; return v; }
        }
        private sealed class Proxy { public Vector3 a, b; public float radius; }
        private sealed class Chain
        {
            public string name, role; public Transform[] joints; public Quaternion[] rest; public Vector3[] axes, sideAxes;
            public float[] weights, radii, baseline, tipBaseline; public Vertex[] vertices; public Vector3[] restPoints;
            public Proxy[] colliders; public float target, phase, angle = .03f, actual, penetration;
        }
        public static string BonePath(Transform root, Transform bone)
        {
            var parts = new List<string>();
            while (bone != root && bone != null) { parts.Add(bone.name); bone = bone.parent; }
            if (bone == null) throw new ArgumentException("Joint outside model.");
            parts.Reverse(); return string.Join("/", parts);
        }
        private static string Hash(byte[] b) { using var sha = SHA256.Create(); return BitConverter.ToString(sha.ComputeHash(b)).Replace("-", "").ToLowerInvariant(); }
        public static bool IsValid(BakedLoop clip, HashSet<string> allowed)
        {
            if (clip == null || clip.version != 2 || clip.period != Period || clip.channels == null || clip.channels.Length > 2048) return false;
            var paths = new HashSet<string>();
            foreach (var channel in clip.channels)
            {
                if (channel == null || !allowed.Contains(channel.path ?? "") || !paths.Add(channel.path) || channel.rotations?.Length != Frames * 4) return false;
                for (var i = 0; i < Frames; i++)
                {
                    var q = Read(channel.rotations, i);
                    if (!float.IsFinite(q.x) || !float.IsFinite(q.y) || !float.IsFinite(q.z) || !float.IsFinite(q.w) || Mathf.Abs(Quaternion.Dot(q, q) - 1) > .005f) return false;
                }
                if (Quaternion.Angle(Read(channel.rotations, 0), Read(channel.rotations, Frames - 1)) > .01f) return false;
            }
            return true;
        }
        public static Quaternion Read(float[] values, int frame) => new(values[frame * 4], values[frame * 4 + 1], values[frame * 4 + 2], values[frame * 4 + 3]);
        public static async Task<BakedLoop> PrepareAsync(Vrm10Instance model, byte[] modelBytes, CancellationToken token, bool useCache = true, bool yieldDuringBake = true)
        {
            token.ThrowIfCancellationRequested();
            var styleText = Resources.Load<TextAsset>("AdaptiveIdleStyle")?.text ?? throw new InvalidOperationException("Missing idle style.");
            var key = Hash(modelBytes) + "-" + Hash(Encoding.UTF8.GetBytes(FixedIdlePose.Default.SourceJson + styleText));
            var directory = Path.Combine(Application.persistentDataPath, "adaptive-idle");
            var cache = Path.Combine(directory, "v2-" + key + ".json");
            var constrained = model.Runtime.Constraints.Select(c => c.ConstraintTarget).ToHashSet();
            var allowed = model.SpringBone.Springs.SelectMany(s => s.Joints).Where(j => j != null && !constrained.Contains(j.transform))
                .Select(j => BonePath(model.transform, j.transform)).ToHashSet();
            if (useCache)
            {
                var builtin = Resources.Load<TextAsset>("AdaptiveIdleDefault");
                if (builtin != null)
                {
                    var saved = JsonUtility.FromJson<BakedLoop>(builtin.text);
                    if (saved != null && saved.fingerprint == key && IsValid(saved, allowed)) { Debug.Log($"KATARUNE_ADAPTIVE_IDLE_PREBAKED channels={saved.channels.Length}"); return saved; }
                }
            }
            try
            {
                if (useCache && File.Exists(cache) && new FileInfo(cache).Length <= 12 * 1024 * 1024)
                {
                    var saved = JsonUtility.FromJson<BakedLoop>(File.ReadAllText(cache));
                    if (saved != null && saved.fingerprint == key && IsValid(saved, allowed)) { Debug.Log($"KATARUNE_ADAPTIVE_IDLE_CACHE channels={saved.channels.Length}"); return saved; }
                }
            }
            catch (Exception e) when (e is IOException || e is ArgumentException || e is UnauthorizedAccessException) { /* Rebuild invalid local cache. */ }
            token.ThrowIfCancellationRequested();
            model.Runtime.SpringBone.SetModelLevel(model.transform, new BlittableModelLevel(stopSpringBoneWriteback: true, supportsScalingAtRuntime: true));
            var restore = model.SpringBone.Springs.SelectMany(s => s.Joints).Where(j => j != null).Select(j => j.transform).Distinct().ToDictionary(t => t, t => t.localRotation);
            BakedLoop result;
            try
            {
                FixedIdlePose.Default.Apply(model.Runtime.ControlRig); model.Runtime.Process();
                var vertices = ReadSkin(model);
                if (vertices.Length == 0 || model.SpringBone.Springs.Count == 0)
                    return new BakedLoop { fingerprint = key, channels = Array.Empty<Channel>(), chains = Array.Empty<ChainResult>() };
                var positions = vertices.Select(v => v.Evaluate()).ToArray();
                var bounds = new Bounds(model.transform.position, Vector3.zero);
                if (positions.Length > 0) { bounds = new Bounds(positions[0], Vector3.zero); foreach (var p in positions) bounds.Encapsulate(p); }
                var height = bounds.size.y;
                if (!float.IsFinite(height) || height < .01f) throw new InvalidOperationException("Cannot measure idle geometry.");
                var chains = BuildChains(model, vertices, positions, bounds, constrained);
                var style = JsonUtility.FromJson<Style>(styleText);
                var tolerance = height * .0003f;
                // All chains run together, so shared skin cannot silently exceed its budget.
                for (var iteration = 0; iteration < 18; iteration++)
                {
                    token.ThrowIfCancellationRequested(); var error = 0f;
                    MeasureCycle(chains, style, 17);
                    foreach (var c in chains)
                    {
                        error = Mathf.Max(error, Mathf.Abs(c.actual / c.target - 1));
                        var gain = Mathf.Pow(Mathf.Clamp(c.target / Mathf.Max(c.actual, 1e-9f), .65f, 1.4f), .65f);
                        c.angle = Mathf.Min(12 * Mathf.Deg2Rad, c.angle * gain);
                        if (c.penetration > tolerance) c.angle *= .65f;
                    }
                    if (error < .04f && chains.All(c => c.penetration <= tolerance)) break;
                    if (yieldDuringBake && iteration % 2 == 1) await Task.Yield();
                }
                // Check every baked frame. Unsafe chains become static, rather than forcing motion.
                for (var attempt = 0; attempt < 8; attempt++)
                {
                    token.ThrowIfCancellationRequested(); MeasureCycle(chains, style, Frames);
                    var unsafeChains = chains.Where(c => c.penetration > tolerance).ToArray();
                    if (unsafeChains.Length == 0) break;
                    foreach (var c in unsafeChains) c.angle = attempt == 7 ? 0 : c.angle * .5f;
                    if (yieldDuringBake) await Task.Yield();
                }
                MeasureCycle(chains, style, Frames);
                if (chains.Any(c => c.penetration > tolerance))
                {
                    foreach (var c in chains) c.angle = 0;
                    MeasureCycle(chains, style, Frames);
                }
                var channels = new List<Channel>();
                foreach (var chain in chains)
                    for (var j = 0; j < chain.joints.Length - 1; j++) channels.Add(new Channel { path = BonePath(model.transform, chain.joints[j]), rotations = new float[Frames * 4] });
                for (var frame = 0; frame < Frames; frame++)
                {
                    SetPose(chains, style, frame / 60f); var channel = 0;
                    foreach (var c in chains) for (var j = 0; j < c.joints.Length - 1; j++)
                    {
                        var q = c.joints[j].localRotation.normalized; var values = channels[channel++].rotations;
                        values[frame * 4] = q.x; values[frame * 4 + 1] = q.y; values[frame * 4 + 2] = q.z; values[frame * 4 + 3] = q.w;
                    }
                }
                foreach (var c in channels) Array.Copy(c.rotations, 0, c.rotations, (Frames - 1) * 4, 4);
                result = new BakedLoop { fingerprint = key, channels = channels.ToArray(), chains = chains.Select(c => new ChainResult { name = c.name, role = c.role, target = c.target, actual = c.actual, penetration = c.penetration, limited = Mathf.Abs(c.actual / c.target - 1) > .12f }).ToArray() };
                if (!IsValid(result, allowed)) throw new InvalidOperationException("Invalid generated idle loop.");
            }
            finally
            {
                foreach (var item in restore) if (item.Key != null) item.Key.localRotation = item.Value;
                model.Runtime.SpringBone.SetModelLevel(model.transform, new BlittableModelLevel(supportsScalingAtRuntime: true));
            }
            token.ThrowIfCancellationRequested();
            try
            {
                if (useCache)
                {
                    Directory.CreateDirectory(directory);
                    var temporary = cache + "." + Guid.NewGuid().ToString("N") + ".tmp";
                    try
                    {
                        File.WriteAllText(temporary, JsonUtility.ToJson(result));
                        token.ThrowIfCancellationRequested();
                        if (File.Exists(cache)) File.Replace(temporary, cache, null);
                        else File.Move(temporary, cache);
                    }
                    finally { if (File.Exists(temporary)) File.Delete(temporary); }
                }
            }
            catch (Exception e) when (e is IOException || e is UnauthorizedAccessException) { Debug.LogWarning("Idle cache unavailable; using in-memory baked loop."); }
            Debug.Log($"KATARUNE_ADAPTIVE_IDLE_BAKED chains={result.chains.Length} channels={result.channels.Length} period={Period}");
            return result;
        }
        private static Vertex[] ReadSkin(Vrm10Instance model)
        {
            var result = new List<Vertex>();
            foreach (var renderer in model.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                var mesh = renderer.sharedMesh; if (mesh == null || !mesh.isReadable) continue;
                var positions = mesh.vertices; var bind = mesh.bindposes; var bones = renderer.bones;
                // Include the model's initial morph state before measuring skin/shape.
                for (var shape = 0; shape < mesh.blendShapeCount; shape++)
                {
                    var weight = renderer.GetBlendShapeWeight(shape); if (Mathf.Abs(weight) < .001f) continue;
                    if (mesh.GetBlendShapeFrameCount(shape) != 1) throw new InvalidOperationException("Adaptive idle requires single-frame initial morphs.");
                    var delta = new Vector3[positions.Length]; mesh.GetBlendShapeFrameVertices(shape, 0, delta, null, null);
                    var frameWeight = mesh.GetBlendShapeFrameWeight(shape, 0); var gain = weight / Mathf.Max(.001f, frameWeight);
                    for (var i = 0; i < positions.Length; i++) positions[i] += delta[i] * gain;
                }
                using var counts = mesh.GetBonesPerVertex(); using var weights = mesh.GetAllBoneWeights(); var offset = 0;
                for (var i = 0; i < positions.Length; i++)
                {
                    var vb = new List<Transform>(); var vl = new List<Vector3>(); var vw = new List<float>();
                    for (var j = 0; j < counts[i]; j++)
                    {
                        var w = weights[offset++]; if (w.weight <= 0 || w.boneIndex >= bones.Length || w.boneIndex >= bind.Length || bones[w.boneIndex] == null) continue;
                        vb.Add(bones[w.boneIndex]); vl.Add(bind[w.boneIndex].MultiplyPoint3x4(positions[i])); vw.Add(w.weight);
                    }
                    if (vw.Count > 0) result.Add(new Vertex { bones = vb.ToArray(), local = vl.ToArray(), weights = vw.ToArray() });
                }
            }
            return result.ToArray();
        }
        private static List<Chain> BuildChains(Vrm10Instance model, Vertex[] all, Vector3[] positions, Bounds bounds, HashSet<Transform> constrained)
        {
            var result = new List<Chain>(); var occupied = new HashSet<Transform>(); var height = bounds.size.y;
            var head = model.Humanoid.Head;
            foreach (var spring in model.SpringBone.Springs)
            {
                var joints = spring.Joints.Where(j => j != null).Select(j => j.transform).ToArray();
                if (joints.Length < 2 || joints.Any(constrained.Contains) || joints.Take(joints.Length - 1).Any(occupied.Contains)) continue;
                if (joints.Any(j => model.transform.Find(BonePath(model.transform,j)) != j)) continue;
                if (joints.Skip(1).Where((t, i) => t.parent != joints[i]).Any()) continue;
                var length = joints.Skip(1).Select((t, i) => Vector3.Distance(t.position, joints[i].position)).Sum();
                if (length < height * .001f || joints.Skip(1).Where((t, i) => Vector3.Distance(t.position, joints[i].position) < height * .00001f).Any()) continue;
                var indices = new List<int>(); var influence = new List<float>();
                for (var i = 0; i < all.Length; i++)
                {
                    var v = all[i]; var sum = 0f;
                    for (var j = 0; j < v.bones.Length; j++) if (joints.Any(t => v.bones[j] == t || v.bones[j].IsChildOf(t))) sum += v.weights[j];
                    if (sum > .03f) { indices.Add(i); influence.Add(sum); }
                }
                if (indices.Count == 0) continue;
                var region = new Bounds(positions[indices[0]], Vector3.zero); var centroid = Vector3.zero; var total = influence.Sum();
                for (var i = 0; i < indices.Count; i++) { var p = positions[indices[i]]; region.Encapsulate(p); centroid += p * (influence[i] / total); }
                var covariance = new Matrix4x4();
                for (var i = 0; i < indices.Count; i++) { var p = positions[indices[i]] - centroid; for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) covariance[a,b] += p[a] * p[b] * influence[i] / total; }
                var aspect = Aspect(covariance); var attach = (joints[0].position.y - bounds.min.y) / height; var name = (spring.Name ?? joints[0].name).ToLowerInvariant();
                var role = name.Contains("ear") || name.Contains("耳") || name.Contains("ribbon") || name.Contains("ornament") ? "accessory"
                    : (head != null && (joints[0] == head || joints[0].IsChildOf(head))) || (attach > .72f && (aspect > 1.25f || length < height * .3f)) ? "hair"
                    : attach > .3f && attach < .75f ? "cloth" : "accessory";
                var axis = region.size.x >= region.size.y && region.size.x >= region.size.z ? 0 : region.size.y >= region.size.z ? 1 : 2;
                indices.Sort((a,b) => positions[a][axis].CompareTo(positions[b][axis]));
                var selected = Enumerable.Range(0, Mathf.Min(SamplesPerChain, indices.Count)).Select(i => indices[Mathf.RoundToInt(i * (indices.Count - 1f) / Mathf.Max(1, Mathf.Min(SamplesPerChain, indices.Count) - 1))]).Distinct().ToArray();
                var colliders = spring.ColliderGroups.SelectMany(g => g.Colliders).Where(c => c != null).Distinct().ToArray();
                if (colliders.Any(c => c.ColliderType != VRM10SpringBoneColliderTypes.Sphere && c.ColliderType != VRM10SpringBoneColliderTypes.Capsule)) continue;
                var chain = new Chain { name = spring.Name, role = role, joints = joints, rest = joints.Select(t => t.localRotation).ToArray(), vertices = selected.Select(i => all[i]).ToArray(), restPoints = selected.Select(i => positions[i]).ToArray(),
                    phase = .22f * (joints[0].position.x - bounds.center.x) / height,
                    target = Mathf.Min(height * (role == "hair" ? .008f : role == "cloth" ? .006f : .003f), length * .14f, indices.Max(i => Vector3.Distance(positions[i], joints[0].position)) * .12f),
                    axes = new Vector3[joints.Length - 1], sideAxes = new Vector3[joints.Length - 1], weights = new float[joints.Length - 1],
                    radii = spring.Joints.Skip(1).Select(j => j.m_jointRadius * MaxScale(j.transform)).ToArray(),
                    colliders = colliders.Select(c => new Proxy { a = c.transform.TransformPoint(c.Offset), b = c.transform.TransformPoint(c.ColliderType == VRM10SpringBoneColliderTypes.Capsule ? c.Tail : c.Offset), radius = c.Radius * MaxScale(c.transform) }).ToArray() };
                for (var j = 0; j < joints.Length - 1; j++)
                {
                    var direction = (joints[j + 1].position - joints[j].position).normalized;
                    chain.axes[j] = Quaternion.Inverse(joints[j].rotation) * Vector3.Cross(direction, Vector3.right).normalized;
                    chain.sideAxes[j] = Quaternion.Inverse(joints[j].rotation) * Vector3.Cross(direction, Vector3.forward).normalized;
                    chain.weights[j] = Mathf.Lerp(.45f, 1, j / Mathf.Max(1f, joints.Length - 2)) / Mathf.Sqrt(1 + Mathf.Max(0, spring.Joints[j].m_stiffnessForce));
                }
                var wsum = chain.weights.Sum(); for (var j = 0; j < chain.weights.Length; j++) chain.weights[j] /= wsum;
                chain.baseline = chain.restPoints.Select(p => Distance(p, chain.colliders)).ToArray();
                chain.tipBaseline = joints.Skip(1).Select((t,i) => Distance(t.position, chain.colliders) - chain.radii[i]).ToArray();
                foreach (var j in joints.Take(joints.Length - 1)) occupied.Add(j); result.Add(chain);
            }
            return result;
        }
        private static float MaxScale(Transform t) => Mathf.Max(Mathf.Abs(t.lossyScale.x), Mathf.Abs(t.lossyScale.y), Mathf.Abs(t.lossyScale.z));
        private static float Aspect(Matrix4x4 covariance)
        {
            float Eigen(Matrix4x4 m, out Vector3 axis)
            {
                axis = new Vector3(.67f, .43f, .61f).normalized;
                for (var i = 0; i < 24; i++) axis = m.MultiplyVector(axis).normalized;
                return Mathf.Max(0, Vector3.Dot(axis, m.MultiplyVector(axis)));
            }
            var first = Eigen(covariance, out var v); for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) covariance[a,b] -= first * v[a] * v[b];
            var second = Eigen(covariance, out _); return Mathf.Sqrt(first / Mathf.Max(second, first * .00001f + 1e-20f));
        }
        public static float CapsuleDistance(Vector3 p, Vector3 a, Vector3 b, float radius)
        { var ab = b - a; var t = Mathf.Clamp01(Vector3.Dot(p - a, ab) / Mathf.Max(1e-20f, ab.sqrMagnitude)); return Vector3.Distance(p, a + ab * t) - radius; }
        private static float Distance(Vector3 p, Proxy[] colliders) => colliders.Length == 0 ? float.PositiveInfinity : colliders.Min(c => CapsuleDistance(p,c.a,c.b,c.radius));
        private static void SetPose(List<Chain> chains, Style style, float time)
        {
            foreach (var c in chains)
            {
                var profile = c.role == "hair" ? style.hair : c.role == "cloth" ? style.cloth : style.accessory;
                for (var j = 0; j < c.joints.Length - 1; j++)
                {
                    var phase = 2 * Mathf.PI * time / Period + c.phase - .20f * j / Mathf.Max(1, c.joints.Length - 2); var wave = 0f;
                    foreach (var h in profile) wave += h.cos * Mathf.Cos(h.harmonic * phase) + h.sin * Mathf.Sin(h.harmonic * phase);
                    var vector = c.angle * c.weights[j] * (c.axes[j] * wave + c.sideAxes[j] * (.25f * Mathf.Sin(phase + .65f)));
                    c.joints[j].localRotation = c.rest[j] * (vector.sqrMagnitude < 1e-20f ? Quaternion.identity : Quaternion.AngleAxis(vector.magnitude * Mathf.Rad2Deg, vector.normalized));
                }
            }
        }
        private static void MeasureCycle(List<Chain> chains, Style style, int samples)
        {
            foreach (var c in chains) { c.actual = 0; c.penetration = 0; }
            for (var f = 0; f < samples; f++)
            {
                SetPose(chains, style, Period * f / (samples - 1));
                foreach (var c in chains)
                {
                    var distances = new float[c.vertices.Length];
                    for (var i = 0; i < distances.Length; i++)
                    {
                        var p = c.vertices[i].Evaluate(); distances[i] = Vector3.Distance(p,c.restPoints[i]);
                        c.penetration = Mathf.Max(c.penetration, Mathf.Min(c.baseline[i], 0) - Distance(p,c.colliders));
                    }
                    Array.Sort(distances); c.actual = Mathf.Max(c.actual, distances[Mathf.CeilToInt((distances.Length - 1) * .95f)]);
                    for (var j = 1; j < c.joints.Length; j++) c.penetration = Mathf.Max(c.penetration, Mathf.Min(c.tipBaseline[j - 1], 0) - (Distance(c.joints[j].position,c.colliders) - c.radii[j - 1]));
                }
            }
        }
    }
}
