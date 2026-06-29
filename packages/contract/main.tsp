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

model RecognitionScored {
  prediction: Prediction;
  score: float64;
  source: string;
  lm_score?: float64 | null;
  model_agrees: boolean;
  streak: int32;
}

model RecognitionCount {
  text: string;
  count: int32;
}

model RecognitionState {
  display?: RecognitionScored | null;
  final_candidate?: RecognitionScored | null;
  selected_text: string;
  selected_streak: int32;
  display_misses: int32;
  counts: RecognitionCount[];
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

@jsonSchema("config.schema.json")
model Config {
  decode: DecodeCfg;
  stream: StreamCfg;
  mp: MpCfg;
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
