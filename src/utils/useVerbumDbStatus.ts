import { useState, useEffect } from 'react';

export interface VerbumDbStatus {
  ready: boolean;
  path: string | null;
  sizeMb?: number;
  building?: boolean;
  articleCount?: number;
  dictsLoaded?: string[];
  lastLog?: string;
  fallbackActive?: boolean;
}

let globalVerbumStatus: VerbumDbStatus = {
  ready: false,
  path: null,
};

let globalChecking = false;
let checkInterval: ReturnType<typeof setInterval> | null = null;
const readyListeners = new Set<(ready: boolean) => void>();
const statusListeners = new Set<(status: VerbumDbStatus) => void>();

function notify(status: VerbumDbStatus) {
  globalVerbumStatus = status;
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

import { isTauriDesktop, getDesktopVerbumStatus } from './tauriBridge';

export async function checkVerbumDbStatus(): Promise<VerbumDbStatus> {
  if (isTauriDesktop()) {
    try {
      const dStatus = await getDesktopVerbumStatus();
      if (dStatus) {
        const status: VerbumDbStatus = {
          ready: dStatus.ready,
          path: dStatus.path || null,
          sizeMb: typeof dStatus.size_mb === 'number' ? dStatus.size_mb : undefined,
          articleCount: typeof dStatus.total_articles === 'number' ? dStatus.total_articles : undefined,
          lastLog: dStatus.message,
        };
        notify(status);
        return status;
      }
    } catch (_) {}
  }

  try {
    const res = await fetch('/api/verbum/db-status', { cache: 'no-store' });
    if (res.ok) {
      const data: VerbumDbStatus = await res.json();
      notify(data);
      return data;
    }
  } catch (_) {}
  const fallbackStatus: VerbumDbStatus = { ready: false, path: null };
  notify(fallbackStatus);
  return fallbackStatus;
}

export async function triggerVerbumDbInit(): Promise<void> {
  try {
    await fetch('/api/verbum/db-init', { method: 'POST' });
    startPollingIfNeeded(true);
    await checkVerbumDbStatus();
  } catch (_) {}
}

function startPollingIfNeeded(force = false) {
  if (!force && globalVerbumStatus.ready) return;
  if (!force && globalChecking) return;
  globalChecking = true;

  checkVerbumDbStatus().then((status) => {
    if (!force && status.ready) {
      globalChecking = false;
      return;
    }

    let attempts = 0;
    if (checkInterval) clearInterval(checkInterval);

    checkInterval = setInterval(async () => {
      attempts++;
      const current = await checkVerbumDbStatus();

      // If finished successfully, stop polling
      if (current.ready) {
        if (checkInterval) {
          clearInterval(checkInterval);
          checkInterval = null;
        }
        globalChecking = false;
        return;
      }

      // If not building and too many attempts, back off
      if (!current.building && attempts >= 20) {
        if (checkInterval) {
          clearInterval(checkInterval);
          checkInterval = null;
        }
        globalChecking = false;
        return;
      }

      // If building is in progress, allow up to 150 attempts (~5 minutes)
      if (current.building && attempts >= 150) {
        if (checkInterval) {
          clearInterval(checkInterval);
          checkInterval = null;
        }
        globalChecking = false;
      }
    }, 2000);
  });
}

function listenersHelper<T>(set: Set<(val: T) => void>, fn: (val: T) => void) {
  set.add(fn);
}

export function useVerbumDbStatus(): boolean {
  const [ready, setReady] = useState<boolean>(globalVerbumStatus.ready);

  useEffect(() => {
    listenersHelper(readyListeners, setReady);
    startPollingIfNeeded();
    return () => {
      readyListeners.delete(setReady);
    };
  }, []);

  return ready;
}

export function useVerbumDbFullStatus(): VerbumDbStatus {
  const [status, setStatus] = useState<VerbumDbStatus>(globalVerbumStatus);

  useEffect(() => {
    listenersHelper(statusListeners, setStatus);
    startPollingIfNeeded();
    return () => {
      statusListeners.delete(setStatus);
    };
  }, []);

  return status;
}
