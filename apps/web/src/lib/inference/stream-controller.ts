import {
  appendInferenceFrames,
  createInferenceSession,
  deleteInferenceSession,
  resetInferenceSession,
  runInference,
} from "@/lib/inference/client";
import {
  acceptedFrameTime,
  createInferenceArbitrator,
  type DecodeTrace,
  type EndpointReason,
  finalizedDisplayMs,
  type FinalizeTrace,
  frameMotion,
  idleFramesToFinalize,
  lostFramesToFinalize,
  minDecodeFrames,
  motionThreshold,
  strideFrames,
} from "@/lib/inference/arbitration";
import { useDetectionsStore } from "@/stores/detections-store";
import { useDevStore } from "@/stores/dev-store";
import type { LandmarkFrame } from "@/types/inference";

export class InferenceStreamController {
  private sessionId = "";
  private arbitrator = createInferenceArbitrator();
  private queuedFrames: LandmarkFrame[] = [];
  private framesSeen = 0;
  private inFlight = false;
  private lastFrame: LandmarkFrame | null = null;
  private idleFrames = 0;
  private hasMoved = false;
  private endpointed = false;
  private generation = 0;
  private lastMotion = 0;
  private missingFrames = 0;
  private lastAcceptedFrameMs = 0;
  private clearPredictionTimeout: number | null = null;
  private disposed = false;

  async start() {
    const sessionId = await runInference(createInferenceSession());
    if (this.disposed) {
      void runInference(deleteInferenceSession(sessionId));
      return;
    }
    this.sessionId = sessionId;
  }

  dispose() {
    this.disposed = true;
    const sessionId = this.sessionId;
    this.sessionId = "";
    this.generation += 1;
    this.clearDisplayReset();
    useDetectionsStore.getState().setCurrentPrediction(null);
    this.resetSegment();
    this.arbitrator.reset();
    if (sessionId) void runInference(deleteInferenceSession(sessionId));
  }

  accept(frame: LandmarkFrame | null) {
    if (!this.sessionId) return;
    if (!frame) {
      if (this.endpointed) return;
      if (!this.hasMoved || this.framesSeen < minDecodeFrames) {
        this.clearDisplayReset();
        useDetectionsStore.getState().setCurrentPrediction(null);
        this.resetSegment();
        this.arbitrator.reset();
        return;
      }

      this.missingFrames += 1;
      this.idleFrames += 1;
      if (
        this.missingFrames >= lostFramesToFinalize ||
        this.idleFrames >= idleFramesToFinalize
      ) {
        this.finalize("landmark-lost");
      }
      return;
    }

    this.missingFrames = 0;
    const acceptedAt = acceptedFrameTime(this.lastAcceptedFrameMs);
    if (acceptedAt === null) return;
    this.lastAcceptedFrameMs = acceptedAt;

    this.updateMotion(frame);
    if (this.endpointed) return;

    this.queuedFrames.push(frame);
    this.framesSeen += 1;

    if (this.idleFrames >= idleFramesToFinalize) {
      this.finalize("idle");
      return;
    }

    if (this.framesSeen < minDecodeFrames) return;
    if (this.framesSeen % strideFrames !== 0 || this.inFlight) return;

    void this.decode(this.queuedFrames.splice(0), this.idleFrames);
  }

  private resetSegment() {
    this.queuedFrames = [];
    this.framesSeen = 0;
    this.lastFrame = null;
    this.lastAcceptedFrameMs = 0;
    this.idleFrames = 0;
    this.hasMoved = false;
    this.missingFrames = 0;
  }

  private clearDisplayReset() {
    if (this.clearPredictionTimeout === null) return;
    window.clearTimeout(this.clearPredictionTimeout);
    this.clearPredictionTimeout = null;
  }

  private updateMotion(frame: LandmarkFrame) {
    const motion = frameMotion(this.lastFrame, frame);
    this.lastMotion = motion;
    this.lastFrame = frame;

    if (motion >= motionThreshold) {
      this.clearDisplayReset();
      if (this.endpointed) this.resetSegment();
      this.endpointed = false;
      this.hasMoved = true;
      this.idleFrames = 0;
    } else if (this.hasMoved) {
      this.idleFrames += 1;
    }
  }

  private finalize(endpointReason: EndpointReason) {
    const segmentFrames = this.framesSeen;
    const finalized = this.arbitrator.finalize({
      endpointReason,
      idleFrames: this.idleFrames,
      missingFrames: this.missingFrames,
      segmentFrames,
    });
    this.clearDisplayReset();
    if (finalized.displayPrediction) {
      useDetectionsStore
        .getState()
        .setCurrentPrediction(finalized.displayPrediction);
      this.clearPredictionTimeout = window.setTimeout(() => {
        useDetectionsStore.getState().setCurrentPrediction(null);
        this.clearPredictionTimeout = null;
      }, finalizedDisplayMs);
    } else {
      useDetectionsStore.getState().setCurrentPrediction(null);
    }

    pushFinalizeTrace(finalized.trace);
    this.endpointed = true;
    this.generation += 1;
    this.arbitrator.reset();
    this.resetSegment();
    void runInference(resetInferenceSession(this.sessionId));
  }

  private async decode(frames: LandmarkFrame[], idleFrames: number) {
    const generation = this.generation;
    const sessionId = this.sessionId;
    this.inFlight = true;
    const startedAt = performance.now();

    try {
      const response = await runInference(
        appendInferenceFrames(sessionId, frames),
      );
      if (generation !== this.generation) return;

      const update = this.arbitrator.accept(response, {
        latencyMs: performance.now() - startedAt,
        idleFrames,
        motion: this.lastMotion,
      });
      if (update.displayPrediction) {
        useDetectionsStore
          .getState()
          .setCurrentPrediction(update.displayPrediction);
      }
      pushDecodeTrace(update.trace);
    } finally {
      this.inFlight = false;
    }
  }
}

function pushDecodeTrace(trace: DecodeTrace) {
  useDevStore.getState().pushTrace({
    ...trace,
    type: "decode",
    at: new Date().toISOString(),
  });
}

function pushFinalizeTrace(trace: FinalizeTrace) {
  useDevStore.getState().pushTrace({
    ...trace,
    type: "finalize",
    at: new Date().toISOString(),
  });
}
