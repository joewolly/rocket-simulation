import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // Keep the renderer dependency cacheable separately from the game code.
        manualChunks(id) {
          if (id.includes("node_modules/three")) return "three-vendor";
        },
      },
    },
  },
});
