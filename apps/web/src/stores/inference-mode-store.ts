import { create } from "zustand";
import type { InferenceMode } from "@/types/inference";

type InferenceModeState = {
  mode: InferenceMode;
  setMode: (mode: InferenceMode) => void;
};

export const useInferenceModeStore = create<InferenceModeState>((set) => ({
  mode: "remote",
  setMode: (mode) => set({ mode }),
}));
