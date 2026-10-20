import { useCallback, useEffect, useState } from 'react';
import type { FocusEvent, MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import styles from './QuotaTimeline.module.scss';

interface TipState {
  text: string;
  x: number;
  y: number;
}

/**
 * In-app replacement for native `title` tooltips on the timeline. Native tooltips are drawn by the
 * OS and can stay on screen after a route change removes the hovered element (Chrome on macOS);
 * this one lives in React state. Pages you navigate away from stay mounted as hidden "stacked"
 * layers, so the tip is also dropped as soon as its page stops being the current layer.
 */
export function useHoverTip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const isCurrentLayer = usePageTransitionLayer()?.isCurrentLayer ?? true;

  useEffect(() => {
    if (!isCurrentLayer) setTip(null);
  }, [isCurrentLayer]);

  const bind = useCallback(
    (text: string) => ({
      'aria-label': text.split('\n').join(', '),
      onMouseEnter: (event: MouseEvent<HTMLElement>) =>
        setTip({ text, x: event.clientX, y: event.clientY }),
      onMouseMove: (event: MouseEvent<HTMLElement>) =>
        setTip({ text, x: event.clientX, y: event.clientY }),
      onMouseLeave: () => setTip(null),
      onFocus: (event: FocusEvent<HTMLElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setTip({ text, x: rect.left + rect.width / 2, y: rect.bottom });
      },
      onBlur: () => setTip(null),
    }),
    []
  );

  const element =
    tip && isCurrentLayer && typeof document !== 'undefined'
      ? createPortal(
          <div
            className={styles.hoverTip}
            role="tooltip"
            style={{
              left: Math.min(tip.x + 12, window.innerWidth - 260),
              top: tip.y + 16,
            }}
          >
            {tip.text}
          </div>,
          document.body
        )
      : null;

  return { bind, element };
}
