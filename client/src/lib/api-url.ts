import { Capacitor } from "@capacitor/core";

const NEXUS_API_ORIGIN = "https://nexus-api-rcmi.onrender.com";

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const configured = (import.meta as any).env?.VITE_API_BASE_URL as string | undefined;
  const nativeShell = Capacitor.isNativePlatform() || window.location.protocol === "file:";
  const base = (configured || (nativeShell ? NEXUS_API_ORIGIN : window.location.origin)).replace(/\/+$/, "");
  return `${base}/${path.replace(/^\/+/, "")}`;
}


// Route every relative API request from bundled iOS/Android builds to the
// hosted NEXUS server. Many older screens use fetch("/api/...") directly;
// without this bridge those calls target the Capacitor file:// origin.
export function installApiFetchBridge(): void {
  if (typeof window === "undefined" || (window as any).__nexusApiFetchBridge) return;
  const nativeShell = Capacitor.isNativePlatform() || window.location.protocol === "file:";
  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = input instanceof Request ? input.url : String(input);
    const isRelativeApi = requestUrl.startsWith("/api/") || requestUrl.startsWith("api/");
    if (!isRelativeApi) return originalFetch(input, init);
    const target = apiUrl(requestUrl);
    if (input instanceof Request) {
      const request = new Request(target, input);
      return originalFetch(nativeShell ? new Request(request, { credentials: "include" }) : request, nativeShell ? { ...init, credentials: "include" } : init);
    }
    return originalFetch(target, {
      ...init,
      credentials: nativeShell ? "include" : (init?.credentials || "same-origin"),
    });
  }) as typeof window.fetch;
  (window as any).__nexusApiFetchBridge = true;
}
