export type InferenceConnectionStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "error";

let status: InferenceConnectionStatus = "idle";
const listeners = new Set<() => void>();

export function getInferenceConnectionStatus() {
  return status;
}

export function subscribeInferenceConnection(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setInferenceConnectionStatus(next: InferenceConnectionStatus) {
  if (status === next) return;
  status = next;
  listeners.forEach((listener) => listener());
}
