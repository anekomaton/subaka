import { useState, useEffect } from 'react';
import { isTauriDesktop, getGrammarDbStatus as getDesktopGrammarDbStatus } from './tauriBridge';

export interface GrammarDbStatus {
  ready: boolean;
  path: string | null;
  sizeMb?: number;
  driver?: string;
  building?: boolean;
  fallbackActive?: boolean;
  hasParts?: boolean;
  lastLog?: string;
  isDesktop?: boolean;
}

let globalStatus: GrammarDbStatus = {
  ready: false,
  path: null,
};

let globalChecking = false;
let checkInterval: ReturnType<typeof setInterval> | null = null;
const readyListeners = new Set<(ready: boolean) => void>();
const statusListeners = new Set<(status: GrammarDbStatus) => void>();

function notify(status: GrammarDbStatus) {
  globalStatus = status;
  readyListeners.forEach((fn) => {
    try {
      fn(status.ready);
    } catch (_) {}
  });
  statusListeners.forEach((fn) => {
    try {
      fn(status);
    } catch (_) {}
  });
}

export async function checkGrammarDbStatus(): Promise<GrammarDbStatus> {
  if (isTauriDesktop()) {
    try {
      const desktopStatus = await getDesktopGrammarDbStatus();
      if (desktopStatus) {
        const status: GrammarDbStatus = {
          ready: desktopStatus.ready,
          path: desktopStatus.path || null,
          sizeMb: typeof desktopStatus.size_mb === 'number' ? desktopStatus.size_mb : undefined,
          driver: desktopStatus.driver,
          lastLog: desktopStatus.message,
          isDesktop: true,
        };
        notify(status);
        return status;
      }
    } catch (_) {}
    // If desktop status was already ready, preserve it rather than dropping to false
    if (globalStatus.ready) {
      return globalStatus;
    }
    const fallbackStatus: GrammarDbStatus = { ready: false, path: null, isDesktop: true };
    notify(fallbackStatus);
    return fallbackStatus;
  }

  try {
    const res = await fetch('/api/grammardb/status', { cache: 'no-store' });
    if (res.ok) {
      const data: GrammarDbStatus = await res.json();
      notify(data);
      if (!data.ready && !data.building) {
        // Auto-trigger background preparation on server if not ready yet
        fetch('/api/grammardb/init', { method: 'POST' }).catch(() => {});
      }
      return data;
    }
  } catch (_) {}
  const fallbackStatus: GrammarDbStatus = { ready: false, path: null };
  notify(fallbackStatus);
  return fallbackStatus;
}

export async function triggerGrammarDbInit(): Promise<void> {
  try {
    await fetch('/api/grammardb/init', { method: 'POST' });
    await checkGrammarDbStatus();
  } catch (_) {}
}

function startPollingIfNeeded() {
  if (globalStatus.ready) return;
  if (globalChecking) return;
  globalChecking = true;

  checkGrammarDbStatus().then((status) => {
    if (status.ready) {
      globalChecking = false;
      return;
    }

    let attempts = 0;
    if (checkInterval) clearInterval(checkInterval);

    checkInterval = setInterval(async () => {
      attempts++;
      const current = await checkGrammarDbStatus();

      // If finished successfully, stop polling
      if (current.ready) {
        if (checkInterval) {
          clearInterval(checkInterval);
          checkInterval = null;
        }
        globalChecking = false;
        return;
      }

      // If not building and too many attempts (e.g. 30 = 1 minute), back off
      if (!current.building && attempts >= 30) {
        if (checkInterval) {
          clearInterval(checkInterval);
          checkInterval = null;
        }
        globalChecking = false;
        return;
      }

      // If building is in progress, allow up to 200 attempts (~8 minutes)
      if (current.building && attempts >= 200) {
        if (checkInterval) {
          clearInterval(checkInterval);
          checkInterval = null;
        }
        globalChecking = false;
      }
    }, 2500);
  });
}

export function useGrammarDbStatus(): boolean {
  const [ready, setReady] = useState<boolean>(globalStatus.ready);

  useEffect(() => {
    listenersHelper(readyListeners, setReady);
    startPollingIfNeeded();
    return () => {
      readyListeners.delete(setReady);
    };
  }, []);

  return ready;
}

export function useGrammarDbFullStatus(): GrammarDbStatus {
  const [status, setStatus] = useState<GrammarDbStatus>(globalStatus);

  useEffect(() => {
    listenersHelper(statusListeners, setStatus);
    startPollingIfNeeded();
    return () => {
      statusListeners.delete(setStatus);
    };
  }, []);

  return status;
}

function listenersHelper<T>(set: Set<(v: T) => void>, item: (v: T) => void) {
  set.add(item);
}

