export type NotificationSupport = {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  description: string;
};

function isStandaloneApp() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function isIosDevice() {
  return typeof navigator !== "undefined" &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
}

export function getNotificationSupport(): NotificationSupport {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return { supported: false, permission: "unsupported", description: "This browser does not expose service-worker notifications." };
  }
  const permission = Notification.permission;
  if (isIosDevice() && !isStandaloneApp()) {
    return { supported: true, permission, description: "On iPhone and iPad, add NEXUS to your Home Screen before enabling notifications." };
  }
  return { supported: true, permission, description: permission === "granted"
    ? "This device has granted notification permission."
    : permission === "denied" ? "Notifications are blocked in browser or device settings."
    : "Allow notifications on this device to receive alerts." };
}

export async function registerNotificationWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  if (!window.isSecureContext && location.hostname !== "localhost") return null;
  try { return await navigator.serviceWorker.register("/sw.js", { scope: "/" }); }
  catch (error) { console.warn("NEXUS service worker registration failed:", error); return null; }
}

export async function enableBrowserNotifications() {
  const support = getNotificationSupport();
  if (!support.supported) throw new Error(support.description);
  if (isIosDevice() && !isStandaloneApp()) throw new Error("Install NEXUS to your Home Screen first, then enable notifications from the installed app.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "Permission was denied. Change it in your browser or device settings." : "Notification permission was not granted.");
  const registration = await registerNotificationWorker();
  if (!registration) throw new Error("The notification service worker could not be installed. Make sure the site uses HTTPS.");
  return permission;
}

export async function showTestNotification() {
  if (!("Notification" in window) || Notification.permission !== "granted") throw new Error("Enable notifications on this device first.");
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification("NEXUS notifications are working", {
    body: "This device can display NEXUS notifications.", icon: "/favicon.png", badge: "/favicon.png", tag: "nexus-notification-test",
  });
}
