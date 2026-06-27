import { memo, useSyncExternalStore } from "react";
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
  reserve: boolean;
  setCameraId: (cameraId: string | null) => void;
};

type CameraSnapshot = {
  cameras: MediaDeviceInfo[];
  ready: boolean;
};

const cleanLabel = (label: string) =>
  label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").trim();

const labelFor = (device: Pick<MediaDeviceInfo, "label">, index: number) =>
  cleanLabel(device.label) || `Camera ${index + 1}`;

const triggerLabelFor = (label: string) =>
  label.replace(/\s+(?:virtual\s+camera|web\s+camera|webcam|camera)$/i, "") ||
  label;

const triggerWidth = "clamp(7rem, 24vw, 10rem)";
const emptySnapshot: CameraSnapshot = { cameras: [], ready: false };
const listeners = new Set<() => void>();

let snapshot = emptySnapshot;

export const CameraSelect = memo(function CameraSelect({
  cameraId,
  reserve,
  setCameraId,
}: Props) {
  const { cameras, ready } = useCameraDevices();
  const selectedIndex = cameras.findIndex((d) => d.deviceId === cameraId);
  const selectedLabel =
    selectedIndex === -1
      ? "Select camera"
      : labelFor(cameras[selectedIndex], selectedIndex);

  if (cameras.length < 2) {
    const showPlaceholder =
      reserve || !ready || cameraId !== null || cameras.length === 1;
    if (!showPlaceholder) return null;

    return (
      <>
        <ToolbarSeparator orientation="vertical" />
        <div
          aria-disabled="true"
          className="inline-flex min-h-8 shrink-0 items-center justify-between truncate rounded-lg border border-input bg-overlay px-2.5 text-sm text-muted-foreground shadow-xs/5"
          style={{ width: triggerWidth }}
        >
          {cameras[0] ? triggerLabelFor(labelFor(cameras[0], 0)) : "Camera"}
        </div>
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

function useCameraDevices() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  void refresh();

  const timers = [
    window.setTimeout(refresh, 250),
    window.setTimeout(refresh, 1_000),
  ];
  navigator.mediaDevices.addEventListener("devicechange", refresh);

  return () => {
    listeners.delete(onStoreChange);
    timers.forEach(window.clearTimeout);
    navigator.mediaDevices.removeEventListener("devicechange", refresh);
  };
}

function getSnapshot() {
  return snapshot;
}

async function refresh() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  snapshot = {
    cameras: devices.filter((device) => device.kind === "videoinput"),
    ready: true,
  };
  listeners.forEach((listener) => listener());
}
