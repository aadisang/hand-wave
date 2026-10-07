import { Cloud, Cpu, LoaderCircle, TriangleAlert } from "lucide-react";
import { memo, useCallback, useRef } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToolbarSeparator } from "@/components/ui/toolbar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import type { InferenceConnectionStatus } from "@/lib/inference/connection";
import type { InferenceMode } from "@/types/inference";

type Props = {
  mode: InferenceMode;
  onOpenChange: (open: boolean) => void;
  setMode: (mode: InferenceMode) => void;
  status: InferenceConnectionStatus;
};

const labels: Record<InferenceMode, string> = {
  remote: "Cloud",
  device: "On device",
};

export const InferenceModeSelect = memo(function InferenceModeSelect({
  mode,
  onOpenChange,
  setMode,
  status,
}: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectMode = useCallback(
    (value: InferenceMode | null) => {
      if (value === null) return;
      setMode(value);
      requestAnimationFrame(() => {
        triggerRef.current?.focus({ preventScroll: true });
      });
    },
    [setMode],
  );

  return (
    <>
      <ToolbarSeparator orientation="vertical" />
      <Select
        onOpenChange={onOpenChange}
        onValueChange={selectMode}
        value={mode}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <SelectTrigger
                aria-label="Recognition mode"
                className="min-w-0 border-input bg-overlay"
                onKeyDownCapture={(event) => {
                  if (event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.click();
                }}
                ref={triggerRef}
                style={{ width: "7.75rem" }}
              />
            }
          >
            <SelectValue>
              {(value) => (
                <span className="flex items-center gap-1.5">
                  <ModeIcon mode={value as InferenceMode} status={status} />
                  {labels[value as InferenceMode]}
                </span>
              )}
            </SelectValue>
          </TooltipTrigger>
          <TooltipPopup>{statusMessage(mode, status)}</TooltipPopup>
        </Tooltip>
        <SelectContent>
          <SelectItem value="remote">
            <span className="flex items-center gap-2">
              <Cloud /> Cloud
            </span>
          </SelectItem>
          <SelectItem value="device">
            <span className="flex items-center gap-2">
              <Cpu /> On device
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
    </>
  );
});

function ModeIcon({
  mode,
  status,
}: {
  mode: InferenceMode;
  status: InferenceConnectionStatus;
}) {
  if (status === "connecting") return <LoaderCircle className="animate-spin" />;
  if (status === "error") return <TriangleAlert />;
  return mode === "device" ? <Cpu /> : <Cloud />;
}

function statusMessage(mode: InferenceMode, status: InferenceConnectionStatus) {
  if (status === "connecting") {
    return mode === "device"
      ? "Loading the on-device model…"
      : "Connecting to the cloud…";
  }
  if (status === "error") return "Recognition is reconnecting…";
  return mode === "device"
    ? "Model runs here; text checks stay online"
    : "Model and text checks run in the cloud";
}
