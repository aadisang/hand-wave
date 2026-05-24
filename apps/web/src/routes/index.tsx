import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Stage } from "@/components/session/stage-view";
import { preloadLandmarker } from "@/hooks/use-landmarks";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  useEffect(() => {
    void preloadLandmarker();
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
