const remoteServerUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config = {
  appId: "com.nexusos.app",
  appName: "NEXUS",
  // Keep normal builds bundled. The iOS release workflow opts into the
  // first-party hosted origin so WKWebView uses the same-origin Neon session
  // cookie instead of treating every API request as third-party storage.
  webDir: "dist/public",
  ...(remoteServerUrl ? { server: { url: remoteServerUrl, cleartext: false } } : {}),
  android: { allowMixedContent: false },
};

export default config;
