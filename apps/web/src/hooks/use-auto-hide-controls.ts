import { useThrottleFn, useTimeoutFn } from "@reactuses/core";
import { useCallback, useState } from "react";

const hideDelayMs = 2_600;
const refreshIntervalMs = 250;

export function useAutoHideControls() {
  const [revealed, setRevealed] = useState(true);
  const [, scheduleHide, cancelHide] = useTimeoutFn(
    () => setRevealed(false),
    hideDelayMs,
    { immediate: false },
  );
  const { run: refresh, cancel: cancelRefresh } = useThrottleFn(
    scheduleHide,
    refreshIntervalMs,
    { trailing: false },
  );

  const reveal = useCallback(() => {
    setRevealed(true);
    refresh();
  }, [refresh]);

  const hide = useCallback(() => {
    cancelRefresh();
    cancelHide();
    setRevealed(false);
  }, [cancelRefresh, cancelHide]);

  return { hide, reveal, revealed };
}
