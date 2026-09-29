"use client";

import { useSyncExternalStore, type MouseEvent } from "react";

const TRAINING_URL_CHANGE_EVENT = "bodycast:training-url-change";
const SERVER_SEARCH_PARAM_SNAPSHOT = "\u0000bodycast-server";

function getServerSearchParamSnapshot(): string {
  return SERVER_SEARCH_PARAM_SNAPSHOT;
}

function subscribeToTrainingUrl(onChange: () => void): () => void {
  window.addEventListener(TRAINING_URL_CHANGE_EVENT, onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener(TRAINING_URL_CHANGE_EVENT, onChange);
    window.removeEventListener("popstate", onChange);
  };
}

function readTrainingSearchParam(key: string): string | null {
  return new URLSearchParams(window.location.search).get(key);
}

export function useTrainingSearchParam(key: string) {
  const value = useSyncExternalStore(
    subscribeToTrainingUrl,
    () => readTrainingSearchParam(key),
    getServerSearchParamSnapshot,
  );
  return { value, ready: value !== SERVER_SEARCH_PARAM_SNAPSHOT };
}

export function updateTrainingSearchParams(
  updates: Record<string, string | null>,
  replace = false,
): void {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }

  const href = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (href === current) return;

  window.history[replace ? "replaceState" : "pushState"](null, "", href);
  window.dispatchEvent(new Event(TRAINING_URL_CHANGE_EVENT));
}

export function trainingSearchParamHref(
  key: string,
  value: string | null,
  fallbackPath = "/training",
): string {
  const url = typeof window === "undefined"
    ? new URL(fallbackPath, "http://bodycast.invalid")
    : new URL(window.location.href);
  if (value === null || value === "") url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function currentTrainingHref(fallbackPath = "/training"): string {
  if (typeof window === "undefined") return fallbackPath;
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function handleTrainingPaginationNavigate(event: MouseEvent<HTMLAnchorElement>): void {
  if (
    event.defaultPrevented
    || event.button !== 0
    || event.metaKey
    || event.ctrlKey
    || event.shiftKey
    || event.altKey
    || event.currentTarget.target === "_blank"
  ) return;

  const destination = new URL(event.currentTarget.href);
  if (destination.origin !== window.location.origin) return;

  event.preventDefault();
  const href = `${destination.pathname}${destination.search}${destination.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (href === current) return;
  window.history.pushState(null, "", href);
  window.dispatchEvent(new Event(TRAINING_URL_CHANGE_EVENT));
}

export function parseTrainingPage(value: string | null): number {
  if (value === null) return 1;
  if (!/^[1-9]\d*$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) ? page : 1;
}
