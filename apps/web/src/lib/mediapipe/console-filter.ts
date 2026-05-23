const mutedMessages = [
  "gl_context.cc:407] GL version:",
  "gl_context.cc:1118] OpenGL error checking is disabled",
  "Graph successfully started running.",
  "landmark_projection_calculator.cc:81] Using NORM_RECT without IMAGE_DIMENSIONS",
] as const;

const installedKey = Symbol.for("handwave.mediapipeConsoleFilterInstalled");

export function installMediapipeConsoleFilter(): void {
  const globalState = globalThis as Record<PropertyKey, unknown>;
  if (globalState[installedKey]) return;
  globalState[installedKey] = true;

  const patch = (method: (...data: unknown[]) => void) => {
    return (...data: unknown[]) => {
      const message = data.map(String).join(" ");
      if (mutedMessages.some((needle) => message.includes(needle))) return;
      method(...data);
    };
  };

  globalThis.console.info = patch(
    globalThis.console.info.bind(globalThis.console),
  );
  globalThis.console.warn = patch(
    globalThis.console.warn.bind(globalThis.console),
  );
  globalThis.console.error = patch(
    globalThis.console.error.bind(globalThis.console),
  );
}
