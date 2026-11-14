import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { CyberInput } from "@/components/CyberInput";
import { CyberButton } from "@/components/CyberButton";
import { Lock, UserRoundPlus, Eye, EyeOff } from "lucide-react";
import { useLocation } from "wouter";

export default function Login() {
  const [mode, setMode] = useState<"login" | "register">(
    () => window.location.pathname === "/signup" || new URLSearchParams(window.location.search).has("signup") ? "register" : "login"
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState("");
  const { login, isLoggingIn, user } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (user) setLocation("/proxy");
  }, [user, setLocation]);

  if (user) return null;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const cleanUsername = username.trim();
    if (mode === "login") {
      login({ username: cleanUsername, serialKey: password });
      return;
    }
    setRegistering(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        credentials: "same-origin",
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

        <div className="flex bg-secondary/60 rounded-lg p-1 mb-6">
          <button type="button" onClick={() => { setMode("login"); setError(""); }} className={`flex-1 py-2 rounded-md text-sm font-medium ${mode === "login" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}>Sign In</button>
          <button type="button" onClick={() => { setMode("register"); setError(""); }} className={`flex-1 py-2 rounded-md text-sm font-medium ${mode === "register" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}>Create Account</button>
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
            <CyberButton type="submit" className="w-full mt-2" isLoading={isLoggingIn || registering} disabled={!username.trim() || password.length < 8 || isLoggingIn || registering}>
              {mode === "login" ? <><Lock className="w-4 h-4" /> Sign In</> : <><UserRoundPlus className="w-4 h-4" /> Create Account</>}
            </CyberButton>
          </form>
        </div>
      </section>
    </main>
  );
}
