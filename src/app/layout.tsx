import type { Metadata } from "next";
import type { ReactNode } from "react";
import { I18nProvider } from "@/i18n/i18n-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "BodyCast",
  description: "Personal health and weight forecasting application",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="uk">
      <body><I18nProvider>{children}</I18nProvider></body>
    </html>
  );
}
