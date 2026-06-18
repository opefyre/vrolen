/**
 * Sidebar collapsed state — persisted to localStorage so it survives reloads.
 * Same vanilla-store-with-useSyncExternalStore pattern as the theme store.
 */
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "vrolen.sidebar.collapsed";

function readInitial(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage?.getItem?.(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

let collapsed = readInitial();
const listeners = new Set<() => void>();

export function isSidebarCollapsed(): boolean {
  return collapsed;
}

export function setSidebarCollapsed(next: boolean): void {
  if (collapsed === next) return;
  collapsed = next;
  try {
    window.localStorage?.setItem?.(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // Persistence unavailable; state still applies in memory.
  }
  for (const fn of [...listeners]) fn();
}

export function toggleSidebar(): void {
  setSidebarCollapsed(!collapsed);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => collapsed,
    () => collapsed,
  );
}
