import { useMediaDevices } from "@reactuses/core";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { ToolbarSeparator } from "@/components/ui/toolbar";
import type { CaptureSession } from "@/types/capture";

type Props = {
  capture: CaptureSession;
};

const cleanLabel = (label: string) =>
  label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").trim();

const labelFor = (device: Pick<MediaDeviceInfo, "label">, index: number) =>
  cleanLabel(device.label) || `Camera ${index + 1}`;

export function CameraSelect({ capture }: Props) {
  const [{ devices }] = useMediaDevices({
    constraints: { audio: false, video: true },
  });
  const cameras = devices.filter((device) => device.kind === "videoinput");

  if (cameras.length < 2) return null;

  return (
    <>
      <ToolbarSeparator orientation="vertical" />
      <Select
        onValueChange={(value) => capture.setCameraId(value)}
        value={capture.cameraId}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <SelectTrigger
                className="w-control-select border-input bg-overlay"
                size="sm"
              />
            }
          >
            <SelectValue placeholder="Select camera">
              {(value) => {
                if (typeof value !== "string") return null;
                const index = cameras.findIndex((d) => d.deviceId === value);
                if (index === -1) return null;
                return labelFor(cameras[index], index);
              }}
            </SelectValue>
          </TooltipTrigger>
          <TooltipPopup>Select camera</TooltipPopup>
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
}
