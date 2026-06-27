import { MonitorOff } from "lucide-react";

type Props = {
  error: string | null;
};

export function IdleStage({ error }: Props) {
  return (
    <div className="flex h-full w-full items-center justify-center px-6 pb-20 pt-8">
      <div className="max-w-xs space-y-3 text-center">
        <div
          aria-hidden="true"
          className="mx-auto flex size-16 items-center justify-center rounded-[1.35rem] border border-white/10 bg-white/[0.04] text-muted-foreground shadow-[0_18px_44px_rgba(0,0,0,0.28)]"
        >
          <MonitorOff className="size-8" strokeWidth={1.8} />
        </div>
        <p className="text-balance font-medium">
          {error ?? "No active stream"}
        </p>
        <p className="text-muted-foreground text-pretty text-sm">
          Use the controls below to start camera or screen share
        </p>
      </div>
    </div>
  );
}
