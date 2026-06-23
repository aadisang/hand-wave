import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Stage } from "@/components/session/stage-view";
import { preloadLandmarker } from "@/hooks/use-landmarks";
import { warmInference } from "@/lib/inference/client";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  useEffect(() => {
    void preloadLandmarker();
    void warmInference();
  }, []);

  return (
    <div className="dark flex h-svh flex-col overflow-hidden bg-background p-3 text-foreground sm:p-4">
      <main
        className="flex min-h-0 flex-1 items-center justify-center"
        id="main"
      >
        <h1 className="sr-only">Hand Wave</h1>
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
        </a>
      </footer>
    </div>
  );
}
