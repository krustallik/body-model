"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import styles from "./help-tip.module.css";

function usesFineHover(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export function HelpTip({ children, label = "Показати пояснення" }: {
  children: ReactNode;
  label?: string;
}) {
  const tipId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [desktopStyle, setDesktopStyle] = useState<CSSProperties | undefined>();

  useLayoutEffect(() => {
    if (!open || !rootRef.current || !usesFineHover()) {
      setDesktopStyle(undefined);
      return;
    }
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 12;
      const maxWidth = Math.min(304, window.innerWidth - margin * 2);
      const centerX = rect.left + rect.width / 2;
      const left = Math.min(
        window.innerWidth - margin - maxWidth / 2,
        Math.max(margin + maxWidth / 2, centerX),
      );
      setDesktopStyle({
        top: rect.bottom + 8,
        left,
        width: maxWidth,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open || usesFineHover()) return;
    function closeOnOutside(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutside, true);
    return () => document.removeEventListener("pointerdown", closeOnOutside, true);
  }, [open]);

  return <span
    ref={rootRef}
    className={styles.tip}
    data-open={open ? "true" : undefined}
    onMouseEnter={() => {
      if (usesFineHover()) setOpen(true);
    }}
    onMouseLeave={() => {
      if (usesFineHover()) setOpen(false);
    }}
  >
    <button
      type="button"
      className={styles.trigger}
      aria-label={label}
      aria-expanded={open}
      aria-controls={tipId}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        // Pointer users on desktop already have the hover behavior. Keyboard activation
        // produces click.detail === 0 and must open the tip even on hover-capable devices.
        if (usesFineHover() && event.detail > 0) return;
        setOpen((value) => !value);
      }}
      aria-describedby={open ? tipId : undefined}
    >?</button>
    {open && <span
      id={tipId}
      className={styles.bubble}
      role="tooltip"
      data-placement={usesFineHover() ? "anchored" : "sheet"}
      style={desktopStyle}
    >{children}</span>}
  </span>;
}
