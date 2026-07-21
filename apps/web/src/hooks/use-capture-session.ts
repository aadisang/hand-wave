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
  try {
    return { stream, frameRate: await requestHighestFrameRate(stream) };
  } catch (error) {
    stopStream(stream);
    throw error;
  }
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
  type CaptureMachine =
    | { intent: null; phase: "idle" }
    | { intent: null; phase: "error"; message: string }
    | { intent: CaptureRequest; phase: "starting" }
    | {
        intent: CaptureRequest;
        phase: "live";
        stream: MediaStream;
        frameRate: number;
      };

  const [machine, setMachine] = useState<CaptureMachine>({
    intent: null,
    phase: "idle",
  });
  const [cameraId, setCameraIdState] = useState<string | null>(null);
  const intent = machine.intent;

  useEffect(() => {
    if (!intent) return;

    let cancelled = false;
    let active: MediaStream | null = null;

    void openStream(intent)
      .then((next) => {
        if (cancelled) {
          stopStream(next.stream);
          return;
        }

        active = next.stream;
        setMachine((current) =>
          current.intent === intent
            ? {
                intent,
                phase: "live",
                stream: next.stream,
                frameRate: next.frameRate,
              }
            : current,
        );

        if (intent.kind === "camera" && intent.cameraId === null) {
          const resolvedCameraId = next.stream
            .getVideoTracks()[0]
            .getSettings().deviceId;
          if (resolvedCameraId) setCameraIdState(resolvedCameraId);
        }

        next.stream.getVideoTracks().forEach((track) => {
          track.onended = () => setMachine({ intent: null, phase: "idle" });
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMachine({
          intent: null,
          phase: "error",
          message: captureErrorMessage(intent.kind, err),
        });
      });

    return () => {
      cancelled = true;
      active?.getVideoTracks().forEach((track) => {
        track.onended = null;
      });
      if (active) stopStream(active);
    };
  }, [intent]);

  const start = useCallback(
    (kind: CaptureKind) => {
      setMachine({
        intent: kind === "camera" ? { kind, cameraId } : { kind },
        phase: "starting",
      });
    },
    [cameraId],
  );

  const stop = useCallback(() => {
    setMachine({ intent: null, phase: "idle" });
  }, []);

  const setCameraId = useCallback((next: string | null) => {
    setCameraIdState(next);
    setMachine((current) =>
      current.intent?.kind === "camera"
        ? {
            intent: { ...current.intent, cameraId: next },
            phase: "starting",
          }
        : current,
    );
  }, []);

  const state = useMemo<CaptureState>(() => {
    if (machine.phase === "idle") return { status: "idle" };
    if (machine.phase === "error") {
      return { status: "error", message: machine.message };
    }
    if (machine.phase === "starting") {
      return { status: "starting", ...machine.intent };
    }
    return {
      status: "live",
      ...machine.intent,
      frameRate: machine.frameRate,
      stream: machine.stream,
    };
  }, [machine]);

  return useMemo(
    () => ({ state, cameraId, start, stop, setCameraId }),
    [cameraId, setCameraId, start, state, stop],
  );
}
