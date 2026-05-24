import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readContract } from "./validate.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const result = spawnSync("pnpm", ["exec", "tsp", "compile", "."], {
  cwd: root,
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

await readContract();
