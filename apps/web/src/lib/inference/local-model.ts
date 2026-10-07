import { wrap, type Remote } from "comlink";
import type { Emission, Frame } from "@/types/inference";
import type { LocalModelWorker } from "./local-model-types";

let worker: Worker | null = null;
let model: Remote<LocalModelWorker> | null = null;

export async function prepareLocalModel() {
  await getModel().prepare();
}

export async function inferLocally(frames: Frame[]): Promise<Emission> {
  const output = await getModel().infer(frames);
  const values: number[][] = [];
  for (let row = 0; row < output.rows; row += 1) {
    const start = row * output.columns;
    values.push(
      Array.from(output.values.subarray(start, start + output.columns)),
    );
  }
  return { values, frame_confidence: output.frameConfidence };
}

function getModel() {
  if (model) return model;
  if (typeof Worker === "undefined") {
    throw new Error("Local inference is unavailable outside a browser");
  }
  worker = new Worker(new URL("./local-model-worker.ts", import.meta.url), {
    name: "handwave-local-model",
    type: "module",
  });
  model = wrap<LocalModelWorker>(worker);
  return model;
}
