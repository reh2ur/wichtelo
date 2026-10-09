"use client";

import { useSyncExternalStore } from "react";

export interface EmailWarning {
  failed: number;
  total: number;
}

const key = (slug: string) => `draw-email-warning:${slug}`;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

/** Best-effort bridge: draw button unmounts after the first draw. */
export function setEmailWarning(slug: string, failed: number, total: number) {
  try {
    sessionStorage.setItem(key(slug), JSON.stringify({ failed, total }));
    emit();
  } catch {
    // storage unavailable — warning simply not shown
  }
}

export function clearEmailWarning(slug: string) {
  try {
    sessionStorage.removeItem(key(slug));
  } catch {}
  emit();
}

function readRaw(slug: string): string | null {
  try {
    return sessionStorage.getItem(key(slug));
  } catch {
    return null;
  }
}

export function useStoredEmailWarning(slug: string): EmailWarning | null {
  const raw = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => readRaw(slug),
    () => null,
  );
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EmailWarning;
  } catch {
    return null;
  }
}
