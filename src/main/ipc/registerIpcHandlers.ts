import type { AvatarService } from "../avatar/avatarService";
import { registerAvatarHandlers } from "./avatarHandlers";
import { ChatStreamRegistry } from "../ai/chatStream";
import type { AiRuntime } from "../ai/runtime";
import type { AssetService } from "../assets/assetService";
import type { DatabaseRuntime } from "../database/database";
import type { CredentialStore } from "../security/credentialStore";
import { SpeechRequestRegistry } from "../speech/speechRequestRegistry";
import type { SpeechService } from "../speech/ttsService";
import { registerMemoryHandlers } from "./memoryHandlers";
import { registerAppHandlers } from "./appHandlers";
import { registerCharacterHandlers } from "./characterHandlers";
import { registerChatHandlers } from "./chatHandlers";
import { registerProviderHandlers } from "./providerHandlers";
import { registerSpeechHandlers } from "./speechHandlers";
import type { LiveService } from "../live/liveService";

export function registerIpcHandlers(
  database: DatabaseRuntime,
  aiRuntime: AiRuntime,
  credentialStore: CredentialStore,
  assetService: AssetService,
  speechService: SpeechService,
  avatar?: AvatarService,
  retryDiaries?: () => void,
  live?: LiveService,
): SpeechRequestRegistry {
  const chatStreams = new ChatStreamRegistry();
  const speechRequests = new SpeechRequestRegistry();

  registerAppHandlers(database, aiRuntime);
  registerChatHandlers(database, aiRuntime, chatStreams, assetService, avatar, live);
  if (avatar) registerAvatarHandlers(avatar, database);
  registerSpeechHandlers(speechService, speechRequests, avatar);
  registerProviderHandlers(database, aiRuntime, credentialStore);
  registerCharacterHandlers(database, chatStreams, live);
  registerMemoryHandlers(database, retryDiaries);

  return speechRequests;
}
