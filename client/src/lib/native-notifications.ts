import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { LocalNotifications } from "@capacitor/local-notifications";

export const isNativeApp = () => Capacitor.isNativePlatform();
export const nativePlatform = () => Capacitor.getPlatform();

export async function enableNativeNotifications() {
  if (!isNativeApp()) return false;
  const current = await PushNotifications.checkPermissions();
  const permission = current.receive === "granted" ? current : await PushNotifications.requestPermissions();
  if (permission.receive !== "granted") {
    throw new Error("Notification permission was not granted by the device.");
  }

  await PushNotifications.addListener("registration", (token) => {
    window.dispatchEvent(new CustomEvent("nexus:push-token", {
      detail: { token: token.value, platform: nativePlatform() },
    }));
  });
  await PushNotifications.addListener("registrationError", (error) => {
    window.dispatchEvent(new CustomEvent("nexus:push-error", { detail: error }));
  });
  await PushNotifications.addListener("pushNotificationReceived", (notification) => {
    window.dispatchEvent(new CustomEvent("nexus:push-received", { detail: notification }));
  });
  await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    window.dispatchEvent(new CustomEvent("nexus:push-opened", { detail: action }));
  });
  await PushNotifications.register();
  return true;
}

export async function showNativeTestNotification() {
  if (!isNativeApp()) return false;
  const current = await LocalNotifications.checkPermissions();
  const permission = current.display === "granted" ? current : await LocalNotifications.requestPermissions();
  if (permission.display !== "granted") {
    throw new Error("Local notification permission was not granted.");
  }
  await LocalNotifications.schedule({
    notifications: [{
      id: 74001,
      title: "NEXUS notifications are working",
      body: "This Android or iOS device can display native notifications.",
      schedule: { at: new Date(Date.now() + 1200) },
      sound: "default",
    }],
  });
  return true;
}
