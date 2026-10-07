import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, type Plugin } from "vite";

const localModelPath = fileURLToPath(
  new URL("./public/models/handwave-local.ort", import.meta.url),
);

export default defineConfig({
  build: {
    cssMinify: "lightningcss",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
  },
  plugins: [
    serveLocalModel(),
    tailwindcss(),
    nitro(),
    tanstackStart({
      srcDirectory: "src",
      router: {
        routesDirectory: "routes",
      },
    }),
    viteReact(),
  ],
});

function serveLocalModel(): Plugin {
  return {
    name: "handwave-local-model",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        "/models/handwave-local.ort",
        async (request, response, next) => {
          if (request.method !== "GET" && request.method !== "HEAD") {
            next();
            return;
          }
          try {
            const model = await stat(localModelPath);
            response.setHeader("Cache-Control", "no-cache");
            response.setHeader("Content-Length", model.size);
            response.setHeader("Content-Type", "application/octet-stream");
            if (request.method === "HEAD") {
              response.end();
              return;
            }
            createReadStream(localModelPath).pipe(response);
          } catch {
            next();
          }
        },
      );
    },
  };
}
