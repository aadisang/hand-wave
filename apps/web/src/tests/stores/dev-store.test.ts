import { afterEach, describe, expect, it } from "vitest";
import { useDevStore } from "@/stores/dev-store";

afterEach(() => {
  useDevStore.setState({
    enabled: false,
    boundary: 0,
    frame: null,
    fps: 0,
    inferenceMs: 0,
    traces: [],
    recording: null,
    recordings: [],
  });
});

describe("dev store", () => {
  it("saves an active recording when the panel closes", () => {
    useDevStore.setState({ enabled: true });
    useDevStore.getState().startRecording("hello");

    useDevStore.getState().toggle();

    const state = useDevStore.getState();
    expect(state.enabled).toBe(false);
    expect(state.recording).toBeNull();
    expect(state.recordings).toHaveLength(1);
    expect(state.recordings[0]?.label).toBe("hello");
  });
});
