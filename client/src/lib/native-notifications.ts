type NativePlugin = Record<string, (...args: any[]) => Promise<any>> & {
  addListener?: (eventName: string, listener: (event: any) => void) => Promise<{ remove: () => Promise<void> }>;
};
type CapacitorBridge = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, NativePlugin>;
};
declare global { interface Window { Capacitor?: CapacitorBridge } }

const plugins = () => window.Capacitor?.Plugins;
export const isNativeApp = () => Boolean(window.Capacitor?.isNativePlatform?.());
export const nativePlatform = () => window.Capacitor?.getPlatform?.() || "web";

export async function enableNativeNotifications() {
  const push = plugins()?.PushNotifications;
  if (!isNativeApp() || !push) return false;
  const current = await push.checkPermissions?.();
  const permission = current?.receive === "granted" ? current : await push.requestPermissions?.();
  if (permission?.receive !== "granted") throw new Error("Notification permission was not granted by the device.");
  await push.register?.();
  await push.addListener?.("registration", (token: { value?: string }) => {
    window.dispatchEvent(new CustomEvent("nexus:push-token", { detail: { token: token.value, platform: nativePlatform() } }));
  });
  await push.addListener?.("registrationError", (error: unknown) => {
    window.dispatchEvent(new CustomEvent("nexus:push-error", { detail: error }));
  });
  await push.addListener?.("pushNotificationReceived", (notification: unknown) => {
    window.dispatchEvent(new CustomEvent("nexus:push-received", { detail: notification }));
  });
  await push.addListener?.("pushNotificationActionPerformed", (action: unknown) => {
    window.dispatchEvent(new CustomEvent("nexus:push-opened", { detail: action }));
  });
  return true;
}

export async function showNativeTestNotification() {
  const local = plugins()?.LocalNotifications;
  if (!isNativeApp() || !local) return false;
  const permission = await local.checkPermissions?.();
  const granted = permission?.display === "granted" ? permission : await local.requestPermissions?.();
  if (granted?.display !== "granted") throw new Error("Local notification permission was not granted.");
  await local.schedule({ notifications: [{
    id: 74001,
    title: "NEXUS notifications are working",
    body: "This Android or iOS device can display native notifications.",
    schedule: { at: new Date(Date.now() + 1200) },
    sound: "default",
    smallIcon: "ic_stat_icon_config_sample",
  }] });
  return true;
}
