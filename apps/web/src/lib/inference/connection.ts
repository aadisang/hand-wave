import type { InferenceMode } from "@/types/inference";

export type InferenceConnectionStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "error";

const statuses: Record<InferenceMode, InferenceConnectionStatus> = {
  remote: "idle",
  device: "idle",
};
const listeners: Record<InferenceMode, Set<() => void>> = {
  remote: new Set(),
  device: new Set(),
};

export function getInferenceConnectionStatus(mode: InferenceMode) {
  return statuses[mode];
}

export function subscribeInferenceConnection(
  mode: InferenceMode,
  listener: () => void,
) {
  listeners[mode].add(listener);
  return () => {
    listeners[mode].delete(listener);
  };
}

export function setInferenceConnectionStatus(
  mode: InferenceMode,
  next: InferenceConnectionStatus,
) {
  if (statuses[mode] === next) return;
  statuses[mode] = next;
  listeners[mode].forEach((listener) => listener());
}
