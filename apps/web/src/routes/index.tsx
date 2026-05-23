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
    <div className="dark flex h-svh flex-col overflow-hidden bg-background p-3 text-foreground sm:p-4">
      <main className="flex min-h-0 flex-1 items-center justify-center">
        <div className="stage-frame">
          <Stage />
        </div>
      </main>
      <footer className="shrink-0 pt-2 text-center text-muted-foreground text-xs">
        Designed and built by{" "}
        <a
          className="text-foreground transition-colors hover:text-muted-foreground"
          href="https://aadisanghvi.com"
          rel="noreferrer"
          target="_blank"
        >
          Aadi Sanghvi
        </a>{" "}
        and{" "}
        <a
          className="text-foreground transition-colors hover:text-muted-foreground"
          href="https://www.linkedin.com/in/shiven-velagapudi/"
          rel="noreferrer"
          target="_blank"
        >
          Shiven Velagapudi
        </a>
      </footer>
    </div>
  );
}
