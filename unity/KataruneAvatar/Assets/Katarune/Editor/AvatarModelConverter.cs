using System;
using System.IO;
using UniGLTF;
using UniVRM10;
using UnityEngine;

namespace Katarune.Avatar.Editor
{
    // Offline asset preparation only; the Player continues to require VRM 1.0.
    public static class AvatarModelConverter
    {
        public static void ConvertFromEnvironment()
        {
            var source = Environment.GetEnvironmentVariable("KATARUNE_VRM_SOURCE");
            var destination = Environment.GetEnvironmentVariable("KATARUNE_VRM_OUTPUT");
            if (string.IsNullOrWhiteSpace(source) || string.IsNullOrWhiteSpace(destination))
                throw new ArgumentException("Set KATARUNE_VRM_SOURCE and KATARUNE_VRM_OUTPUT to distinct file paths.");
            source = Path.GetFullPath(source);
            destination = Path.GetFullPath(destination);
            if (string.Equals(source, destination, StringComparison.OrdinalIgnoreCase) || File.Exists(destination))
                throw new IOException("Conversion requires a new output file; existing assets are never overwritten.");
            using var original = new GlbLowLevelParser(source, File.ReadAllBytes(source)).Parse();
            using var converted = Vrm10Data.Migrate(original, out var vrm, out var migration);
            if (converted == null || vrm == null)
                throw new InvalidOperationException(migration.Message);
            var bytes = Glb.Create(converted.Chunks[0].Bytes, converted.Chunks[1].Bytes).ToBytes();
            using var validation = new GlbLowLevelParser(destination, bytes).Parse();
            if (Vrm10Data.Parse(validation) == null) throw new InvalidDataException("The converted asset is not VRM 1.0.");
            Directory.CreateDirectory(Path.GetDirectoryName(destination));
            using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write);
            output.Write(bytes, 0, bytes.Length);
            Debug.Log("KATARUNE_VRM_CONVERTED bytes=" + bytes.Length);
        }
    }
}
