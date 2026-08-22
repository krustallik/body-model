import Link from "next/link";
import styles from "./app-nav.module.css";

export function AppNav({ active }: { active: "dashboard" | "history" }) {
  return (
    <nav className={styles.nav} aria-label="Primary navigation">
      <Link className={active === "dashboard" ? styles.active : undefined} href="/dashboard">Dashboard</Link>
      <Link className={active === "history" ? styles.active : undefined} href="/history">History</Link>
    </nav>
  );
}
