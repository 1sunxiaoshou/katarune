import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const source = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const destination = resolve("src/main/ai/litellm-models.json");
const metadataDestination = resolve("src/main/ai/litellm-models.meta.json");
const response = await fetch(source, { headers: { Accept: "application/json" } });

if (!response.ok) {
  throw new Error(`Unable to download LiteLLM model catalog (HTTP ${response.status}).`);
}

const text = await response.text();
JSON.parse(text);
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${text.trim()}\n`, "utf8");
await writeFile(metadataDestination, `${JSON.stringify({
  source,
  repository: "https://github.com/BerriAI/litellm",
  license: "MIT",
  fetchedAt: new Date().toISOString(),
}, null, 2)}\n`, "utf8");
