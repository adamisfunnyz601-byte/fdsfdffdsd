import { apiUrl } from "@/lib/api-url";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { CyberInput } from "@/components/CyberInput";
import { CyberButton } from "@/components/CyberButton";
import { Lock, UserRoundPlus, Eye, EyeOff } from "lucide-react";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { startAuthentication } from "@simplewebauthn/browser";
import { Capacitor } from "@capacitor/core";
import { enableBrowserNotifications } from "@/lib/platform-notifications";

export default function Login() {
  const [mode, setMode] = useState<"login" | "register">(
    () => window.location.pathname === "/sign-up" || window.location.pathname === "/signup" || new URLSearchParams(window.location.search).has("signup") ? "register" : "login"
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [error, setError] = useState("");
  const nativeApp = Capacitor.isNativePlatform() || window.location.protocol === "file:";
  const [permissionsReady, setPermissionsReady] = useState(() => localStorage.getItem("nexus-device-permissions-v1") === "granted");
  const [permissionsBusy, setPermissionsBusy] = useState(false);
  const { login, isLoggingIn, user } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (user) setLocation(window.location.pathname.startsWith("/dihtro/claim/") ? window.location.pathname : (nativeApp ? "/chat" : "/main-page"));
  }, [user, setLocation]);

  if (user) return null;

  const allowDevicePermissions = async () => {
    setPermissionsBusy(true); setError("");
    try {
      // Capacitor's PushNotifications plugin exists only in iOS/Android builds.
      // Websites and desktop shells must use the browser Notifications API instead.
      if (Capacitor.isNativePlatform()) {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        let push = await PushNotifications.checkPermissions();
        if (push.receive !== "granted") push = await PushNotifications.requestPermissions();
        if (push.receive !== "granted") throw new Error("Allow notifications in your device settings to continue.");
        await PushNotifications.register();
      } else {
        await enableBrowserNotifications();
      }
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser does not support microphone and camera access. Open NEXUS over HTTPS in a supported browser.");
      const media = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      media.getTracks().forEach(track => track.stop());
      localStorage.setItem("nexus-device-permissions-v1", "granted");
      setPermissionsReady(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Allow notifications, microphone and camera access to continue.");
    } finally { setPermissionsBusy(false); }
  };

  const signInWithPasskey = async () => {
    if !permissionsReady { setError("Allow notifications and call permissions before signing in."); return; }
    const cleanUsername = username.trim();
    if (!cleanUsername) { setError("Enter your NEXUS username before using your passkey."); return; }
    setPasskeyBusy(true); setError("");
    try {
      const optionsResponse = await fetch(apiUrl("/api/auth/passkeys/login/options"), {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: cleanUsername }),
      });
      const options = await optionsResponse.json().catch(() => ({}));
      if (!optionsResponse.ok) throw new Error(options.message || "Could not start passkey sign-in.");
      const response = await startAuthentication({ optionsJSON: options });
      const verifyResponse = await fetch(apiUrl("/api/auth/passkeys/login/verify"), {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      const verified = await verifyResponse.json().catch(() => ({}));
      if (!verifyResponse.ok || !verified.success) throw new Error(verified.message || "Passkey sign-in failed.");
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setLocation(nativeApp ? "/chat" : "/main-page");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Passkey sign-in failed.";
      setError(message.includes("no passkeys saved") ? message + " Your password sign-in is still available above." : message);
    } finally { setPasskeyBusy(false); }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (nativeApp && !permissionsReady) { setError("Allow notifications and call permissions before signing in."); return; }
    const cleanUsername = username.trim();
    if (mode === "login") {
      login({ username: cleanUsername, serialKey: password });
      return;
    }
    setRegistering(true);
    try {
      const response = await fetch(apiUrl("/api/auth/register"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: cleanUsername, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not create your account.");
      login({ username: cleanUsername, serialKey: password });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create your account.");
    } finally {
      setRegistering(false);
    }
  };

  return (
    <main className="nexus-auth-screen min-h-screen flex items-center justify-center p-4"
      style={{ background: "linear-gradient(135deg, hsl(228 7% 13%) 0%, hsl(261 30% 12%) 50%, hsl(228 7% 13%) 100%)" }}>
      <section className="nexus-auth-card w-full max-w-md">
        <header className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/20 border border-primary/30 mb-4">
            {mode === "login" ? <Lock className="w-7 h-7 text-primary" /> : <UserRoundPlus className="w-7 h-7 text-primary" />}
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{mode === "login" ? "Welcome back" : "Create your account"}</h1>
          <p className="text-muted-foreground text-sm mt-1">{mode === "login" ? "Sign in to continue to NEXUS" : "Join NEXUS with a username and password"}</p>
        </header>

        {!permissionsReady && <div className="mb-5 rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/10 p-4"><p className="text-sm font-semibold text-foreground">Before you sign in</p><p className="mt-1 text-xs text-muted-foreground">Allow notifications, microphone and camera access so NEXUS calls and alerts can work on this device.</p><button type="button" onClick={() => void allowDevicePermissions()} disabled={permissionsBusy} className="mt-3 w-full rounded-lg bg-fuchsia-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{permissionsBusy ? "Requesting permissions…" : "ALLOW NOTIFICATIONS & CALLS"}</button></div>}
        {permissionsReady && <p className="mb-4 flex items-center gap-2 text-xs text-emerald-300"><span>✓</span> Device permissions enabled</p>}
        <div className="flex bg-secondary/60 rounded-lg p-1 mb-6">
          <button type="button" onClick={() => { setMode("login"); setError(""); setLocation("/sign-in"); }} className={`flex-1 py-2 rounded-md text-sm font-medium ${mode === "login" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}>Sign In</button>
          <button type="button" onClick={() => { setMode("register"); setError(""); setLocation("/sign-up"); }} className={`flex-1 py-2 rounded-md text-sm font-medium ${mode === "register" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}>Create Account</button>
        </div>

        <div className="bg-secondary/40 border border-border rounded-xl p-6 shadow-2xl">
          <form onSubmit={submit} className="space-y-4">
            <CyberInput label="Username" placeholder="Your username" value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" maxLength={24} required />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Password</label>
              <div className="relative">
                <input type={showPassword ? "text" : "password"} placeholder="Your password" value={password} onChange={event => setPassword(event.target.value)} required minLength={8} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} className="w-full bg-input border border-border rounded px-3 py-2 pr-11 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-primary/60" />
                <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">{showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
              </div>
              {mode === "register" && <p className="text-xs text-muted-foreground">Use 3–24 characters for your username and at least 8 for your password.</p>}
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <CyberButton type="submit" className="w-full mt-2" isLoading={isLoggingIn || registering} disabled={!username.trim() || password.length < 8 || isLoggingIn || registering || (nativeApp && !permissionsReady)}>
              {mode === "login" ? <><Lock className="w-4 h-4" /> Sign In</> : <><UserRoundPlus className="w-4 h-4" /> Create Account</>}
            </CyberButton>
          </form>
          {mode === "login" && <button type="button" disabled={passkeyBusy || !username.trim() || (nativeApp && !permissionsReady)} onClick={() => void signInWithPasskey()} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-violet-300/20 bg-violet-500/10 px-4 py-3 text-sm font-semibold text-violet-100 transition hover:bg-violet-500/20 disabled:opacity-40">{passkeyBusy ? "Waiting for passkey…" : "Sign in with a passkey"}</button>}
        </div>
      </section>
    </main>
  );
}
