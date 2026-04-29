import { MonitorOff } from "lucide-react";

type Props = {
  error: string | null;
};

export function IdleStage({ error }: Props) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="space-y-3 text-center">
        <MonitorOff className="mx-auto size-14 text-muted-foreground" />
        <p className="font-medium">{error ?? "No active stream"}</p>
        <p className="text-muted-foreground text-sm">
          Use the controls below to start camera or screen share
        </p>
      </div>
    </div>
  );
}
