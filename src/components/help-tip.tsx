"use client";

import type { ReactNode } from "react";
import styles from "./help-tip.module.css";

export function HelpTip({ children, label = "Показати пояснення" }: {
  children: ReactNode;
  label?: string;
}) {
  return <details className={styles.tip}>
    <summary aria-label={label} onClick={(event) => event.stopPropagation()}>?</summary>
    <div className={styles.bubble} role="tooltip">{children}</div>
  </details>;
}
