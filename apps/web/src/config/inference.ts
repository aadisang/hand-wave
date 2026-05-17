export const inferenceConfig = {
  session: {
    maxWindowFrames: 128,
    minStableFrames: 3,
  },
  stream: {
    targetFps: 24,
    minDecodeFrames: 24,
    strideFrames: 4,
    idleFramesToFinalize: 16,
    finalizedDisplayMs: 1_200,
    motionThreshold: 0.003,
  },
  mediapipe: {
    smoothing: {
      hand: {
        frequency: 60,
        minCutoff: 18,
        beta: 1.8,
        derivativeCutoff: 1.5,
      },
      pose: {
        frequency: 60,
        minCutoff: 6,
        beta: 0.8,
        derivativeCutoff: 1.5,
      },
    },
  },
} as const;
