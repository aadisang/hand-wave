import { transfer, wrap, type Remote } from "comlink";
import { useEvent } from "@reactuses/core";
import { useEffect, type RefObject } from "react";
import type { CaptureKind } from "@/types/capture";
import type { FrameSink, LandmarkDetectorApi } from "@/types/landmarks";

type Detector = Remote<LandmarkDetectorApi>;

let ready: Promise<Detector> | null = null;
let lastTs = 0;

function load() {
  const worker = new Worker(
    new URL("../lib/mediapipe/detector-worker.ts", import.meta.url),
    { type: "module" },
  );
  const detector = wrap<LandmarkDetectorApi>(worker);
  return detector.warm().then(() => detector);
}

export function preloadLandmarker() {
  ready ??= load();
  return ready;
}

function nextTs() {
  lastTs = Math.max(performance.now(), lastTs + 1);
  return lastTs;
}

export function useHandLandmarks(
  videoRef: RefObject<HTMLVideoElement | null>,
  captureKind: CaptureKind,
  onFrame: FrameSink,
): void {
  const emitFrame = useEvent(onFrame);

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let videoFrameId = 0;
    let frameCallbackVideo: HTMLVideoElement | null = null;
    let instance: Detector | null = null;
    let loading = false;
    let inFlight = false;

    const ensureLoaded = () => {
      if (loading || cancelled) return;
      loading = true;
      void preloadLandmarker()
        .then((loaded) => {
          if (cancelled) return;
          instance = loaded;
          rafId = requestAnimationFrame(waitForVideo);
        })
        .finally(() => {
          loading = false;
        });
    };

    const read = async (
      loaded: Detector,
      video: HTMLVideoElement,
      timestamp: number,
    ) => {
      inFlight = true;
      try {
        const image = await createImageBitmap(video);
        if (cancelled) {
          image.close();
          return;
        }
        const result = await loaded.detect(
          transfer({ image, timestamp, captureKind }, [image]),
        );
        if (!cancelled) emitFrame(result.frame, result.inferenceMs);
      } finally {
        inFlight = false;
      }
    };

    const tickVideoFrame: VideoFrameRequestCallback = () => {
      if (cancelled) return;

      const video = videoRef.current;
      if (!video) return;
      if (instance && video.readyState >= 2 && !inFlight) {
        void read(instance, video, nextTs());
      }
      videoFrameId = video.requestVideoFrameCallback(tickVideoFrame);
    };

    const waitForVideo = () => {
      if (cancelled) return;

      const video = videoRef.current;
      if (!instance || !video || video.readyState < 2) {
        rafId = requestAnimationFrame(waitForVideo);
        return;
      }

      frameCallbackVideo = video;
      videoFrameId = video.requestVideoFrameCallback(tickVideoFrame);
    };

    ensureLoaded();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (videoFrameId && frameCallbackVideo) {
        frameCallbackVideo.cancelVideoFrameCallback(videoFrameId);
      }
    };
  }, [videoRef, captureKind, emitFrame]);
}
