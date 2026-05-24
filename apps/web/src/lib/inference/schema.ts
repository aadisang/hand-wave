import * as Schema from "effect/Schema";

export const FrameSchema = Schema.Array(Schema.Number).pipe(
  Schema.itemsCount(162),
);

export const PredSchema = Schema.Struct({
  label: Schema.String,
  confidence: Schema.Number,
  logit_score: Schema.optional(Schema.NullOr(Schema.Number)),
  lm_score: Schema.optional(Schema.NullOr(Schema.Number)),
  raw_label: Schema.optional(Schema.NullOr(Schema.String)),
});

export const SpanSchema = Schema.Struct({
  text: Schema.String,
  start_frame: Schema.Number,
  end_frame: Schema.Number,
});

const decodedTextFields = {
  prediction: PredSchema,
  alternatives: Schema.Array(PredSchema),
  spans: Schema.Array(SpanSchema),
  greedy_text: Schema.String,
  blank_ratio: Schema.Number,
  tail_blank_ratio: Schema.Number,
  tail_blank_frames: Schema.Number,
  partial_text: Schema.String,
  stable_text: Schema.String,
} as const;

export const InferOutSchema = Schema.Struct(decodedTextFields);
