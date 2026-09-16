"use client";

import { useRef, type ReactNode } from "react";
import styles from "./help-tip.module.css";

export function HelpTip({ children, label = "Показати пояснення" }: {
  children: ReactNode;
  label?: string;
}) {
  const tipRef = useRef<HTMLDetailsElement>(null);
  function usesMouse(): boolean {
    return typeof window !== "undefined"
      && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }
  return <details
    ref={tipRef}
    className={styles.tip}
    onMouseLeave={() => {
      if (!usesMouse()) return;
      tipRef.current?.removeAttribute("open");
      const active = document.activeElement;
      if (active instanceof HTMLElement && tipRef.current?.contains(active)) active.blur();
    }}
  >
    <summary aria-label={label} onClick={(event) => {
      event.stopPropagation();
      if (usesMouse()) event.preventDefault();
    }}>?</summary>
    <div className={styles.bubble} role="tooltip">{children}</div>
  </details>;
}
