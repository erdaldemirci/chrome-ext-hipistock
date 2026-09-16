import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { writeFileSync, mkdirSync, readFileSync, cpSync, existsSync } from "node:fs";

function extensionManifestPlugin() {
  return {
    name: "extension-manifest",
    closeBundle() {
      const dist = resolve(__dirname, "dist");
      mkdirSync(resolve(dist, "content"), { recursive: true });
      mkdirSync(resolve(dist, "icons"), { recursive: true });
      mkdirSync(resolve(dist, "templates"), { recursive: true });

      const manifest = JSON.parse(
        readFileSync(resolve(__dirname, "public/manifest.json"), "utf8"),
      );
      writeFileSync(
        resolve(dist, "manifest.json"),
        JSON.stringify(manifest, null, 2),
      );

      for (const size of [16, 48, 128]) {
        const src = resolve(__dirname, `public/icons/icon${size}.png`);
        if (existsSync(src)) {
          cpSync(src, resolve(dist, `icons/icon${size}.png`));
        }
      }
      for (const file of ["logo.svg", "logo.png", "logo@2x.png"]) {
        const src = resolve(__dirname, `public/icons/${file}`);
        if (existsSync(src)) {
          cpSync(src, resolve(dist, `icons/${file}`));
        }
      }
      for (const file of [
        "hipicon-fiyat-stok-v2.xlsx",
        "hipicon-yeni-urun-v2.xlsx",
      ]) {
        cpSync(
          resolve(__dirname, `public/templates/${file}`),
          resolve(dist, `templates/${file}`),
        );
      }
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), extensionManifestPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, "sidepanel.html"),
        popup: resolve(__dirname, "popup.html"),
        background: resolve(__dirname, "src/background/index.ts"),
        content: resolve(__dirname, "src/content/hipicon.ts"),
        shopifyAdmin: resolve(__dirname, "src/content/shopify-admin.ts"),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "background") return "background.js";
          if (chunk.name === "content") return "content/hipicon.js";
          if (chunk.name === "shopifyAdmin") return "content/shopify-admin.js";
          return "assets/[name].js";
        },
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  publicDir: false,
});
