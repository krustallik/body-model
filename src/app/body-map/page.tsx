import type { Metadata } from "next";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import BodyMapExperience from "@/components/body-map/body-map-experience";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Body Map · BodyCast",
  description: "Interactive anatomical Body Map with selectable muscle regions.",
};

export default function BodyMapPage() {
  return (
    <>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/dashboard" aria-label="BodyCast home">BodyCast</Link>
        <AppNav active="bodyMap" />
      </header>
      <BodyMapExperience delivery="public" />
    </>
  );
}