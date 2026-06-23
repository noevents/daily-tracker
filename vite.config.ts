import { defineConfig } from "vite";
import fs from "node:fs";

// Use local HTTPS for `vite dev` only when certs are present (needed on iOS for
// notifications/PWA). Absent in CI/build, so guard so `vite build` never reads them.
const hasCerts =
  fs.existsSync(".cert/key.pem") && fs.existsSync(".cert/cert.pem");

export default defineConfig({
  server: {
    host: true,
    https: hasCerts
      ? {
          key: fs.readFileSync(".cert/key.pem"),
          cert: fs.readFileSync(".cert/cert.pem"),
        }
      : undefined,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
