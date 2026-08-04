/// <reference lib="webworker" />

import { expose, transfer } from "comlink";
import * as ort from "onnxruntime-web/webgpu";
import runtimeModuleURL from "../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url";
import runtimeWasmURL from "../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url";
import type {
  LocalModelOutput,
  LocalModelWorker,
} from "@/lib/inference/local-model-types";
import type { Frame } from "@/types/inference";

const modelURL = "/models/handwave-local.onnx";
const modelDataPath = "handwave-local.onnx.data";
const modelDataURL = `/models/${modelDataPath}`;
const vocabSize = 60;
const missingLandmark = -8192;
let session: ort.InferenceSession | null = null;
let preparation: Promise<ort.InferenceSession> | null = null;

ort.env.wasm.wasmPaths = {
  mjs: new URL(runtimeModuleURL, self.location.href).href,
  wasm: new URL(runtimeWasmURL, self.location.href).href,
};
ort.env.wasm.numThreads = self.crossOriginIsolated
  ? Math.min(4, navigator.hardwareConcurrency || 1)
  : 1;

const api: LocalModelWorker = {
  async prepare() {
    await getSession();
  },
  async infer(frames: Frame[]) {
    const activeSession = await getSession();
    const landmarks = landmarkValues(frames);
    const output = await activeSession.run({
      landmarks: new ort.Tensor("float32", landmarks, [1, frames.length, 162]),
    });
    const tensor = output.log_probs;
    if (!tensor || tensor.dims.length !== 3) {
      throw new Error("Local model returned an invalid result");
    }
    const values = Float32Array.from(tensor.data as ArrayLike<number>);
    const rows = Number(tensor.dims[1]);
    const columns = Number(tensor.dims[2]);
    if (columns !== vocabSize || values.length !== rows * columns) {
      throw new Error("Local model returned an invalid shape");
    }
    const result: LocalModelOutput = {
      columns,
      frameConfidence: frameConfidence(values, rows, columns),
      rows,
      values,
    };
    return transfer(result, [values.buffer]);
  },
};

expose(api);

function getSession() {
  if (session) return Promise.resolve(session);
  preparation ??= createSession()
    .then((created) => {
      session = created;
      return created;
    })
    .catch((error: unknown) => {
      preparation = null;
      throw error;
    });
  return preparation;
}

function landmarkValues(frames: Frame[]) {
  if (frames.length === 0) throw new Error("Local inference needs frames");
  const values = new Float32Array(frames.length * 162);
  for (let row = 0; row < frames.length; row += 1) {
    const frame = frames[row];
    if (!frame || frame.length !== 162) {
      throw new Error("Local inference received invalid landmarks");
    }
    const offset = row * 162;
    for (let column = 0; column < frame.length; column += 1) {
      const value = frame[column] ?? Number.NaN;
      values[offset + column] = Number.isFinite(value)
        ? value
        : missingLandmark;
    }
  }
  return values;
}

async function createSession() {
  const baseOptions: ort.InferenceSession.SessionOptions = {
    externalData: [{ data: modelDataURL, path: modelDataPath }],
    graphOptimizationLevel: "all",
  };
  if ("gpu" in navigator) {
    try {
      return await ort.InferenceSession.create(modelURL, {
        ...baseOptions,
        executionProviders: ["webgpu"],
      });
    } catch {
      // WASM keeps local mode available in browsers without WebGPU support.
    }
  }
  return ort.InferenceSession.create(modelURL, {
    ...baseOptions,
    executionProviders: ["wasm"],
  });
}

function frameConfidence(values: Float32Array, rows: number, columns: number) {
  let total = 0;
  for (let row = 0; row < rows; row += 1) {
    let maximum = Number.NEGATIVE_INFINITY;
    for (let column = 0; column < columns; column += 1) {
      maximum = Math.max(maximum, values[row * columns + column]!);
    }
    total += Math.exp(maximum);
  }
  return Math.min(1, Math.max(0, total / rows));
}
