import { useCallback, useEffect, useState, type RefObject } from "react";

export type FullscreenControls = {
  isFullscreen: boolean;
  toggle: () => void;
};

export function useFullscreen(
  ref: RefObject<HTMLElement | null>,
): FullscreenControls {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () =>
      setIsFullscreen(document.fullscreenElement === ref.current);

    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [ref]);

  const toggle = useCallback(() => {
    const target = ref.current;
    if (!target) return;

    if (document.fullscreenElement === target) {
      void document.exitFullscreen();
    } else {
      void target.requestFullscreen();
    }
  }, [ref]);

  return { isFullscreen, toggle };
}
