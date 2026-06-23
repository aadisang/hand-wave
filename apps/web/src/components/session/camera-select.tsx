import { useMediaDevices } from "@reactuses/core";
import { memo, useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { ToolbarSeparator } from "@/components/ui/toolbar";

type Props = {
  cameraId: string | null;
  reserve?: boolean;
  setCameraId: (cameraId: string | null) => void;
};

const cleanLabel = (label: string) =>
  label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").trim();

const labelFor = (device: Pick<MediaDeviceInfo, "label">, index: number) =>
  cleanLabel(device.label) || `Camera ${index + 1}`;

const triggerLabelFor = (label: string) =>
  label.replace(/\s+(?:virtual\s+camera|web\s+camera|webcam|camera)$/i, "") ||
  label;

const mediaDevicesOptions = {
  constraints: { audio: false, video: true },
};

const triggerWidth = "clamp(7rem, 24vw, 10rem)";

export const CameraSelect = memo(function CameraSelect({
  cameraId,
  reserve = false,
  setCameraId,
}: Props) {
  const [{ devices }] = useMediaDevices(mediaDevicesOptions);
  const cameras = useMemo(
    () => devices.filter((device) => device.kind === "videoinput"),
    [devices],
  );
  const selectedIndex = cameras.findIndex((d) => d.deviceId === cameraId);
  const selectedLabel =
    selectedIndex === -1
      ? "Select camera"
      : labelFor(cameras[selectedIndex], selectedIndex);

  if (cameras.length < 2) {
    if (!reserve) return null;

    return (
      <>
        <ToolbarSeparator orientation="vertical" />
        <div
          aria-hidden="true"
          className="pointer-events-none shrink-0"
          style={{ width: triggerWidth }}
        />
      </>
    );
  }

  return (
    <>
      <ToolbarSeparator orientation="vertical" />
      <Select onValueChange={setCameraId} value={cameraId}>
        <Tooltip>
          <TooltipTrigger
            render={
              <SelectTrigger
                className="min-w-0 border-input bg-overlay"
                size="sm"
                style={{ width: triggerWidth }}
              />
            }
          >
            <SelectValue placeholder="Select camera">
              {(value) => {
                if (typeof value !== "string") return null;
                const index = cameras.findIndex((d) => d.deviceId === value);
                if (index === -1) return null;
                return triggerLabelFor(labelFor(cameras[index], index));
              }}
            </SelectValue>
          </TooltipTrigger>
          <TooltipPopup>{selectedLabel}</TooltipPopup>
        </Tooltip>
        <SelectContent>
          {cameras.map((device, index) => (
            <SelectItem key={device.deviceId} value={device.deviceId}>
              {labelFor(device, index)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
});
