using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Katarune.Avatar.Editor
{
    public static class PhaseDAcceptanceAssetGenerator
    {
        private const string CatalogPath =
            "Assets/Katarune/Resources/BehaviorDefinitionCatalog.asset";
        private const string SceneDirectory = "Assets/Katarune/Scenes/Acceptance";

        [MenuItem("Katarune/Generate Phase D Acceptance Assets")]
        public static void Generate()
        {
            EnsureDirectory("Assets/Katarune/Resources");
            EnsureDirectory(SceneDirectory);
            GenerateCatalog();
            GenerateScene(
                $"{SceneDirectory}/PhaseD_SpeakingWithFullBodyExplain.unity",
                PhaseDAcceptanceScenario.SpeechWithFullBodyExplain);
            GenerateScene(
                $"{SceneDirectory}/PhaseD_DanceInterruption.unity",
                PhaseDAcceptanceScenario.DanceInterruption);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("Generated Katarune Phase D behavior catalog and acceptance scenes.");
        }

        private static void GenerateCatalog()
        {
            var definitions = new[]
            {
                Load("Assets/Katarune/Behaviors/KataruneQuietIdle.kbehavior"),
                Load("Assets/Katarune/Behaviors/QuaterniusFullBodyExplain.kbehavior"),
                Load("Assets/Katarune/Behaviors/QuaterniusShortDance.kbehavior"),
            };
            var catalog = AssetDatabase.LoadAssetAtPath<BehaviorDefinitionCatalog>(CatalogPath);
            if (catalog == null)
            {
                catalog = ScriptableObject.CreateInstance<BehaviorDefinitionCatalog>();
                AssetDatabase.CreateAsset(catalog, CatalogPath);
            }
            catalog.Configure(definitions);
            EditorUtility.SetDirty(catalog);
        }

        private static BehaviorDefinitionAsset Load(string path)
        {
            var definition = AssetDatabase.LoadAssetAtPath<BehaviorDefinitionAsset>(path);
            if (definition == null) throw new FileNotFoundException("Behavior definition is missing.", path);
            return definition;
        }

        private static void GenerateScene(string path, PhaseDAcceptanceScenario scenario)
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var runner = new GameObject("Phase D Acceptance Scenario")
                .AddComponent<PhaseDAcceptanceScenarioRunner>();
            runner.Configure(scenario);
            EditorSceneManager.SaveScene(scene, path);
        }

        private static void EnsureDirectory(string path)
        {
            var fullPath = Path.GetFullPath(path);
            if (!Directory.Exists(fullPath)) Directory.CreateDirectory(fullPath);
        }
    }
}
