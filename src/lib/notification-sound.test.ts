import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const storageMap = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, val: string) => { storageMap.set(key, val); },
  removeItem: (key: string) => { storageMap.delete(key); },
  clear: () => { storageMap.clear(); },
  key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
  get length() { return storageMap.size; },
} as Storage;

beforeAll(() => {
  (globalThis as any).localStorage = localStorageMock;
  (globalThis as any).window = {
    localStorage: localStorageMock,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
});

afterAll(() => {
  delete (globalThis as any).localStorage;
  delete (globalThis as any).window;
});

import {
  getCustomNotificationSound,
  removeCustomNotificationSound,
  saveCustomNotificationSound,
  playMessageNotificationSound,
  stopNotificationPreview,
} from "./notification-sound";
import {
  getUserStatus,
  setUserStatus,
  isChatMuted,
  setChatMuted,
  toggleChatMute,
  getMutedSetSnapshot,
  showDesktopNotification,
} from "./desktop-notifications";

describe("notification-sound and desktop-notifications module", () => {
  beforeEach(async () => {
    storageMap.clear();
    setUserStatus("online");
    await removeCustomNotificationSound();
  });

  afterEach(async () => {
    stopNotificationPreview();
    await removeCustomNotificationSound();
    storageMap.clear();
  });

  describe("Custom Notification Sound", () => {
    it("saves a valid custom notification MP3 and updates state", async () => {
      const file = new File(["fake-audio-bytes"], "my-chime.mp3", {
        type: "audio/mpeg",
      });

      const record = await saveCustomNotificationSound(file);
      expect(record.name).toBe("my-chime.mp3");
      expect(record.type).toBe("audio/mpeg");
      expect(getCustomNotificationSound()?.name).toBe("my-chime.mp3");

      await removeCustomNotificationSound();
      expect(getCustomNotificationSound()).toBeNull();
    });

    it("rejects non-audio files for notification sound", async () => {
      const file = new File(["text content"], "test.pdf", {
        type: "application/pdf",
      });

      await expect(saveCustomNotificationSound(file)).rejects.toThrow("Seleziona un file audio valido");
    });

    it("plays message notification sound without error", () => {
      expect(() => {
        playMessageNotificationSound();
        stopNotificationPreview();
      }).not.toThrow();
    });
  });

  describe("User Status", () => {
    it("defaults to online", () => {
      expect(getUserStatus()).toBe("online");
    });

    it("updates and persists status", () => {
      setUserStatus("dnd");
      expect(getUserStatus()).toBe("dnd");

      setUserStatus("invisible");
      expect(getUserStatus()).toBe("invisible");

      setUserStatus("online");
      expect(getUserStatus()).toBe("online");
    });
  });

  describe("Muted Chats", () => {
    it("identifies chat mute status and toggles it", () => {
      const chatId = "conv-123";
      expect(isChatMuted(chatId)).toBe(false);

      const muted = toggleChatMute(chatId);
      expect(muted).toBe(true);
      expect(isChatMuted(chatId)).toBe(true);

      setChatMuted(chatId, false);
      expect(isChatMuted(chatId)).toBe(false);
    });

    it("maintains referential stability for useSyncExternalStore snapshot equality", () => {
      const snap1 = getMutedSetSnapshot();
      const snap2 = getMutedSetSnapshot();
      expect(snap1).toBe(snap2);
    });
  });

  describe("Desktop Notifications dispatch", () => {
    it("suppresses notification when user status is DND", async () => {
      setUserStatus("dnd");
      const result = await showDesktopNotification({
        title: "Test",
        body: "Hello",
        chatId: "conv-1",
      });
      expect(result).toBe(false);
    });

    it("suppresses notification when chat is muted", async () => {
      setUserStatus("online");
      setChatMuted("conv-muted", true);

      const result = await showDesktopNotification({
        title: "Test",
        body: "Hello",
        chatId: "conv-muted",
      });
      expect(result).toBe(false);
    });
  });
});
