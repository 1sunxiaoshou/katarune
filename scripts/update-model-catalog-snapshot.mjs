import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const source = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const destination = resolve("src/main/ai/litellm-models.json");
const metadataDestination = resolve("src/main/ai/litellm-models.meta.json");
const response = await fetch(source, {
  headers: { Accept: "application/json" },
  signal: AbortSignal.timeout(30_000),
});

if (!response.ok) {
  throw new Error(`Unable to download LiteLLM model catalog (HTTP ${response.status}).`);
}

const text = await response.text();
const catalog = JSON.parse(text);
if (!catalog || Array.isArray(catalog) || typeof catalog !== "object" ||
    !Object.values(catalog).some(entry => typeof entry?.litellm_provider === "string")) {
  throw new Error("The downloaded LiteLLM model catalog does not contain provider entries.");
}
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${text.trim()}\n`, "utf8");
await writeFile(metadataDestination, `${JSON.stringify({
  source,
  repository: "https://github.com/BerriAI/litellm",
  license: "MIT",
  fetchedAt: new Date().toISOString(),
}, null, 2)}\n`, "utf8");
