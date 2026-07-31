import { FilesetResolver } from "@mediapipe/tasks-vision";
import { wasmPath } from "./assets";

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

export async function loadWorkerVisionFileset(): Promise<WasmFileset> {
  const fileset = await FilesetResolver.forVisionTasks(wasmPath);
  await installModuleFactory(fileset.wasmLoaderPath);
  return { ...fileset, wasmLoaderPath: "" };
}

async function installModuleFactory(loaderPath: string) {
  const source = await loadScript(loaderPath);
  // MediaPipe's task runner expects this factory on the worker global. Vite
  // module workers do not get that from MediaPipe's internal script helper.
  (0, eval)(`${source}\n;globalThis.ModuleFactory = ModuleFactory;`);
  if (!("ModuleFactory" in globalThis)) {
    throw new Error("MediaPipe WASM module factory did not install");
  }
}

function loadScript(url: string) {
  return fetch(url).then((response) => {
    if (!response.ok) {
      throw new Error(
        `Could not load MediaPipe WASM loader: ${response.status}`,
      );
    }
    return response.text();
  });
}
