import { beforeEach, describe, expect, it } from "vitest";

import {
  clearInlineNotificationScope,
  dismissInlineNotification,
  inlineNotificationStore,
  resetInlineNotifications,
  setInlineNotification,
} from "../src/renderer/src/notifications/inlineNotificationStore";
import {
  clearNotificationScope,
  dismissNotification,
  notify,
} from "../src/renderer/src/notifications/notificationCenter";
import {
  notificationDuration,
  resolveNotificationChannel,
} from "../src/renderer/src/notifications/notificationPolicy";

describe("notification policy", () => {
  it("routes ordinary success and info notifications to toast", () => {
    expect(resolveNotificationChannel({ level: "success", message: "saved" })).toBe("toast");
    expect(resolveNotificationChannel({
      level: "info",
      message: "ready",
      scope: "settings",
    })).toBe("toast");
  });

  it("routes scoped warning, error, and loading notifications inline", () => {
    for (const level of ["warning", "error", "loading"] as const) {
      expect(resolveNotificationChannel({
        level,
        message: "feedback",
        scope: "settings",
      })).toBe("inline");
    }
  });

  it("honors an explicitly selected channel", () => {
    expect(resolveNotificationChannel({
      channel: "toast",
      level: "error",
      message: "global error",
      scope: "settings",
    })).toBe("toast");
    expect(resolveNotificationChannel({
      channel: "inline",
      level: "success",
      message: "local success",
      scope: "settings",
    })).toBe("inline");
  });

  it("uses level defaults unless a duration is provided", () => {
    expect(notificationDuration("success")).toBe(3_000);
    expect(notificationDuration("info")).toBe(4_000);
    expect(notificationDuration("warning")).toBe(6_000);
    expect(notificationDuration("error")).toBe(0);
    expect(notificationDuration("loading")).toBe(0);
    expect(notificationDuration("success", 750)).toBe(750);
  });
});

describe("inline notification store", () => {
  beforeEach(() => resetInlineNotifications());

  it("keeps only the latest notification for a scope", () => {
    setInlineNotification({
      id: "first",
      level: "loading",
      message: "loading",
      title: null,
      scope: "settings",
      action: null,
    });
    setInlineNotification({
      id: "second",
      level: "success",
      message: "done",
      title: null,
      scope: "settings",
      action: null,
    });

    expect(inlineNotificationStore.getState().byScope.settings).toMatchObject({
      id: "second",
      message: "done",
    });
  });

  it("dismisses by id without affecting other scopes", () => {
    setInlineNotification({
      id: "settings-error",
      level: "error",
      message: "settings",
      title: null,
      scope: "settings",
      action: null,
    });
    setInlineNotification({
      id: "thread-error",
      level: "error",
      message: "thread",
      title: null,
      scope: "thread",
      action: null,
    });

    dismissInlineNotification("settings-error");
    expect(inlineNotificationStore.getState().byScope.settings).toBeUndefined();
    expect(inlineNotificationStore.getState().byScope.thread?.id).toBe("thread-error");
  });

  it("clears a complete scope", () => {
    setInlineNotification({
      id: "settings-error",
      level: "error",
      message: "settings",
      title: null,
      scope: "settings",
      action: null,
    });
    clearInlineNotificationScope("settings");
    expect(inlineNotificationStore.getState().byScope).toEqual({});
  });

  it("updates a deduplicated inline notification in place", () => {
    const firstId = notify({
      channel: "inline",
      scope: "settings",
      level: "loading",
      message: "loading",
      dedupeKey: "settings-operation",
    });
    const secondId = notify({
      channel: "inline",
      scope: "settings",
      level: "success",
      message: "done",
      dedupeKey: "settings-operation",
    });

    expect(secondId).toBe(firstId);
    expect(inlineNotificationStore.getState().byScope.settings).toMatchObject({
      id: firstId,
      level: "success",
      message: "done",
    });
  });

  it("dismisses and clears inline notifications through the public API", () => {
    const id = notify({
      channel: "inline",
      scope: "settings",
      level: "error",
      message: "failed",
    });
    dismissNotification(id);
    expect(inlineNotificationStore.getState().byScope.settings).toBeUndefined();

    notify({
      channel: "inline",
      scope: "settings",
      level: "warning",
      message: "warning",
    });
    clearNotificationScope("settings");
    expect(inlineNotificationStore.getState().byScope.settings).toBeUndefined();
  });
});
