export type CaptureKind = "camera" | "screen";

export type CaptureRequest =
  | { kind: "camera"; cameraId: string | null }
  | { kind: "screen" };

export type CaptureState =
  | { status: "idle" }
  | ({ status: "starting" } & CaptureRequest)
  | ({
      status: "live";
      stream: MediaStream;
    } & CaptureRequest)
  | { status: "error"; message: string };

export type CaptureSession = {
  state: CaptureState;
  cameraId: string | null;
  start: (kind: CaptureKind) => void;
  stop: () => void;
  setCameraId: (cameraId: string | null) => void;
};
