import type { ReactNode } from "react";
import styles from "./training.module.css";

/** Scopes the training-only dark theme without affecting other routes. */
export default function TrainingLayout({ children }: { children: ReactNode }) {
  return <div className={styles.trainingScope}>{children}</div>;
}
