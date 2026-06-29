import { useCallback, useEffect, useMemo, useState } from "react";
import { cfg } from "@hand-wave/contract";
import type {
  CaptureKind,
  CaptureRequest,
  CaptureSession,
  CaptureState,
} from "@/types/capture";

const stopStream = (stream: MediaStream) => {
  stream.getTracks().forEach((track) => track.stop());
};

const preferredFrameRate = 240;
const cameraFrameRate = { ideal: preferredFrameRate, max: preferredFrameRate };
const screenFrameRate = { ideal: cfg.stream.fps, max: cfg.stream.fps };

function reportedFrameRate(stream: MediaStream, fallback = cfg.stream.fps) {
  return stream.getVideoTracks()[0]?.getSettings().frameRate ?? fallback;
}

async function requestHighestFrameRate(stream: MediaStream) {
  const [track] = stream.getVideoTracks();
  const maxFrameRate = track?.getCapabilities().frameRate?.max;
  if (maxFrameRate) {
    await track.applyConstraints({
      frameRate: { ideal: maxFrameRate, max: maxFrameRate },
    });
  }
  return reportedFrameRate(stream, maxFrameRate ?? cfg.stream.fps);
}

async function openStream(request: CaptureRequest) {
  const { kind } = request;
  if (kind === "screen") {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: { frameRate: screenFrameRate },
    });
    return { stream, frameRate: reportedFrameRate(stream) };
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: cameraFrameRate,
      ...(request.cameraId
        ? { deviceId: { exact: request.cameraId } }
        : { facingMode: "user" }),
    },
  });

  return { stream, frameRate: await requestHighestFrameRate(stream) };
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
  const [frameRate, setFrameRate] = useState<number | null>(null);
  const [cameraId, setCameraIdState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request) {
      setStream(null);
      setFrameRate(null);
      return;
    }

    let cancelled = false;
    let active: MediaStream | null = null;

    setStream(null);
    setFrameRate(null);
    void openStream(request)
      .then((next) => {
        if (cancelled) {
          stopStream(next.stream);
          return;
        }

        active = next.stream;
        setError(null);
        setStream(next.stream);
        setFrameRate(next.frameRate);

        if (request.kind === "camera" && request.cameraId === null) {
          const resolvedCameraId = next.stream
            .getVideoTracks()[0]
            .getSettings().deviceId;
          if (resolvedCameraId) setCameraIdState(resolvedCameraId);
        }

        next.stream.getVideoTracks().forEach((track) => {
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

    return stream && frameRate
      ? { status: "live", ...request, frameRate, stream }
      : { status: "starting", ...request };
  }, [error, frameRate, request, stream]);

  return useMemo(
    () => ({ state, cameraId, start, stop, setCameraId }),
    [cameraId, setCameraId, start, state, stop],
  );
}
