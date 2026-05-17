import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Stage } from "@/components/session/stage-view";
import { preloadHandLandmarker } from "@/hooks/use-hand-landmarker";
import { getInferenceHealth, runInferenceExit } from "@/lib/inference/client";
import type { HealthResponse } from "@/types/inference";

async function getInferenceHealthOrNull(): Promise<HealthResponse | null> {
  const exit = await runInferenceExit(getInferenceHealth());
  return exit._tag === "Success" ? exit.value : null;
}

export const Route = createFileRoute("/")({
  loader: async () => ({ health: await getInferenceHealthOrNull() }),
  component: Home,
});

function Home() {
  useEffect(() => {
    void preloadHandLandmarker();
  }, []);

  return (
    <div className="dark flex min-h-svh items-center bg-background p-3 text-foreground sm:p-4">
      <div className="mx-auto w-full max-w-stage-content">
        <Stage />
      </div>
    </div>
  );
}
