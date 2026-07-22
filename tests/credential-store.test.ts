import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createCredentialStore,
  type CredentialCipher,
} from "../src/main/security/credentialStore";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "katarune-credentials-test-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("credential store", () => {
  it("fails closed when operating-system encryption is unavailable", async () => {
    const cipher: CredentialCipher = {
      isEncryptionAvailable: async () => false,
      encryptString: async () => Buffer.alloc(0),
      decryptString: async () => ({ result: "", shouldReEncrypt: false }),
    };

    await expect(
      createCredentialStore({ userDataPath: await createTemporaryDirectory(), cipher }),
    ).rejects.toThrow(/unavailable/);
  });

  it("stores only ciphertext and resolves, rotates, and deletes by opaque reference", async () => {
    let shouldRotate = true;
    const cipher: CredentialCipher = {
      isEncryptionAvailable: async () => true,
      encryptString: async (value) => Buffer.from(`encrypted:${value}`, "utf8"),
      decryptString: async (value) => ({
        result: value.toString("utf8").replace(/^encrypted:/, ""),
        shouldReEncrypt: shouldRotate,
      }),
    };
    const userDataPath = await createTemporaryDirectory();
    const store = await createCredentialStore({ userDataPath, cipher });

    const reference = await store.put("secret-api-key");
    expect(reference).toMatch(/^safe-storage\/[0-9a-f-]{36}$/);
    const files = await readdir(join(userDataPath, "credentials"));
    expect(files).toHaveLength(1);
    expect((await readFile(join(userDataPath, "credentials", files[0]!))).toString("utf8"))
      .toBe("encrypted:secret-api-key");

    expect(await store.resolve(reference)).toBe("secret-api-key");
    shouldRotate = false;
    expect(await store.resolve(reference)).toBe("secret-api-key");

    await store.delete(reference);
    await expect(store.resolve(reference)).rejects.toThrow();
    await expect(store.resolve("safe-storage/../../secret")).rejects.toThrow(/not a safeStorage/);
  });
});
