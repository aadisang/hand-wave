import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { DetectionResults } from "@/components/session/DetectionResults";
import { Header } from "@/components/session/Header";
import { Stage } from "@/components/session/Stage";
import { preloadHandLandmarker } from "@/hooks/use-hand-landmarker";
import type { HealthResponse } from "../inference";

async function getInferenceHealthOrNull(): Promise<HealthResponse | null> {
  const [{ runPromiseExit }, { getInferenceHealth }] = await Promise.all([
    import("effect/Effect"),
    import("../inference"),
  ]);
  const exit = await runPromiseExit(getInferenceHealth());
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
    <div className="dark min-h-svh bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-app-content flex-col gap-6 px-4 py-8 sm:px-6">
        <Header />
        <Stage />
        <DetectionResults />
      </div>
    </div>
  );
}
