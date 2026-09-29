import styles from "./demo-data-badge.module.css";

export function DemoDataBadge({ active }: { active: boolean }) {
  if (!active) return null;
  return <span className={styles.badge}>DEMO DATA</span>;
}
