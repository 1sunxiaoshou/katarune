import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import type { WarningHandlerWithDefault } from "rollup";

// electron-vite 5's isolatedEntries progress reporter calls TTY methods even
// with redirected stdout. Keep CI/headless builds working without changing
// runtime code or upgrading the build tool as part of this feature.
if (!process.stdout.isTTY) {
  process.stdout.clearLine ??= () => true;
  process.stdout.cursorTo ??= () => true;
  process.stdout.moveCursor ??= () => true;
}

const ignoreBundledUseClientWarnings: WarningHandlerWithDefault = (
  warning,
  defaultHandler,
) => {
  if (
    warning.code === "MODULE_LEVEL_DIRECTIVE" &&
    warning.message.includes('"use client"')
  ) {
    return;
  }

  defaultHandler(warning);
};

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: [
          "@assistant-ui/react",
          "@assistant-ui/react-ai-sdk",
        ],
      },
      rollupOptions: {
        input: { index: resolve("src/main/index.ts"), diagnosticWriter: resolve("src/main/diagnostics/diagnosticWriter.ts") },
        onwarn: ignoreBundledUseClientWarnings,
      },
    },
  },
  preload: {
    build: {
      isolatedEntries: true,
      externalizeDeps: {
        exclude: ["zod", "zod/mini"],
      },
      rollupOptions: {
        input: { index: resolve("src/preload/index.ts"), desktop: resolve("src/preload/desktop.ts") },
        output: {
          format: "cjs",
        },
      },
    },
  },
  renderer: {
    build: {
      minify: "esbuild",
      rollupOptions: { input: { index: resolve("src/renderer/index.html"), desktop: resolve("src/renderer/desktop.html") } },
    },
    resolve: {
      alias: {
        "@": resolve("src/renderer/src"),
        "@renderer": resolve("src/renderer/src"),
      },
    },
    plugins: [tailwindcss(), react()],
  },
});
