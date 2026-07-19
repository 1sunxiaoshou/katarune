import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CREDENTIAL_REFERENCE_PATTERN = /^safe-storage\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

export interface CredentialCipher {
  isEncryptionAvailable(): Promise<boolean>;
  encryptString(value: string): Promise<Buffer>;
  decryptString(value: Buffer): Promise<{
    readonly result: string;
    readonly shouldReEncrypt: boolean;
  }>;
}

export interface CredentialStore {
  put(secret: string): Promise<string>;
  resolve(reference: string): Promise<string>;
  delete(reference: string): Promise<void>;
}

interface CreateCredentialStoreOptions {
  readonly userDataPath: string;
  readonly cipher: CredentialCipher;
}

function parseCredentialReference(reference: string): string {
  const match = CREDENTIAL_REFERENCE_PATTERN.exec(reference);
  if (match === null) {
    throw new Error(`Credential reference "${reference}" is not a safeStorage reference.`);
  }
  return match[1]!;
}

export async function createCredentialStore({
  userDataPath,
  cipher,
}: CreateCredentialStoreOptions): Promise<CredentialStore> {
  if (!(await cipher.isEncryptionAvailable())) {
    throw new Error("Operating-system credential encryption is unavailable.");
  }

  const credentialsDirectory = join(userDataPath, "credentials");
  await mkdir(credentialsDirectory, { recursive: true });

  const credentialPath = (reference: string): string =>
    join(credentialsDirectory, `${parseCredentialReference(reference)}.bin`);

  return {
    put: async (secret) => {
      if (secret.length === 0) {
        throw new Error("A credential cannot be empty.");
      }

      const id = randomUUID();
      const reference = `safe-storage/${id}`;
      const encrypted = await cipher.encryptString(secret);
      await writeFile(credentialPath(reference), encrypted, { flag: "wx", mode: 0o600 });
      return reference;
    },
    resolve: async (reference) => {
      const path = credentialPath(reference);
      const encrypted = await readFile(path);
      const decrypted = await cipher.decryptString(encrypted);

      if (decrypted.shouldReEncrypt) {
        const rotated = await cipher.encryptString(decrypted.result);
        await writeFile(path, rotated, { mode: 0o600 });
      }

      return decrypted.result;
    },
    delete: async (reference) => {
      await rm(credentialPath(reference), { force: true });
    },
  };
}
