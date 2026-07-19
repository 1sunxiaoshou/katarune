import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {},
  preload: {
    build: {
      externalizeDeps: {
        exclude: ["zod", "zod/mini"],
      },
      rollupOptions: {
        output: {
          format: "cjs",
        },
      },
    },
  },
  renderer: {
    build: {
      minify: "esbuild",
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
