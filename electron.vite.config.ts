import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import type { WarningHandlerWithDefault } from "rollup";

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
        onwarn: ignoreBundledUseClientWarnings,
      },
    },
  },
  preload: {
    build: {
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
