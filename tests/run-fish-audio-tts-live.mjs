import { runProviderLiveTest } from "./run-provider-live-test.mjs";

runProviderLiveTest("fish-audio-tts-live", [
  "KATARUNE_TEST_FISH_AUDIO_API_KEY",
  "KATARUNE_TEST_FISH_AUDIO_VOICE_ID",
]);
