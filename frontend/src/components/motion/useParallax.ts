import { useEffect, useRef, useState } from "react";
import { useScroll, useTransform } from "framer-motion";

/**
 * Layered parallax scroll. `speed` controls depth illusion:
 *   negative  → element moves UP faster than scroll (foreground)
 *   0         → stationary
 *   positive  → element moves DOWN with scroll (deep background)
 *
 * Returns a `MotionValue<number>` bound to `style.y` on a motion element.
 * Automatically disabled on `prefers-reduced-motion: reduce`.
 */
export function useParallax(speed: number = 0.3) {
  const ref = useRef<HTMLElement | null>(null);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(m.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, []);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });

  const range = reduced ? [0, 0] : [-speed * 300, speed * 300];
  const y = useTransform(scrollYProgress, [0, 1], range);

  return { ref, y, reduced };
}
