import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToolbarSeparator } from "@/components/ui/toolbar";
import type { CaptureSession } from "@/hooks/use-capture-session";
import { useVideoDevices } from "@/hooks/use-video-devices";

type Props = {
  capture: CaptureSession;
};

const cleanLabel = (label: string) =>
  label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").trim();

const labelFor = (device: MediaDeviceInfo, index: number) =>
  cleanLabel(device.label) || `Camera ${index + 1}`;

export function CameraSelect({ capture }: Props) {
  const devices = useVideoDevices(true);

  if (devices.length < 2) return null;

  return (
    <>
      <ToolbarSeparator orientation="vertical" />
      <Select
        onValueChange={(value) => capture.setCameraId(value)}
        value={capture.cameraId}
      >
        <SelectTrigger
          className="w-control-select border-input bg-overlay"
          size="sm"
        >
          <SelectValue placeholder="Select camera">
            {(value) => {
              if (typeof value !== "string") return null;
              const index = devices.findIndex((d) => d.deviceId === value);
              if (index === -1) return null;
              return labelFor(devices[index], index);
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {devices.map((device, index) => (
            <SelectItem key={device.deviceId} value={device.deviceId}>
              {labelFor(device, index)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
