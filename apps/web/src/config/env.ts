import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_INFERENCE_URL: z.url(),
    VITE_DEVICE_INFERENCE_URL: z.url().optional(),
  },
  runtimeEnvStrict: {
    VITE_INFERENCE_URL: import.meta.env.VITE_INFERENCE_URL,
    VITE_DEVICE_INFERENCE_URL: import.meta.env.VITE_DEVICE_INFERENCE_URL,
  },
  emptyStringAsUndefined: true,
});
