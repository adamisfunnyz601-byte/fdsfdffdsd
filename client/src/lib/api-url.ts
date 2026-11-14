import { Capacitor } from "@capacitor/core";

const NEXUS_API_ORIGIN = "https://nexus-api-rcmi.onrender.com";

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const configured = (import.meta as any).env?.VITE_API_BASE_URL as string | undefined;
  const nativeShell = Capacitor.isNativePlatform() || window.location.protocol === "file:";
  const base = (configured || (nativeShell ? NEXUS_API_ORIGIN : window.location.origin)).replace(/\/+$/, "");
  return `${base}/${path.replace(/^\/+/, "")}`;
}
