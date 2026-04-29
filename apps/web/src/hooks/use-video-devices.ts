import { useEffect, useState } from "react";

export function useVideoDevices(active: boolean): MediaDeviceInfo[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    if (!active) {
      setDevices([]);
      return;
    }

    let cancelled = false;
    const enumerate = async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (cancelled) return;
      setDevices(devices.filter((device) => device.kind === "videoinput"));
    };

    void enumerate();
    const onChange = () => void enumerate();
    navigator.mediaDevices.addEventListener("devicechange", onChange);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", onChange);
    };
  }, [active]);

  return devices;
}
