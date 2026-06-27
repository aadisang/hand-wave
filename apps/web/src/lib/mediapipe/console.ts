const muted = [
  "gl_context.cc:407] GL version:",
  "gl_context.cc:1118] OpenGL error checking is disabled",
  "Graph successfully started running.",
  "landmark_projection_calculator.cc:81] Using NORM_RECT without IMAGE_DIMENSIONS",
] as const;

const key = Symbol.for("handwave.mediapipeConsoleFilterInstalled");

export function filterConsole(): void {
  const state = globalThis as Record<PropertyKey, unknown>;
  if (state[key]) return;
  state[key] = true;

  const patch = (method: (...data: unknown[]) => void) => {
    return (...data: unknown[]) => {
      const message = data.map(String).join(" ");
      if (muted.some((needle) => message.includes(needle))) return;
      method(...data);
    };
  };

  globalThis.console.info = patch(
    globalThis.console.info.bind(globalThis.console),
  );
  globalThis.console.log = patch(
    globalThis.console.log.bind(globalThis.console),
  );
  globalThis.console.debug = patch(
    globalThis.console.debug.bind(globalThis.console),
  );
  globalThis.console.warn = patch(
    globalThis.console.warn.bind(globalThis.console),
  );
  globalThis.console.error = patch(
    globalThis.console.error.bind(globalThis.console),
  );
}
