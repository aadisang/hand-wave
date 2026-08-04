import { Cloud, Cpu } from "lucide-react";
import { memo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToolbarSeparator } from "@/components/ui/toolbar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import type { InferenceMode } from "@/types/inference";

type Props = {
  disabled: boolean;
  mode: InferenceMode;
  onOpenChange: (open: boolean) => void;
  setMode: (mode: InferenceMode) => void;
};

const labels: Record<InferenceMode, string> = {
  remote: "Cloud",
  device: "On device",
};

export const InferenceModeSelect = memo(function InferenceModeSelect({
  disabled,
  mode,
  onOpenChange,
  setMode,
}: Props) {
  return (
    <>
      <ToolbarSeparator orientation="vertical" />
      <Select
        disabled={disabled}
        onOpenChange={onOpenChange}
        onValueChange={(value) => setMode(value as InferenceMode)}
        value={mode}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <SelectTrigger
                aria-label="Recognition mode"
                className="min-w-0 border-input bg-overlay"
                style={{ width: "7.75rem" }}
              />
            }
          >
            <SelectValue>
              {(value) => (
                <span className="flex items-center gap-1.5">
                  {value === "device" ? <Cpu /> : <Cloud />}
                  {labels[value as InferenceMode]}
                </span>
              )}
            </SelectValue>
          </TooltipTrigger>
          <TooltipPopup>
            {disabled
              ? "Stop first to change mode"
              : mode === "device"
                ? "Model runs here; text checks stay online"
                : "Model and text checks run in the cloud"}
          </TooltipPopup>
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
