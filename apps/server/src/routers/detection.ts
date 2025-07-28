import { publicProcedure, router } from "../lib/trpc";
import {
  DetectionInputSchema,
  DetectionOutputSchema,
} from "../schema/detection";

export const detectionRouter = router({
  detect: publicProcedure
    .input(DetectionInputSchema)
    .output(DetectionOutputSchema)
    .mutation(async ({ input }) => {
      // Generate fake detection data
      const signs = [
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "G",
        "H",
        "I",
        "J",
        "K",
        "L",
        "M",
        "N",
        "O",
        "P",
        "Q",
        "R",
        "S",
        "T",
        "U",
        "V",
        "W",
        "X",
        "Y",
        "Z",
      ];
      const randomSign = signs[Math.floor(Math.random() * signs.length)];
      const confidence = Math.random() * 0.4 + 0.6; // Random confidence between 0.6 and 1.0

      const result = {
        detectedSign: randomSign,
        confidence,
        boundingBox: {
          x: Math.random() * 100,
          y: Math.random() * 100,
          width: 50 + Math.random() * 100,
          height: 50 + Math.random() * 100,
        },
        processingTime: 500 + Math.random() * 200,
        modelVersion: "1.0.0",
        timestamp: new Date().toISOString(),
      };
      return result;
    }),
});

