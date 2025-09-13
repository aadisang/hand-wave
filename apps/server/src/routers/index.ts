import { router } from "../lib/trpc";
import { detectionRouter } from "./detection";

export const appRouter = router({
	detection: detectionRouter,
});

export type AppRouter = typeof appRouter;
