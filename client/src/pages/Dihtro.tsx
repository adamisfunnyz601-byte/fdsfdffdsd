import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import { Crown, Gift, Sparkles, Clock, CheckCircle2, Lock } from "lucide-react";

const perks = [
  "Animated profile gradient backgrounds", "Custom three-colour profile gradients",
  "Gradient profile borders", "Landscape and portrait profile layouts",
  "Animated gradient usernames", "Comic Sans username font",
  "Custom uploaded username fonts", "Custom username font gradients",
  "Premium profile banner styling", "Profile decoration slots",
  "Animated profile emotes", "Audio-enabled profile emotes",
  "Custom profile tags", "Exclusive tag symbols and colours",
  "Premium profile appearance presets", "Advanced profile preview",
  "Custom profile colour controls", "Premium name styling",
  "Extended profile personalisation", "Dihtro gift links",
  "Adjustable gift duration (1–24 months)", "Gift redemption status tracking",
  "Monthly Block Blast champion reward", "One-time claim protection",
];

export default function Dihtro({ code }: { code?: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: plan, isLoading } = useQuery<any>({ queryKey: ["/api/dihtro/me"] });
  const { data: gift, refetch: refetchGift } = useQuery<any>({
    queryKey: ["/api/dihtro/gifts", code],
    queryFn: async () => { const r = await fetch("/api/dihtro/gifts/" + encodeURIComponent(code || "")); const d = await r.json(); if (!r.ok) throw new Error(d.message || "Gift not found."); return d; },
    enabled: Boolean(code),
    retry: false,
  });
  const [claiming, setClaiming] = useState(false);
  const claim = async () => {
    if (!code || gift?.claimed || claiming) return;
    setClaiming(true);
    try {
      const r = await fetch("/api/dihtro/gifts/" + encodeURIComponent(code) + "/claim", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || "Could not claim this gift.");
      toast({ title: "DIHTRO CLAIMED 🎁", description: `You got gifted Dihtro for ${d.months} month${d.months === 1 ? "" : "s"}!` });
      await qc.invalidateQueries({ queryKey: ["/api/dihtro/me"] });
      await qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
      await refetchGift();
    } catch (e: any) { toast({ title: "GIFT NOT CLAIMED", description: e.message, variant: "destructive" }); }
    finally { setClaiming(false); }
  };
  const until = plan?.until ? new Date(plan.until) : null;
  const days = until && until.getTime() > Date.now() ? Math.ceil((until.getTime() - Date.now()) / 86400000) : 0;

  return <Layout><div className="nexus-page mx-auto max-w-5xl space-y-6">
    <header className="rounded-3xl border border-fuchsia-400/25 bg-gradient-to-br from-fuchsia-500/15 via-violet-500/10 to-cyan-500/10 p-6 md:p-8">
      <div className="flex items-center gap-3"><span className="rounded-2xl bg-fuchsia-400/15 p-3 text-fuchsia-200"><Crown size={27}/></span><div><p className="text-xs font-bold tracking-[.3em] text-fuchsia-200">NEXUS PREMIUM</p><h1 className="text-3xl font-black text-white">DIHTRO</h1></div></div>
      <p className="mt-3 max-w-2xl text-sm text-white/65">Your profile, identity and NEXUS experience — upgraded.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-xs text-white/45">STATUS</p><p className="mt-1 text-lg font-bold text-white">{isLoading ? "Checking…" : plan?.active ? "Active" : "Not active"}</p></div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-xs text-white/45">TIME REMAINING</p><p className="mt-1 text-lg font-bold text-white">{plan?.isStaff ? "Staff access" : days ? `${days} days` : "—"}</p></div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-xs text-white/45">EXPIRES</p><p className="mt-1 text-lg font-bold text-white">{until ? until.toLocaleDateString() : plan?.isStaff ? "Never" : "No active plan"}</p></div>
      </div>
    </header>
    {code && <section className="rounded-2xl border border-fuchsia-300/25 bg-fuchsia-500/10 p-5">
      <div className="flex items-center gap-2 text-fuchsia-100"><Gift size={20}/><h2 className="font-bold">YOU GOT GIFTED DIHTRO 🎁</h2></div>
      {gift?.claimed ? <p className="mt-3 text-sm text-rose-200">This gift has already been redeemed. It cannot be claimed again.</p>
       : gift ? <><p className="mt-2 text-sm text-white/70">You got gifted Dihtro for {gift.months} month{gift.months === 1 ? "" : "s"}!</p><button onClick={() => void claim()} disabled={claiming} className="mt-4 rounded-xl bg-fuchsia-500 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{claiming ? "Claiming…" : "CLAIM YOUR GIFT"}</button></>
       : <p className="mt-2 text-sm text-white/60">Checking gift link…</p>}
    </section>}
    <section className="rounded-2xl border border-white/10 bg-card/60 p-5">
      <div className="mb-4 flex items-center gap-2"><Sparkles className="text-fuchsia-300"/><h2 className="text-lg font-bold">24 Dihtro features</h2></div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{perks.map((perk,i)=><div key={perk} className="flex items-center gap-2 rounded-xl border border-white/5 bg-black/10 px-3 py-3 text-sm text-foreground/85"><CheckCircle2 size={15} className="shrink-0 text-fuchsia-300"/><span>{perk}</span></div>)}</div>
    </section>
    <section className="flex items-center gap-3 rounded-2xl border border-white/10 bg-card/50 p-5 text-sm text-muted-foreground"><Clock size={18}/> Your Dihtro time is tracked against your account and automatically expires at the date shown above. Staff can create single-use gift links with a duration from 1 to 24 months.</section>
  </div></Layout>;
}
