const config = {
  appId: "com.nexusos.app",
  appName: "NEXUS",
  // The complete Vite-built NEXUS frontend is copied into the IPA by
  // Capacitor. Do not set server.url: the app must not load the hosted site.
  webDir: "dist/public",
  android: { allowMixedContent: false },
};

export default config;
