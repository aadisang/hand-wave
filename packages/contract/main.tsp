import "@typespec/http";
import "@typespec/json-schema";
import "@typespec/openapi3";

using TypeSpec.Http;
using TypeSpec.JsonSchema;

@service(#{
  title: "Hand Wave Inference API",
})
@server("http://localhost:8000")
@jsonSchema("https://hand-wave.local/schemas/")
namespace HandWave.Inference;

@minItems(162)
@maxItems(162)
model LandmarkFrame is float64[];

model Prediction {
  label: string;

  @minValue(0)
  @maxValue(1)
  confidence: float64;

  logit_score?: float64 | null;
  lm_score?: float64 | null;
  raw_label?: string | null;
}

model Span {
  start_frame: int32;
  end_frame: int32;
  text: string;
}

model PredictIn {
  @minItems(1)
  @maxItems(512)
  frames: LandmarkFrame[];
}

model PredictOut {
  prediction: Prediction;
  alternatives: Prediction[];
  spans: Span[];
  greedy_text: string;

  @minValue(0)
  @maxValue(1)
  blank_ratio: float64;

  @minValue(0)
  @maxValue(1)
  tail_blank_ratio: float64;

  tail_blank_frames: int32;
  partial_text: string;
  stable_text: string;
}

model HealthOut {
  ok: boolean;
}

enum RecognitionSource {
  endpoint: "endpoint",
  beam: "beam",
  dominant: "dominant",
  alternative: "alternative",
  majority: "majority",
}

model RecognitionScored {
  prediction: Prediction;
  score: float64;
  source: RecognitionSource;
  lm_score?: float64 | null;
  model_agrees: boolean;

  @minValue(0)
  streak: int32;
}

model RecognitionCount {
  text: string;

  @minValue(0)
  count: int32;
}

model RecognitionState {
  display?: RecognitionScored | null;
  final_candidate?: RecognitionScored | null;
  alternative_candidate?: RecognitionScored | null;
  selected_text: string;

  @minValue(0)
  selected_streak: int32;

  @minValue(0)
  display_misses: int32;
  counts: RecognitionCount[];
  alternative_counts?: RecognitionCount[] | null;

  @minValue(0)
  alternative_misses?: int32;
}

enum EndpointReason {
  idle: "idle",
  landmarkLost: "landmark-lost",
}

model RecognitionContext {
  @minValue(0)
  idle_frames: int32;

  @minValue(0)
  missing_frames: int32;

  @minValue(0)
  segment_frames: int32;

  @minValue(0)
  motion: float64;

  endpoint_reason?: EndpointReason | null;
}

model DecodeTrace {
  buffered_frames: int32;
  input_text: string;
  display_text: string;
  idle_frames: int32;
  motion: float64;
  latency_ms: float64;
}

model FinalizeTrace {
  text: string;
  confidence: float64;
  committed: boolean;
  endpoint_reason: EndpointReason;
  segment_frames: int32;
}

model RecognitionTrace {
  prediction?: PredictOut | null;
  decode?: DecodeTrace | null;
  finalize?: FinalizeTrace | null;
}

model RecognizeIn {
  @maxItems(512)
  frames?: LandmarkFrame[];

  state?: RecognitionState | null;
  context: RecognitionContext;
  finalize?: boolean;
}

model RecognizeOut {
  state: RecognitionState;
  display_prediction?: Prediction | null;
  committed: boolean;
  trace: RecognitionTrace;
}

model StreamEnvelope {
  @minValue(0)
  sequence: int32;

  @minValue(1)
  @maxValue(1)
  protocol: int32;
}

model StreamPingRequest extends StreamEnvelope {
  type: "ping";
}

model StreamResetRequest extends StreamEnvelope {
  type: "reset";
}

model StreamRecognizeRequest extends StreamEnvelope {
  type: "recognize";

  @maxItems(192)
  frames?: LandmarkFrame[];

  state?: RecognitionState | null;
  context: RecognitionContext;
  finalize?: boolean;
}

union StreamRequest {
  ping: StreamPingRequest,
  reset: StreamResetRequest,
  recognize: StreamRecognizeRequest,
}

model StreamPongResponse extends StreamEnvelope {
  type: "pong";
}

model StreamResetResponse extends StreamEnvelope {
  type: "reset";
}

model StreamResultResponse extends StreamEnvelope {
  type: "result";
  result: RecognizeOut;
}

