import { transfer, wrap, type Remote } from "comlink";
import { useEvent } from "@reactuses/core";
import { useEffect, type RefObject } from "react";
import { useDevStore } from "@/stores/dev-store";
import type { CaptureKind } from "@/types/capture";
import type {
  FrameSink,
  HandDetectorApi,
  HandFrame,
  PoseDetectorApi,
} from "@/types/landmarks";

type Detectors = {
  hand: Remote<HandDetectorApi>;
  pose: Remote<PoseDetectorApi>;
};

let ready: Promise<Detectors> | null = null;
let lastHandTs = 0;
let lastPoseTs = 0;
const maxDetectorDimension = 640;

function load() {
  const handWorker = new Worker(
    new URL("../lib/mediapipe/detector-worker.ts", import.meta.url),
    { type: "module" },
  );
  const poseWorker = new Worker(
    new URL("../lib/mediapipe/pose-worker.ts", import.meta.url),
    { type: "module" },
  );
  const detectors = {
    hand: wrap<HandDetectorApi>(handWorker),
    pose: wrap<PoseDetectorApi>(poseWorker),
  };
  return Promise.all([detectors.hand.warm(), detectors.pose.warm()]).then(
    () => detectors,
    (error) => {
      handWorker.terminate();
      poseWorker.terminate();
      throw error;
    },
  );
}

export function preloadLandmarker() {
  ready ??= load().catch((error) => {
    ready = null;
    console.error("Could not load MediaPipe landmark detection", error);
    throw error;
  });
  return ready;
}

function nextHandTimestamp(timestamp: number) {
  lastHandTs = Math.max(timestamp, lastHandTs + 1);
  return lastHandTs;
}

function nextPoseTimestamp(timestamp: number) {
  lastPoseTs = Math.max(timestamp, lastPoseTs + 1);
  return lastPoseTs;
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
    let instance: Detectors | null = null;
    let loading = false;
    let handInFlight = false;
    let poseInFlight = false;
    let handFailureReported = false;
    let poseFailureReported = false;
    let latestPose: HandFrame["poseLandmarks"] = [];
    let lastPresentedFrames = 0;
    useDevStore.getState().resetRates();

    const ensureLoaded = () => {
      if (loading || cancelled) return;
      loading = true;
      void preloadLandmarker()
        .then((loaded) => {
          if (cancelled) return;
          instance = loaded;
          rafId = requestAnimationFrame(waitForVideo);
        })
        .catch(() => undefined)
        .finally(() => {
          loading = false;
        });
    };

    const readHand = async (
      loaded: Remote<HandDetectorApi>,
      video: HTMLVideoElement,
      timestamp: number,
    ) => {
      handInFlight = true;
      const startedAt = performance.now();
      try {
        const image = await createDetectorImage(video);
        if (cancelled) {
          image.close();
          return;
        }
        const result = await loaded.detect(
          transfer({ image, timestamp }, [image]),
        );
        if (!cancelled) {
          handFailureReported = false;
          emitFrame(
            { ...result.frame, poseLandmarks: latestPose },
            {
              detectorRoundTripMs: performance.now() - startedAt,
              inferenceMs: result.inferenceMs,
            },
          );
        }
      } catch (error) {
        if (!cancelled && !handFailureReported) {
          handFailureReported = true;
          console.error("Hand landmark detection failed", error);
        }
      } finally {
        handInFlight = false;
      }
    };

    const readPose = async (
      loaded: Remote<PoseDetectorApi>,
      video: HTMLVideoElement,
      timestamp: number,
    ) => {
      poseInFlight = true;
      const startedAt = performance.now();
      try {
        const image = await createDetectorImage(video);
        if (cancelled) {
          image.close();
          return;
        }
        const result = await loaded.detect(
          transfer({ image, timestamp }, [image]),
        );
        if (!cancelled) {
          poseFailureReported = false;
          latestPose = result.poseLandmarks;
          const dev = useDevStore.getState();
          if (dev.enabled) {
            const completedAt = performance.now();
            dev.pushPose(completedAt, {
              detectorRoundTripMs: completedAt - startedAt,
              inferenceMs: result.inferenceMs,
            });
          }
        }
      } catch (error) {
        if (!cancelled && !poseFailureReported) {
          poseFailureReported = true;
          console.error("Pose landmark detection failed", error);
        }
      } finally {
        poseInFlight = false;
      }
    };

    const tickVideoFrame: VideoFrameRequestCallback = (now, metadata) => {
      if (cancelled) return;

      const dev = useDevStore.getState();
      if (dev.enabled) {
        const presentedFrames = metadata.presentedFrames;
        const frameCount =
          lastPresentedFrames > 0 && presentedFrames > lastPresentedFrames
            ? presentedFrames - lastPresentedFrames
            : 1;
        lastPresentedFrames = presentedFrames;
        dev.pushPresentedFrames(frameCount, now);
      }

      const video = videoRef.current;
      if (!video) return;
      if (instance && video.readyState >= 2) {
        if (!handInFlight) {
          void readHand(instance.hand, video, nextHandTimestamp(now));
        }
        if (!poseInFlight) {
          void readPose(instance.pose, video, nextPoseTimestamp(now));
        }
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
      useDevStore.getState().resetRates();
      void instance?.hand.reset();
      void instance?.pose.reset();
      if (rafId) cancelAnimationFrame(rafId);
      if (videoFrameId && frameCallbackVideo) {
        frameCallbackVideo.cancelVideoFrameCallback(videoFrameId);
      }
    };
  }, [videoRef, captureKind, emitFrame]);
}

function createDetectorImage(video: HTMLVideoElement) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  const largest = Math.max(width, height);
  if (!largest || largest <= maxDetectorDimension) {
    return createImageBitmap(video);
  }

  const scale = maxDetectorDimension / largest;
  return createImageBitmap(video, {
    resizeWidth: Math.max(1, Math.round(width * scale)),
    resizeHeight: Math.max(1, Math.round(height * scale)),
    resizeQuality: "low",
  });
}
