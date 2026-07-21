import { useCallback, useEffect, useRef, useState } from "react";

const hideDelayMs = 2_600;
const refreshIntervalMs = 250;

export function useAutoHideControls() {
  const [revealed, setRevealed] = useState(true);
  const hideTimer = useRef<number | null>(null);
  const nextRefreshAt = useRef(0);

  const clearTimer = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
    nextRefreshAt.current = 0;
  }, []);

  const reveal = useCallback(() => {
    setRevealed(true);
    const now = performance.now();
    if (now < nextRefreshAt.current) return;

    clearTimer();
    hideTimer.current = window.setTimeout(
      () => setRevealed(false),
      hideDelayMs,
    );
    nextRefreshAt.current = now + refreshIntervalMs;
  }, [clearTimer]);

  const hide = useCallback(() => {
    clearTimer();
    setRevealed(false);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return { hide, reveal, revealed };
}
