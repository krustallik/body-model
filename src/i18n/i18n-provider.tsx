"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export type Locale = "uk" | "en";

type I18nContextValue = {
  locale: Locale;
  intlLocale: "uk-UA" | "en-US";
  setLocale: (locale: Locale) => void;
};

const I18nContext = createContext<I18nContextValue>({
  locale: "en",
  intlLocale: "en-US",
  setLocale: () => undefined,
});

function isLocale(value: unknown): value is Locale {
  return value === "uk" || value === "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("uk");
  const pathname = usePathname();

  const applyLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    document.documentElement.lang = nextLocale;
    window.localStorage.setItem("bodycast-locale", nextLocale);
  }, []);

  useEffect(() => {
    const storedLocale = window.localStorage.getItem("bodycast-locale");
    const storedLocaleTimer = isLocale(storedLocale)
      ? window.setTimeout(() => applyLocale(storedLocale), 0)
      : null;

    let active = true;
    fetch("/api/v1/profile", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((body: { profile?: { locale?: unknown } } | null) => {
        if (active && isLocale(body?.profile?.locale)) applyLocale(body.profile.locale);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (storedLocaleTimer !== null) window.clearTimeout(storedLocaleTimer);
    };
  }, [applyLocale]);

  useEffect(() => {
    const uk = locale === "uk";
    const section = pathname.startsWith("/forecast") ? (uk ? "Прогноз" : "Forecast")
      : pathname.startsWith("/history") ? (uk ? "Історія" : "History")
        : pathname.startsWith("/settings/profile") ? (uk ? "Профіль" : "Profile")
          : (uk ? "Огляд" : "Dashboard");
    document.title = `${section} · BodyCast`;
    const description = uk ? "Персональний застосунок для відстеження здоров’я та прогнозування ваги." : "Personal health and weight forecasting application.";
    document.querySelector('meta[name="description"]')?.setAttribute("content", description);
  }, [locale, pathname]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    intlLocale: locale === "uk" ? "uk-UA" : "en-US",
    setLocale: applyLocale,
  }), [applyLocale, locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
