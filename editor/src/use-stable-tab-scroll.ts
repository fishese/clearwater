import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';

type TabSetter<T> = Dispatch<SetStateAction<T>>;

interface StableTabScrollOptions {
  resetKey: string;
  enabled: boolean;
  expanded: boolean;
  controlsRef: RefObject<HTMLElement | null>;
  bodyRef: RefObject<HTMLElement | null>;
}

/** Keep the controls region tall enough to avoid moving the page when a tab shows a shorter panel. */
export function useStableTabScroll({ resetKey, enabled, expanded, controlsRef, bodyRef }: StableTabScrollOptions) {
  const pendingScroll = useRef<{ windowY: number; controlsTop: number } | null>(null);
  const restoreFrame = useRef<number | null>(null);
  const maxHeight = useRef(0);
  const measuredWidth = useRef(typeof window === 'undefined' ? 0 : window.innerWidth);
  const measuredResetKey = useRef(resetKey);
  const [viewportWidth, setViewportWidth] = useState(measuredWidth.current);

  const selectTab = useCallback(<T,>(setter: TabSetter<T>, value: T) => {
    const controls = controlsRef.current;
    if (restoreFrame.current !== null) cancelAnimationFrame(restoreFrame.current);
    restoreFrame.current = null;
    if (!pendingScroll.current) pendingScroll.current = { windowY: window.scrollY, controlsTop: controls?.scrollTop ?? 0 };
    setter(value);
  }, [controlsRef]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const previous = controls.style.overflowAnchor;
    controls.style.overflowAnchor = 'none';
    return () => { controls.style.overflowAnchor = previous; };
  }, [controlsRef]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth !== measuredWidth.current) setViewportWidth(window.innerWidth);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => () => {
    if (restoreFrame.current !== null) cancelAnimationFrame(restoreFrame.current);
  }, []);

  useLayoutEffect(() => {
    const controls = controlsRef.current;
    const body = bodyRef.current;
    const changedLayout = measuredResetKey.current !== resetKey || measuredWidth.current !== window.innerWidth;
    if (changedLayout) {
      controls?.style.removeProperty('min-height');
      body?.style.removeProperty('min-height');
      maxHeight.current = 0;
      pendingScroll.current = null;
      if (restoreFrame.current !== null) cancelAnimationFrame(restoreFrame.current);
      restoreFrame.current = null;
      measuredResetKey.current = resetKey;
      measuredWidth.current = window.innerWidth;
    }

    if (enabled && controls) {
      if (expanded && body) {
        const bodyHeight = body.getBoundingClientRect().height;
        const contentHeight = controls.scrollHeight;
        maxHeight.current = Math.max(maxHeight.current, contentHeight);
        const nonBodyHeight = Math.max(0, contentHeight - bodyHeight);
        body.style.minHeight = `${Math.ceil(Math.max(bodyHeight, maxHeight.current - nonBodyHeight))}px`;
      } else if (!expanded) {
        maxHeight.current = Math.max(maxHeight.current, controls.getBoundingClientRect().height);
        controls.style.minHeight = `${Math.ceil(maxHeight.current)}px`;
      }
    }

    const saved = pendingScroll.current;
    if (saved && restoreFrame.current === null) {
      restoreFrame.current = requestAnimationFrame(() => {
        restoreFrame.current = null;
        if (pendingScroll.current === saved) pendingScroll.current = null;
        window.scrollTo({ top: saved.windowY, left: window.scrollX, behavior: 'instant' as ScrollBehavior });
        if (controlsRef.current) controlsRef.current.scrollTop = saved.controlsTop;
      });
    }
  });

  return selectTab;
}
