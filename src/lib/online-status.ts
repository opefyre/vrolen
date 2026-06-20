/**
 * VROL-428 — online/offline detection hook.
 *
 * Thin wrapper around `navigator.onLine` + the `online` / `offline` events
 * so any component can render an offline indicator. Defaults to `true` so
 * SSR / pre-mount renders don't flash an offline pill.
 */

import { useEffect, useState } from "react";

function readOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(readOnline);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOnline = (): void => {
      setOnline(true);
    };
    const onOffline = (): void => {
      setOnline(false);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);
  return online;
}
