import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  getInferenceConnectionStatus,
  setInferenceConnectionStatus,
  subscribeInferenceConnection,
} from "@/lib/inference/connection";

describe("inference connection state", () => {
  beforeEach(() => {
    setInferenceConnectionStatus("remote", "idle");
    setInferenceConnectionStatus("device", "idle");
  });

  test("keeps cloud and on-device status independent", () => {
    const remoteListener = vi.fn();
    const deviceListener = vi.fn();
    const unsubscribeRemote = subscribeInferenceConnection(
      "remote",
      remoteListener,
    );
    const unsubscribeDevice = subscribeInferenceConnection(
      "device",
      deviceListener,
    );

    setInferenceConnectionStatus("device", "connecting");

    expect(getInferenceConnectionStatus("remote")).toBe("idle");
    expect(getInferenceConnectionStatus("device")).toBe("connecting");
    expect(remoteListener).not.toHaveBeenCalled();
    expect(deviceListener).toHaveBeenCalledOnce();

    unsubscribeRemote();
    unsubscribeDevice();
  });
});
