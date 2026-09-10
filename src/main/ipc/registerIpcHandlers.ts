import type { AvatarService } from "../avatar/avatarService";
import { registerAvatarHandlers } from "./avatarHandlers";
import { ChatStreamRegistry } from "../ai/chatStream";
import type { AiRuntime } from "../ai/runtime";
import type { AssetService } from "../assets/assetService";
import type { DatabaseRuntime } from "../database/database";
import type { CredentialStore } from "../security/credentialStore";
import { SpeechRequestRegistry } from "../speech/speechRequestRegistry";
import type { SpeechService } from "../speech/ttsService";
import type { MemoryWikiService } from "../memory/memoryWikiService";
import { registerAppHandlers } from "./appHandlers";
import { registerCharacterHandlers } from "./characterHandlers";
import { registerChatHandlers } from "./chatHandlers";
import { registerProviderHandlers } from "./providerHandlers";
import { registerSpeechHandlers } from "./speechHandlers";

export function registerIpcHandlers(
  database: DatabaseRuntime,
  aiRuntime: AiRuntime,
  credentialStore: CredentialStore,
  assetService: AssetService,
  speechService: SpeechService,
  memoryWiki: MemoryWikiService,
  avatar?: AvatarService,
): SpeechRequestRegistry {
  const chatStreams = new ChatStreamRegistry();
  const speechRequests = new SpeechRequestRegistry();

  registerAppHandlers(database, aiRuntime);
  registerChatHandlers(database, aiRuntime, chatStreams, assetService, memoryWiki, avatar);
  if (avatar) registerAvatarHandlers(avatar, database);
  registerSpeechHandlers(speechService, speechRequests);
  registerProviderHandlers(database, aiRuntime, credentialStore);
  registerCharacterHandlers(database, assetService, chatStreams, memoryWiki);

  return speechRequests;
}
