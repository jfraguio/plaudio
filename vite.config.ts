import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const SW_TEMPLATE = fileURLToPath(new URL("./build/sw-template.js", import.meta.url));

function serviceWorkerPlugin(): Plugin {
  let version = "dev";
  return {
    name: "plaudio-service-worker",
    apply: "build",
    configResolved() {
      version = String(Date.now());
    },
    generateBundle(_options, bundle) {
      const emitted = Object.keys(bundle).filter(
        (file) => file.endsWith(".js") || file.endsWith(".css"),
      );
      const precache = [
        "./",
        "./index.html",
        "./manifest.webmanifest",
        "./icons/icon-192.png",
        "./icons/icon-512.png",
        "./icons/icon-maskable-512.png",
        ...emitted.map((file) => `./${file}`),
      ];
      const template = readFileSync(SW_TEMPLATE, "utf8");
      const source = template
        .replace("__VERSION__", version)
        .replace("/*__PRECACHE__*/ []", JSON.stringify(precache, null, 2));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  base: "./",
  server: {
    port: 5180,
    strictPort: true,
    host: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
    host: true,
  },
  build: {
    target: "es2022",
    sourcemap: false,
    assetsInlineLimit: 0,
  },
  plugins: [serviceWorkerPlugin()],
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
