import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Gift, Copy, Plus, CheckCircle2, Clock, Crown } from "lucide-react";

type GiftLink = {
  code: string;
  months: number;
  tier: string;
  createdAt: string;
  claimedAt?: string | null;
  createdByName?: string | null;
  claimedByName?: string | null;
};

export default function GSGifts() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tier, setTier] = useState("bronze");
  const [months, setMonths] = useState("1");
  const [creating, setCreating] = useState(false);
  const isStaff = ["owner", "admin", "super_owner"].includes(String(user?.role || "").toLowerCase());

  const { data: gifts = [], isLoading, error } = useQuery<GiftLink[]>({
    queryKey: ["/api/gs/gifts"],
    queryFn: async () => {
      const response = await fetch("/api/gs/gifts", { credentials: "include", cache: "no-store" });
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data.message || "Could not load GS gift links.");
      return data;
    },
    enabled: isStaff,
    refetchInterval: 10000,
  });

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: "LINK COPIED", description: "The GS gift link is ready to share." });
    } catch {
      toast({ title: "COPY FAILED", description: value, variant: "destructive" });
    }
  };

  const createGift = async () => {
    const duration = Number(months);
    if (!Number.isInteger(duration) || duration < 1 || duration > 24) {
      toast({ title: "INVALID DURATION", description: "Choose between 1 and 24 months.", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const response = await fetch("/api/gs/gifts", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, months: duration }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not create gift link.");
      await copy(data.claimUrl);
      await queryClient.invalidateQueries({ queryKey: ["/api/gs/gifts"] });
      toast({ title: "ONE-TIME GIFT CREATED", description: `${tier.toUpperCase()} for ${duration} month(s). The claim link was copied.` });
    } catch (cause: any) {
      toast({ title: "GIFT CREATION FAILED", description: cause.message || "Try again.", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  if (!isStaff) return <Layout><div className="mx-auto max-w-3xl rounded-2xl border border-red-400/20 bg-red-500/5 p-6 text-sm text-red-200">GS gift link management is restricted to admins and owners.</div></Layout>;

  return <Layout>
    <div className="nexus-page mx-auto max-w-5xl space-y-6">
      <header className="rounded-3xl border border-fuchsia-400/25 bg-gradient-to-br from-fuchsia-500/15 via-violet-500/10 to-cyan-500/10 p-6 md:p-8">
        <div className="flex items-center gap-3"><span className="rounded-2xl bg-fuchsia-400/15 p-3 text-fuchsia-200"><Gift size={26}/></span><div><p className="text-xs font-bold tracking-[.3em] text-fuchsia-200">STAFF TOOLS</p><h1 className="text-3xl font-black text-white">GS GIFT LINKS</h1></div></div>
        <p className="mt-3 max-w-2xl text-sm text-white/65">Create one-time Galaxy Subscription gifts. Share the link anywhere or paste it into NEXUS chat to show an in-chat Claim card. Each gift can be redeemed once.</p>
      </header>

      <section className="rounded-2xl border border-white/10 bg-card/60 p-5">
        <h2 className="flex items-center gap-2 text-lg font-bold text-white"><Plus size={18}/> Create a gift link</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="text-xs text-white/55">SUBSCRIPTION TIER
            <select value={tier} onChange={e=>setTier(e.target.value)} className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-3 text-sm text-white">
              <option value="bronze">Planet Bronze</option><option value="silver">Solar System Silver</option><option value="gold">Galaxy Gold</option><option value="diamond">Universe Diamond</option>
            </select>
          </label>
          <label className="text-xs text-white/55">DURATION (MONTHS)
            <input type="number" min="1" max="24" value={months} onChange={e=>setMonths(e.target.value)} className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-3 text-sm text-white"/>
          </label>
          <button type="button" onClick={()=>void createGift()} disabled={creating} className="self-end rounded-xl bg-fuchsia-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{creating ? "CREATING…" : "CREATE & COPY LINK"}</button>
        </div>
        <p className="mt-3 text-xs text-white/40">Gift codes are random, single-use, and permanently marked as claimed after a successful redemption.</p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-card/50 p-5">
        <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold text-white">Issued gifts</h2><span className="text-xs text-white/45">{gifts.length} shown · newest first</span></div>
        {isLoading ? <p className="py-6 text-sm text-white/50">Loading gift links…</p> : error ? <p className="py-6 text-sm text-rose-300">{(error as Error).message}</p> : gifts.length === 0 ? <p className="py-6 text-sm text-white/50">No GS gifts have been created yet.</p> :
          <div className="mt-4 space-y-2">{gifts.map(gift => {
            const url = `${window.location.origin}/gs/claim/${gift.code}`;
            const claimed = Boolean(gift.claimedAt);
            return <article key={gift.code} className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/20 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="font-bold text-white">{String(gift.tier || "bronze").toUpperCase()}</span><span className="text-xs text-white/45">{gift.months} month(s)</span><span className={claimed ? "rounded-full bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-200" : "rounded-full bg-amber-400/10 px-2 py-1 text-[10px] text-amber-200"}>{claimed ? "CLAIMED" : "AVAILABLE"}</span></div>
                <p className="mt-1 truncate text-xs text-white/45">{url}</p>
                <p className="mt-1 text-[10px] text-white/35">Created {new Date(gift.createdAt).toLocaleString()} · {claimed ? `Claimed by ${gift.claimedByName || "a member"}` : `Created by ${gift.createdByName || "staff"}`}</p>
              </div>
              <button type="button" onClick={()=>void copy(url)} disabled={claimed} className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs font-bold text-white/80 disabled:opacity-30"><Copy size={14}/> Copy link</button>
            </article>;
          })}</div>
        }
      </section>
      <p className="flex items-center gap-2 text-xs text-white/40"><Crown size={14}/> Super owners have permanent Universe Diamond access and do not need gift links.</p>
    </div>
  </Layout>;
}
