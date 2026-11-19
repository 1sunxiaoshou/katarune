import { runProviderLiveTest } from "./run-provider-live-test.mjs";

runProviderLiveTest("deepseek-live", [
  "KATARUNE_TEST_DEEPSEEK_API_KEY",
], { skipWithoutCredentials: false });
