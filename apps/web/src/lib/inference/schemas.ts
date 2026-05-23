import * as Schema from "effect/Schema";

export const LandmarkFrameSchema = Schema.Array(Schema.Number).pipe(
  Schema.itemsCount(162),
);

export const HealthResponseSchema = Schema.Struct({
  status: Schema.Literal("ok"),
});

export const PredictionSchema = Schema.Struct({
  label: Schema.String,
  confidence: Schema.Number,
  logit_score: Schema.optional(Schema.NullOr(Schema.Number)),
  lm_score: Schema.optional(Schema.NullOr(Schema.Number)),
  raw_label: Schema.optional(Schema.NullOr(Schema.String)),
});

export const PredictionSpanSchema = Schema.Struct({
  text: Schema.String,
  start_frame: Schema.Number,
  end_frame: Schema.Number,
});

const decodedTextFields = {
  prediction: PredictionSchema,
  alternatives: Schema.Array(PredictionSchema),
  spans: Schema.Array(PredictionSpanSchema),
  greedy_text: Schema.String,
  blank_ratio: Schema.Number,
  tail_blank_ratio: Schema.Number,
  tail_blank_frames: Schema.Number,
  partial_text: Schema.String,
  stable_text: Schema.String,
} as const;

export const StreamPredictionSchema = Schema.Struct({
  session_id: Schema.String,
  buffered_frames: Schema.Number,
  ...decodedTextFields,
});

export const CreateSessionResponseSchema = Schema.Struct({
  session_id: Schema.String,
});

export const ResetSessionResponseSchema = Schema.Struct({
  session_id: Schema.String,
  buffered_frames: Schema.Number,
  partial_text: Schema.String,
  stable_text: Schema.String,
});
