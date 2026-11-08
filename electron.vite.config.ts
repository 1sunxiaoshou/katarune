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

const ignoreZodDocumentationAnnotations: WarningHandlerWithDefault = (
  warning,
  defaultHandler,
) => {
  const id = warning.id?.replace(/\\/g, "/");
  // Zod 4.6.6 mentions @__PURE__ in prose. Remove this filter when upstream
  // fixes those comments; keep warnings for actual misplaced annotations.
  if (
    warning.code === "INVALID_ANNOTATION" &&
    ((id?.endsWith("/node_modules/zod/v4/core/util.js") &&
      warning.message.includes("// Wrapped in a `@__PURE__` IIFE:")) ||
      (id?.endsWith("/node_modules/zod/v4/core/regexes.js") &&
        warning.message.includes("/** Anchors a pattern source.")))
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
        onwarn: ignoreZodDocumentationAnnotations,
        output: {
          format: "cjs",
        },
      },
    },
  },
  renderer: {
    build: {
      minify: "esbuild",
      rollupOptions: {
        input: { index: resolve("src/renderer/index.html"), desktop: resolve("src/renderer/desktop.html") },
        onwarn: ignoreZodDocumentationAnnotations,
      },
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
