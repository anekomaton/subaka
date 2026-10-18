/**
 * Cross-Tab Coordination for Single Browser Instance
 * Ensures only one active browser tab operates on IndexedDB at a time,
 * avoiding workspace race conditions and state overwrites.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { isTauriDesktop } from './tauriBridge';

const HEARTBEAT_KEY = 'subaka_active_tab_heartbeat';
const SESSION_TAB_KEY = 'subaka_tab_id';
const CHANNEL_NAME = 'subaka_tab_channel';
const HEARTBEAT_INTERVAL_MS = 2000;
const HEARTBEAT_TIMEOUT_MS = 5000;

interface TabHeartbeat {
  tabId: string;
  timestamp: number;
}

export function useSingleBrowserTab() {
  const [isDuplicate, setIsDuplicate] = useState(false);
  const tabIdRef = useRef<string>('');
  const channelRef = useRef<BroadcastChannel | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initialize unique tab ID (persisted across reloads in the same tab via sessionStorage)
  if (!tabIdRef.current) {
    if (typeof window !== 'undefined') {
      try {
        let existingId = sessionStorage.getItem(SESSION_TAB_KEY);
        if (!existingId) {
          existingId = 'tab_' + Math.random().toString(36).slice(2, 9) + '_' + Date.now().toString(36);
          sessionStorage.setItem(SESSION_TAB_KEY, existingId);
        }
        tabIdRef.current = existingId;
      } catch {
        tabIdRef.current = 'tab_' + Math.random().toString(36).slice(2, 9);
      }
    }
  }

  const claimPrimary = useCallback(() => {
    try {
      const myId = tabIdRef.current;
      const data: TabHeartbeat = { tabId: myId, timestamp: Date.now() };
      localStorage.setItem(HEARTBEAT_KEY, JSON.stringify(data));
      setIsDuplicate(false);
      channelRef.current?.postMessage({ type: 'TAKE_OVER', sender: myId });
    } catch {}
  }, []);

  const sendHeartbeat = useCallback(() => {
    try {
      const myId = tabIdRef.current;
      const currentRaw = localStorage.getItem(HEARTBEAT_KEY);
      if (currentRaw) {
        const current: TabHeartbeat = JSON.parse(currentRaw);
        // Only write heartbeat if this tab is the registered primary
        if (current.tabId === myId) {
          localStorage.setItem(HEARTBEAT_KEY, JSON.stringify({ tabId: myId, timestamp: Date.now() }));
        }
      } else {
        localStorage.setItem(HEARTBEAT_KEY, JSON.stringify({ tabId: myId, timestamp: Date.now() }));
      }
    } catch {}
  }, []);

  useEffect(() => {
    // Desktop edition uses native Windows Mutex, ignore browser tab coordination
    if (isTauriDesktop() || typeof window === 'undefined') {
      return;
    }

    const myId = tabIdRef.current;

    // Check if BroadcastChannel is supported
    let channel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel(CHANNEL_NAME);
        channelRef.current = channel;
      }
    } catch {}

    // Check existing heartbeat
    let hasLivePrimary = false;
    try {
      const stored = localStorage.getItem(HEARTBEAT_KEY);
      if (stored) {
        const parsed: TabHeartbeat = JSON.parse(stored);
        const age = Date.now() - parsed.timestamp;
        // If heartbeat is fresh and belongs to another tab, this is a duplicate
        if (age < HEARTBEAT_TIMEOUT_MS && parsed.tabId !== myId) {
          hasLivePrimary = true;
        }
      }
    } catch {}

    if (hasLivePrimary) {
      setIsDuplicate(true);
      // Notify the primary tab to show visual activity (title notification)
      channel?.postMessage({ type: 'PING', sender: myId });
    } else {
      // We are the primary tab
      claimPrimary();
    }

    // Channel listener
    const handleMessage = (event: MessageEvent) => {
      const { type, sender } = event.data || {};
      if (!type || sender === myId) return;

      if (type === 'PING') {
        // Someone attempted to open a new tab; reply and briefly flash title
        channel?.postMessage({ type: 'PONG', sender: myId });
        flashActiveTabNotification();
      } else if (type === 'PONG') {
        // Confirmed another live primary exists
        setIsDuplicate(true);
      } else if (type === 'PRIMARY_CLOSED') {
        // The previous primary tab closed, we can become primary automatically
        claimPrimary();
      } else if (type === 'TAKE_OVER') {
        // Another tab explicitly requested take-over
        setIsDuplicate(true);
      }
    };

    if (channel) {
      channel.addEventListener('message', handleMessage);
    }

    // Heartbeat timer for active tab
    heartbeatTimerRef.current = setInterval(() => {
      sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    // Clean up on tab close
    const handleBeforeUnload = () => {
      try {
        const stored = localStorage.getItem(HEARTBEAT_KEY);
        if (stored) {
          const parsed: TabHeartbeat = JSON.parse(stored);
          if (parsed.tabId === myId) {
            localStorage.removeItem(HEARTBEAT_KEY);
            channel?.postMessage({ type: 'PRIMARY_CLOSED', sender: myId });
          }
        }
      } catch {}
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
      }
      if (channel) {
        channel.removeEventListener('message', handleMessage);
        channel.close();
      }
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [claimPrimary, sendHeartbeat]);

  return {
    isDuplicate,
    takeOver: claimPrimary,
  };
}

let flashTimer: ReturnType<typeof setInterval> | null = null;
function flashActiveTabNotification() {
  if (typeof document === 'undefined') return;
  if (flashTimer) return;

  const originalTitle = document.title;
  let count = 0;

  flashTimer = setInterval(() => {
    count++;
    document.title = count % 2 === 1 ? '🔔 [Актыўная ўкладка] SUBaka' : originalTitle;
    if (count >= 6) {
      if (flashTimer) {
        clearInterval(flashTimer);
        flashTimer = null;
      }
      document.title = originalTitle;
    }
  }, 700);

  const handleFocus = () => {
    if (flashTimer) {
      clearInterval(flashTimer);
      flashTimer = null;
    }
    document.title = originalTitle;
    window.removeEventListener('focus', handleFocus);
  };
  window.addEventListener('focus', handleFocus);
}
