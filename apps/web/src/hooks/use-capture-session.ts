import { useCallback, useEffect, useMemo, useState } from "react";

export type CaptureKind = "camera" | "screen";

type CaptureRequest = {
  kind: CaptureKind;
  deviceId?: string;
};

export type CaptureState =
  | { status: "idle" }
  | { status: "starting"; kind: CaptureKind; deviceId?: string }
  | {
      status: "live";
      kind: CaptureKind;
      deviceId?: string;
      stream: MediaStream;
    }
  | { status: "error"; message: string };

export type CaptureSession = {
  state: CaptureState;
  deviceId: string | undefined;
  start: (kind: CaptureKind) => void;
  stop: () => void;
  setDeviceId: (deviceId: string | undefined) => void;
};

const stopStream = (stream: MediaStream) => {
  stream.getTracks().forEach((track) => track.stop());
};

async function openStream({ kind, deviceId }: CaptureRequest) {
  if (kind === "screen") {
    return navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: true,
    });
  }

  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, min: 24, max: 30 },
      ...(deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: "user" }),
    },
  });
}

function captureErrorMessage(kind: CaptureKind, error: unknown) {
  const denied =
    error instanceof DOMException && error.name === "NotAllowedError";

  if (kind === "camera") {
    return denied
      ? "Camera access was denied."
      : "The camera could not be started.";
  }

  return denied
    ? "Screen sharing was cancelled or denied."
    : "Screen sharing could not be started.";
}

export function useCaptureSession(): CaptureSession {
  const [request, setRequest] = useState<CaptureRequest | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [deviceId, setDeviceIdState] = useState<string>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request) {
      setStream(null);
      return;
    }

    let cancelled = false;
    let active: MediaStream | null = null;

    setStream(null);
    void openStream(request)
      .then((next) => {
        if (cancelled) {
          stopStream(next);
          return;
        }

        active = next;
        setError(null);
        setStream(next);

        if (request.kind === "camera" && !request.deviceId) {
          const trackDeviceId = next
            .getVideoTracks()[0]
            ?.getSettings().deviceId;
          if (trackDeviceId) setDeviceIdState(trackDeviceId);
        }

        next.getVideoTracks().forEach((track) =>
          track.addEventListener("ended", () => setRequest(null), {
            once: true,
          }),
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRequest(null);
        setError(captureErrorMessage(request.kind, err));
      });

    return () => {
      cancelled = true;
      if (active) stopStream(active);
    };
  }, [request]);

  const start = useCallback(
    (kind: CaptureKind) => {
      setError(null);
      setRequest({ kind, deviceId: kind === "camera" ? deviceId : undefined });
    },
    [deviceId],
  );

  const stop = useCallback(() => {
    setRequest(null);
    setError(null);
  }, []);

  const setDeviceId = useCallback((next: string | undefined) => {
    setDeviceIdState(next);
    setRequest((current) =>
      current?.kind === "camera" ? { ...current, deviceId: next } : current,
    );
  }, []);

  const state = useMemo<CaptureState>(() => {
    if (!request) {
      return error ? { status: "error", message: error } : { status: "idle" };
    }

    return stream
      ? { status: "live", ...request, stream }
      : { status: "starting", ...request };
  }, [error, request, stream]);

  return { state, deviceId, start, stop, setDeviceId };
}
