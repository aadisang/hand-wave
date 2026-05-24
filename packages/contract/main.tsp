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
}
