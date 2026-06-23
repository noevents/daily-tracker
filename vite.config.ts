import { defineConfig } from "vite";
import fs from "node:fs";

export default defineConfig({
  server: {
    host: true,
    https: {
      key: fs.readFileSync(".cert/key.pem"),
      cert: fs.readFileSync(".cert/cert.pem"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
