import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CaptureKind,
  CaptureRequest,
  CaptureSession,
  CaptureState,
} from "@/types/capture";

const stopStream = (stream: MediaStream) => {
  stream.getTracks().forEach((track) => track.stop());
};

async function openStream(request: CaptureRequest) {
  const { kind } = request;
  if (kind === "screen") {
    return navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: true,
    });
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 60, max: 120 },
      ...(request.cameraId
        ? { deviceId: { exact: request.cameraId } }
        : { facingMode: "user" }),
    },
  });

  const [track] = stream.getVideoTracks();
  const maxFrameRate = track.getCapabilities().frameRate?.max;
  if (maxFrameRate) {
    await track.applyConstraints({
      frameRate: { ideal: maxFrameRate, max: maxFrameRate },
    });
  }

  return stream;
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
  const [cameraId, setCameraIdState] = useState<string | null>(null);
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

        if (request.kind === "camera" && request.cameraId === null) {
          const resolvedCameraId = next
            .getVideoTracks()[0]
            .getSettings().deviceId;
          if (resolvedCameraId) setCameraIdState(resolvedCameraId);
        }

        next.getVideoTracks().forEach((track) => {
          track.onended = () => setRequest(null);
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRequest(null);
        setError(captureErrorMessage(request.kind, err));
      });

    return () => {
      cancelled = true;
      active?.getVideoTracks().forEach((track) => {
        track.onended = null;
      });
      if (active) stopStream(active);
    };
  }, [request]);

  const start = useCallback(
    (kind: CaptureKind) => {
      setError(null);
      setRequest(kind === "camera" ? { kind, cameraId } : { kind });
    },
    [cameraId],
  );

  const stop = useCallback(() => {
    setRequest(null);
    setError(null);
  }, []);

  const setCameraId = useCallback((next: string | null) => {
    setCameraIdState(next);
    setRequest((current) =>
      current?.kind === "camera" ? { ...current, cameraId: next } : current,
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

  return { state, cameraId, start, stop, setCameraId };
}
