import { useSyncExternalStore } from "react";

export type UserStatus = "online" | "dnd" | "invisible";

const USER_STATUS_KEY = "hush:user-status";
const MUTED_CHATS_KEY = "hush:muted-chats";

const statusListeners = new Set<() => void>();
const mutedListeners = new Set<() => void>();

function notifyStatusSubscribers() {
  statusListeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

function notifyMutedSubscribers() {
  mutedListeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

export function getUserStatus(): UserStatus {
  if (typeof localStorage === "undefined") return "online";
  const val = localStorage.getItem(USER_STATUS_KEY);
  if (val === "dnd" || val === "invisible" || val === "online") {
    return val;
  }
  return "online";
}

export function setUserStatus(status: UserStatus): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(USER_STATUS_KEY, status);
  notifyStatusSubscribers();
}

export function useUserStatus(): UserStatus {
  return useSyncExternalStore(
    (callback) => {
      statusListeners.add(callback);
      const onStorage = (e: StorageEvent) => {
        if (e.key === USER_STATUS_KEY) callback();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        statusListeners.delete(callback);
        window.removeEventListener("storage", onStorage);
      };
    },
    getUserStatus,
    () => "online"
  );
}

export function getMutedChatIds(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(MUTED_CHATS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function isChatMuted(chatId: string | null | undefined): boolean {
  if (!chatId) return false;
  const list = getMutedChatIds();
  return list.includes(chatId);
}

export function setChatMuted(chatId: string, muted: boolean): void {
  if (!chatId || typeof localStorage === "undefined") return;
  const current = new Set(getMutedChatIds());
  if (muted) {
    current.add(chatId);
  } else {
    current.delete(chatId);
  }
  localStorage.setItem(MUTED_CHATS_KEY, JSON.stringify(Array.from(current)));
  notifyMutedSubscribers();
}

export function toggleChatMute(chatId: string): boolean {
  const currentMuted = isChatMuted(chatId);
  const next = !currentMuted;
  setChatMuted(chatId, next);
  return next;
}

export function useMutedChats(): Set<string> {
  return useSyncExternalStore(
    (callback) => {
      mutedListeners.add(callback);
      const onStorage = (e: StorageEvent) => {
        if (e.key === MUTED_CHATS_KEY) callback();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        mutedListeners.delete(callback);
        window.removeEventListener("storage", onStorage);
      };
    },
    () => new Set(getMutedChatIds()),
    () => new Set<string>()
  );
}

export interface ShowDesktopNotificationOptions {
  title: string;
  body: string;
  tag?: string;
  chatId?: string;
  onClick?: () => void;
}

/**
 * Dispatches a native desktop notification via Electron IPC or standard Web Notification API.
 * Suppressed if user status is DND or if the chat is muted.
 */
export async function showDesktopNotification(options: ShowDesktopNotificationOptions): Promise<boolean> {
  const { title, body, tag, chatId, onClick } = options;

  // Never notify if DND
  if (getUserStatus() === "dnd") {
    return false;
  }

  // Never notify if chat is muted
  if (chatId && isChatMuted(chatId)) {
    return false;
  }

  // 1. Electron environment
  const bridge = (window as unknown as {
    hushWindow?: { showNotification?: (opts: { title: string; body: string; tag?: string }) => Promise<void>; onNotificationClick?: (callback: () => void) => () => void };
    electronAPI?: { showNotification?: (opts: { title: string; body: string; tag?: string }) => Promise<void>; onNotificationClick?: (callback: () => void) => () => void };
  });
  const electronAPI = bridge?.hushWindow || bridge?.electronAPI;
  if (electronAPI?.showNotification) {
    try {
      await electronAPI.showNotification({ title, body, tag });
      if (onClick && electronAPI.onNotificationClick) {
        const cleanup = electronAPI.onNotificationClick(() => {
          onClick();
          cleanup();
        });
      }
      return true;
    } catch {
      // Fallback to browser notification
    }
  }

  // 2. Web Notification API
  if (typeof Notification !== "undefined") {
    try {
      let perm = Notification.permission;
      if (perm === "default") {
        perm = await Notification.requestPermission();
      }
      if (perm === "granted") {
        const notif = new Notification(title, {
          body,
          tag,
          silent: true, // Audio handled by Hush notification-sound manager
          icon: "/favicon.ico",
        });

        notif.onclick = () => {
          try {
            window.focus();
          } catch {}
          onClick?.();
          notif.close();
        };

        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}
