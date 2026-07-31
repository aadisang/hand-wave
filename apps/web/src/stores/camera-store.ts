import { create } from "zustand";
import { persist } from "zustand/middleware";

type CameraState = {
  cameraId: string | null;
  setCameraId: (cameraId: string | null) => void;
};

export const useCameraStore = create<CameraState>()(
  persist(
    (set) => ({
      cameraId: null,
      setCameraId: (cameraId) => set({ cameraId }),
    }),
    {
      name: "hand-wave:camera",
      partialize: ({ cameraId }) => ({ cameraId }),
    },
  ),
);
