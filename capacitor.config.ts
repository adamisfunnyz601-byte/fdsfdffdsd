const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config = {
  appId: "com.nexusos.app",
  appName: "NEXUS",
  webDir: "dist/public",
  server: serverUrl ? { url: serverUrl, cleartext: false, androidScheme: "https" } : undefined,
  android: { allowMixedContent: false },
};

export default config;
