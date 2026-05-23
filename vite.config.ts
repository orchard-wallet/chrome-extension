import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: "src/popup/index.html",
        settings: "src/settings/index.html",
        content: "src/content/providerBridge.ts",
        inpage: "src/inpage/ethereumProvider.ts",
        background: "src/background.ts"
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  },
  optimizeDeps: {
    exclude: ["@consenlabs/tcx-wasm"]
  }
});
