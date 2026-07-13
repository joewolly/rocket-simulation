import { defineConfig } from "vite";

export default defineConfig({
  build:{
    rollupOptions:{
      output:{
        manualChunks(id){
          if(id.includes("three/examples"))return "three-addons";
          if(id.includes("node_modules/three"))return "three-core";
        },
      },
    },
  },
});
