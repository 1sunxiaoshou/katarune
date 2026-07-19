import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import { createCredentialStore } from "../src/main/security/credentialStore";

const userDataPath = mkdtempSync(join(tmpdir(), "katarune-safe-storage-test-"));

void app.whenReady().then(async () => {
  const store = await createCredentialStore({
    userDataPath,
    cipher: {
      isEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
      encryptString: (value) => safeStorage.encryptStringAsync(value),
      decryptString: (value) => safeStorage.decryptStringAsync(value),
    },
  });
  const secret = `integration-secret-${Date.now()}`;
  const reference = await store.put(secret);
  const files = readdirSync(join(userDataPath, "credentials"));
  assert.equal(files.length, 1);
  assert.equal(readFileSync(join(userDataPath, "credentials", files[0]!)).includes(secret), false);
  assert.equal(await store.resolve(reference), secret);
  await store.delete(reference);
  await assert.rejects(store.resolve(reference));
  console.log("Electron safeStorage credential encryption and deletion passed.");
}).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  rmSync(userDataPath, { recursive: true, force: true });
  app.quit();
});
