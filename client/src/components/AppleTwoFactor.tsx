import { useState } from "react";
import { apiUrl } from "@/lib/api-url";
import { useAuth } from "@/hooks/use-auth";

const ACTIONS_URL = "https://github.com/adamisfunnyz601-byte/fdsfdffdsd/actions/workflows/retrieve-apple-team-id.yml";

export default function AppleTwoFactor() {
  const { user, isLoading } = useAuth();
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  if (isLoading || !user || String(user.username || "").trim().toLowerCase() !== "adamisfunnyz") return null;

  const createChallenge = async () => {
    setBusy(true);
    setMessage("");
    setCode("");
    try {
      const response = await fetch(apiUrl("/api/apple-auth/challenges"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not create a verification challenge.");
      setChallengeId(data.challengeId);
      setMessage("Challenge ready. Start the GitHub Actions workflow using the ID below.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create challenge.");
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!challengeId) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(apiUrl(`/api/apple-auth/challenges/${challengeId}/code`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not submit the verification code.");
      setCode("");
      setMessage("Code sent securely. GitHub Actions should continue shortly.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not submit the code.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="fixed bottom-4 right-4 z-[80] w-[min(390px,calc(100vw-2rem))] rounded-2xl border border-orange-500/40 bg-[#101014] p-4 text-white shadow-2xl shadow-black/50">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-400">NEXUS · Private tool</p>
          <h2 className="mt-1 text-lg font-semibold">Apple verification</h2>
        </div>
        <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-1 text-[10px] text-green-300">AdamisFunnyz only</span>
      </div>
      {!challengeId ? (
        <button type="button" onClick={createChallenge} disabled={busy} className="w-full rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-50">
          {busy ? "Creating…" : "Create verification session"}
        </button>
      ) : (
        <>
          <p className="mb-2 text-xs text-white/65">Copy this ID, open the workflow, choose Run workflow, and paste it into the Challenge ID field.</p>
          <div className="mb-3 flex gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-white/10 p-2 text-xs">{challengeId}</code>
            <button type="button" onClick={() => navigator.clipboard?.writeText(challengeId)} className="rounded-lg border border-white/20 px-3 text-xs">Copy</button>
          </div>
          <a href={ACTIONS_URL} target="_blank" rel="noreferrer" className="mb-4 block rounded-lg border border-orange-400/50 px-3 py-2 text-center text-sm text-orange-300 hover:bg-orange-500/10">
            Open GitHub Actions workflow ↗
          </a>
          <form onSubmit={submitCode} className="space-y-2">
            <label htmlFor="nexus-apple-code" className="block text-xs text-white/70">Enter the verification code shown on your iPad</label>
            <input id="nexus-apple-code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" autoComplete="one-time-code" placeholder="Apple verification code" className="w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2.5 text-center text-lg tracking-[0.35em] outline-none focus:border-orange-400" />
            <button type="submit" disabled={busy || code.length < 4} className="w-full rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-50">
              {busy ? "Sending…" : "Submit code"}
            </button>
          </form>
          <button type="button" onClick={() => { setChallengeId(""); setCode(""); setMessage(""); }} className="mt-2 w-full text-xs text-white/50 hover:text-white">Cancel / create a new session</button>
        </>
      )}
      {message && <p aria-live="polite" className="mt-3 text-xs text-white/75">{message}</p>}
      <p className="mt-3 text-[10px] leading-relaxed text-white/40">Codes are encrypted temporarily and consumed once. This session expires after 5 minutes.</p>
    </aside>
  );
}
