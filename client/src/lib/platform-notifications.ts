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
  if (typeof window === "undefined" || !("Notification" in window)) {
    return { supported: false, permission: "unsupported", description: "This device does not expose notifications in this app. You can still sign in and use calls." };
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
  // Service workers are available on HTTPS websites and installed PWAs, but not
  // inside Electron file:// windows. Notification permission still works there.
  if ("serviceWorker" in navigator) await registerNotificationWorker();
  return permission;
}

export async function showTestNotification() {
  if (!("Notification" in window) || Notification.permission !== "granted") throw new Error("Enable notifications on this device first.");
  const options: NotificationOptions = { body: "This device can display NEXUS notifications.", icon: "/favicon.png", tag: "nexus-notification-test" };
  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification("NEXUS notifications are working", { ...options, badge: "/favicon.png" });
  } else {
    new Notification("NEXUS notifications are working", options);
  }
}
