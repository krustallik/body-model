import Link from "next/link";
import styles from "./app-nav.module.css";

export function AppNav({ active }: { active: "dashboard" | "history" | "forecast" | "profile" }) {
  return (
    <nav className={styles.nav} aria-label="Primary navigation">
      <Link className={active === "dashboard" ? styles.active : undefined} href="/dashboard">Dashboard</Link>
      <Link className={active === "history" ? styles.active : undefined} href="/history">History</Link>
      <Link className={active === "forecast" ? styles.active : undefined} href="/forecast">Forecast</Link>
      <Link className={active === "profile" ? styles.active : undefined} href="/settings/profile">Profile</Link>
    </nav>
  );
}
