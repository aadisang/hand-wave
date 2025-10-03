import { router } from "../lib/trpc";
import { detectionRouter } from "./detection";
import { translationRouter } from "./translation";

export const appRouter = router({
	detection: detectionRouter,
	translation: translationRouter,
});

export type AppRouter = typeof appRouter;
