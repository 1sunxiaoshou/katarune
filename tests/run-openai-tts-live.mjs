import { runProviderLiveTest } from "./run-provider-live-test.mjs";

runProviderLiveTest("openai-tts-live", [
  "KATARUNE_TEST_OPENAI_API_KEY",
]);
