import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const contractPath = path.join(root, "config.json");

export async function readContract() {
  return validateContract(JSON.parse(await readFile(contractPath, "utf8")));
}

export function validateContract(contract) {
  expectObject(contract, "contract");
  expectObject(contract.decode, "decode");
  expectInteger(contract.decode.window, "decode.window");

  expectObject(contract.stream, "stream");
  expectInteger(contract.stream.fps, "stream.fps");
  expectInteger(contract.stream.min, "stream.min");
  expectInteger(contract.stream.stride, "stream.stride");
  expectInteger(contract.stream.idle, "stream.idle");
  expectInteger(contract.stream.lost, "stream.lost");
  expectInteger(contract.stream.holdMs, "stream.holdMs");
  expectNumber(contract.stream.motion, "stream.motion");

  const smoothing = contract.mp?.smooth;
  expectObject(smoothing, "mp.smooth");
  for (const name of ["hand", "pose"]) {
    const config = smoothing[name];
    expectObject(config, `mp.smooth.${name}`);
    expectNumber(config.freq, `mp.smooth.${name}.freq`);
    expectNumber(config.cutoff, `mp.smooth.${name}.cutoff`);
    expectNumber(config.beta, `mp.smooth.${name}.beta`);
    expectNumber(config.dCutoff, `mp.smooth.${name}.dCutoff`);
  }

  return contract;
}

function expectObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
}

function expectInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
}

function expectNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await readContract();
}
