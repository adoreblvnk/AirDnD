import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  define: { CESIUM_BASE_URL: JSON.stringify("/cesium") },
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: "node_modules/cesium/Build/Cesium/Workers/**/*", dest: "cesium/Workers" },
        { src: "node_modules/cesium/Build/Cesium/ThirdParty/**/*", dest: "cesium/ThirdParty" },
        { src: "node_modules/cesium/Build/Cesium/Assets/**/*", dest: "cesium/Assets" },
        { src: "node_modules/cesium/Build/Cesium/Widgets/**/*", dest: "cesium/Widgets" }
      ]
    })
  ],
  server: { port: 5173, host: "127.0.0.1" },
  build: { target: "es2022" }
});
