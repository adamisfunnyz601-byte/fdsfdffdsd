const config = {
  appId: "com.nexusos.app",
  appName: "NEXUS",
  // Keep the frontend bundled locally; the API remains hosted on Render.
  webDir: "dist/public",
  android: { allowMixedContent: false },
  // Use Capacitor's native networking/cookie bridge for cross-origin API
  // requests. iOS WebKit otherwise treats the remote API cookie as a
  // third-party cookie and may drop the session after a successful login.
  plugins: {
    CapacitorHttp: { enabled: true },
    CapacitorCookies: { enabled: true },
  },
};

export default config;
