import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: ".",
  base: "./",
  plugins: [react()],
  server: { port: 5320, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