model StreamErrorResponse extends StreamEnvelope {
  type: "error";
  detail: string;
}

union StreamResponse {
  pong: StreamPongResponse,
  reset: StreamResetResponse,
  result: StreamResultResponse,
  error: StreamErrorResponse,
}

@jsonSchema("config.schema.json")
model Config {
  decode: DecodeCfg;
  stream: StreamCfg;
  mp: MpCfg;
  inference: InferenceCfg;
}

model DecodeCfg {
  @minValue(8)
  @maxValue(512)
  window: int32;
}

model StreamCfg {
  @minValue(1)
  fps: int32;

  @minValue(1)
  min: int32;

  @minValue(1)
  stride: int32;

  @minValue(1)
  idle: int32;

  @minValue(1)
  lost: int32;

  @minValue(1)
  holdMs: int32;

  @minValue(0)
  motion: float64;
}

model MpCfg {
  smooth: SmoothSet;
}

model SmoothSet {
  hand: SmoothCfg;
  pose: SmoothCfg;
}

model SmoothCfg {
  @minValue(0)
  freq: float64;

  @minValue(0)
  cutoff: float64;

  @minValue(0)
  beta: float64;

  @minValue(0)
  dCutoff: float64;
}

model InferenceCfg {
  ctc: CtcCfg;
  smooth: SmoothGateCfg;
}

model CtcCfg {
  @minValue(0)
  alpha: float64;

  beta: float64;
  unkScoreOffset: float64;

  @minValue(1)
  beamWidth: int32;

  beamPruneLogp: float64;
  tokenMinLogp: float64;

  @minValue(0)
  confidenceTemperature: float64;

  hotwords: string[];

  @minValue(0)
  hotwordWeight: float64;
}

model SmoothGateCfg {
  @minValue(0)
  @maxValue(1)
  displayConfidence: float64;

  @minValue(0)
  displayStreak: int32;

  @minValue(0)
  displayCount: int32;

  @minValue(0)
  displayClearMisses: int32;

  @minValue(0)
  displayClearMotion: float64;

  @minValue(0)
  @maxValue(1)
  instantDisplayConfidence: float64;

  @minValue(0)
  @maxValue(1)
  commitConfidence: float64;

  @minValue(0)
  @maxValue(1)
  modelDisagreementCommitConfidence: float64;

  @minValue(0)
  @maxValue(1)
  shortCommitConfidence: float64;

  @minValue(0)
  commitStreak: int32;

  @minValue(0)
  commitCount: int32;

  @minValue(0)
  endpointCommitCount: int32;

  @minValue(0)
  commitSoftOovMinChars: int32;

  @minValue(0)
  @maxValue(1)
  commitSoftOovConfidence: float64;

  @minValue(0)
  commitRejectUncorrectedOovChars: int32;

  @minValue(0)
  @maxValue(1)
  stableCommitConfidence: float64;

  @minValue(0)
  stableCommitCount: int32;

  @minValue(0)
  stableCommitStreak: int32;

  @minValue(0)
  stableCommitMinChars: int32;

  @minValue(0)
  @maxValue(1)
  shortStableCommitConfidence: float64;

  @minValue(0)
  shortStableCommitCount: int32;

  @minValue(0)
  shortStableCommitStreak: int32;

  @minValue(0)
  shortStableCommitMinChars: int32;

  @minValue(0)
  shortStableCommitMaxChars: int32;

  @minValue(0)
  majorityCommitMinCount: int32;

  @minValue(0)
  @maxValue(1)
  majorityCommitMinShare: float64;

  @minValue(0)
  majorityCommitMinChars: int32;

  @minValue(0)
  @maxValue(1)
  dominantCommitConfidence: float64;

  @minValue(0)
  dominantCommitCount: int32;

  @minValue(0)
  dominantCommitMinChars: int32;

  @minValue(0)
  @maxValue(1)
  alternativeCommitConfidence: float64;

  @minValue(0)
  alternativeCommitCount: int32;

  @minValue(0)
  alternativeCommitMinChars: int32;

  @minValue(0)
  alternativeCommitRecentMisses: int32;

  replaceMargin: float64;
}

@route("/v1")
namespace Routes {
  @post
  @route("/predict")
  op predict(@body body: PredictIn): PredictOut;

  @get
  @route("/health")
  op health(): HealthOut;

  @post
  @route("/recognize")
  op recognize(@body body: RecognizeIn): RecognizeOut;
}
