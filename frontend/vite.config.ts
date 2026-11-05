import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { codeInspectorPlugin } from "code-inspector-plugin";

export default defineConfig({
  plugins: [
    // `npm run dev` lang: pindutin ang Alt+Shift sa browser at i-click ang kahit anong bahagi ng page
    // para buksan sa VS Code ang mismong file at linya. Hindi ito kasama sa production build.
    codeInspectorPlugin({ bundler: "vite", editor: "code" }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  // The photo-classifier worker imports onnxruntime lazily, which needs ES-module workers.
  worker: { format: "es" },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return "react-vendor";
          if (id.includes("@supabase")) return "data-vendor";
          if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return "motion-vendor";
        },
      },
    },
  },
});
