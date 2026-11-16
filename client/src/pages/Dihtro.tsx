import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import { Crown, Gift, Sparkles, Clock, CheckCircle2, ShoppingCart } from "lucide-react";

const plans = [
  { id: "bronze", name: "Planet Bronze", price: 250, summary: "10 profile-gradient features", features: ["10 Bronze features"] },
  { id: "silver", name: "Solar System Silver", price: 750, summary: "30 features total — includes all 10 Bronze features", features: ["Everything in Planet Bronze", "20 additional Silver features"] },
  { id: "gold", name: "Galaxy Gold", price: 1800, summary: "50 features total — includes Bronze and Silver", features: ["Everything in Solar System Silver", "20 additional Gold features"] },
  { id: "diamond", name: "Universe Diamond", price: 4000, summary: "150+ features — all Gold benefits plus 100 exclusive features", features: ["Everything in Galaxy Gold", "100 exclusive Universe features"] },
];
const bronzeFeatures = ["Animated profile gradient backgrounds","Custom three-colour profile gradients","Gradient profile borders","Custom gradient colour picker","Profile text colour","Profile outline colour","Animated gradient toggle","Portrait gradient layout","Landscape gradient layout","Saved gradient preset"];
const silverExclusiveFeatures = ["Animated profile emotes","Audio-enabled profile emotes","Profile appearance presets","Advanced profile preview","Custom profile accent presets","Profile layout presets","Profile section ordering","Profile card colour themes","Profile card border styles","Profile bio formatting","Pronoun display styling","Profile presence styling","Extended profile personalisation","GS gift links","Adjustable gift duration","Gift redemption status tracking","Monthly Block Blast champion reward","One-time gift claim protection","Saved profile appearance presets","Premium profile theme library"];
const silverFeatures = [...bronzeFeatures, ...silverExclusiveFeatures];
const goldFeatures = ["Uploaded username fonts","Custom multi-stop username gradients","Animated username gradient presets","Advanced profile banner effects","Banner overlay styling","Banner animation presets","Profile gallery layouts","Expanded profile gallery","Animated gallery transitions","Gallery caption styling","Profile widget library","Custom profile widgets","Widget colour controls","Widget layout presets","Widget visibility controls","Profile module ordering","Custom avatar frames","Exclusive avatar frame library","Avatar outline effects","Avatar lighting presets"];
const diamondFeatures = ["Universe-only animated profile constellations","Personal star-map profile header","Nebula profile background presets","Interactive galaxy banner effects","Orbiting avatar decorations","Animated orbital nameplates","Exclusive cosmic username typography","Multi-layer gradient animations","Reactive profile lighting","Custom profile particle systems","Profile constellation editor","Custom zodiac-style emblems","Animated comet trails","Galaxy glass profile panels","Aurora border animations","Custom profile soundscapes","Profile entrance animations","Profile hover motion presets","Advanced profile layout templates","Multi-banner profile carousel","Custom profile section ordering","Expandable profile widgets","Profile visitor analytics","Profile engagement insights","Profile view history","Profile theme scheduler","Time-based profile themes","Seasonal cosmic themes","Custom profile accent palettes","Per-section profile colours","Animated status aura","Exclusive presence animations","Custom online status messages","Status history archive","Profile spotlight mode","Featured profile showcase","Profile pinboard","Custom profile badges","Animated badge frames","Badge collection display","Exclusive chat message gradients","Cosmic chat nameplates","Animated chat signature","Custom message accent effects","Exclusive reaction animations","Custom reaction sets","Expanded reaction palette","Animated reaction trails","Chat profile quick cards","Custom chat backdrop themes","Advanced chat layout presets","Custom chat bubble shapes","Message highlight themes","Personal chat sound themes","Custom typing indicators","Animated typing effects","Expanded status indicators","Custom presence icons","Priority profile rendering","High-detail avatar effects","Custom avatar lighting","Animated avatar outlines","Avatar particle overlays","Avatar frame creator","Exclusive avatar frame library","Custom banner overlays","Layered banner editor","Banner animation presets","Banner parallax effects","Interactive banner hotspots","Private profile showcase slots","Expanded profile gallery","Custom gallery layouts","Animated gallery transitions","Gallery caption styling","Exclusive profile widgets","Custom widget colours","Widget layout presets","Widget visibility controls","Profile module library","Custom achievement showcase","Expanded achievement slots","Exclusive achievement frames","Animated achievement reveals","Personal milestone timeline","Profile progress visualiser","Custom progress indicators","Expanded saved themes","Theme import and export","Theme version history","Universe creator badge effects","Exclusive seasonal cosmetics","Early access to new cosmetics","Expanded cosmetic inventory","Custom cosmetic combinations","Profile effect presets","Advanced visual effect controls","Priority feature previews","Exclusive Universe community rooms","Diamond supporter showcase"];

export default function GS({ code }: { code?: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: plan, isLoading } = useQuery<any>({ queryKey: ["/api/gs/me"] });
  const { data: gift, refetch: refetchGift } = useQuery<any>({
    queryKey: ["/api/gs/gifts", code],
    queryFn: async () => { const r = await fetch("/api/gs/gifts/" + encodeURIComponent(code || "")); const d = await r.json(); if (!r.ok) throw new Error(d.message || "Gift not found."); return d; },
    enabled: Boolean(code), retry: false,
  });
  const [claiming, setClaiming] = useState(false);
  const [busyTier, setBusyTier] = useState("");
  const claim = async () => {
    if (!code || gift?.claimed || claiming) return;
    setClaiming(true);
    try {
      const r = await fetch("/api/gs/gifts/" + encodeURIComponent(code) + "/claim", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || "Could not claim this gift.");
      toast({ title: "SUBSCRIPTION CLAIMED 🎁", description: `You received ${d.months} month(s)!` });
      await qc.invalidateQueries({ queryKey: ["/api/gs/me"] });
      await qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
      await refetchGift();
    } catch (e: any) { toast({ title: "GIFT NOT CLAIMED", description: e.message, variant: "destructive" }); }
    finally { setClaiming(false); }
  };
  const purchase = async (tier: string) => {
    setBusyTier(tier);
    try {
      const r = await fetch("/api/gs/purchase", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tier }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.message || "Purchase failed.");
      toast({ title: "SUBSCRIPTION ACTIVATED", description: `${tier.toUpperCase()} activated for one month. ${data.coins} Galactic Coins remain.` });
      await qc.invalidateQueries({ queryKey: ["/api/gs/me"] });
      await qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
    } catch (e: any) { toast({ title: "PURCHASE FAILED", description: e.message, variant: "destructive" }); }
    finally { setBusyTier(""); }
  };
  const until = plan?.until ? new Date(plan.until) : null;
  const days = until && until.getTime() > Date.now() ? Math.ceil((until.getTime() - Date.now()) / 86400000) : 0;
  const currentTier = plan?.tier || "none";

  return <Layout><div className="nexus-page mx-auto max-w-6xl space-y-6">
    <header className="rounded-3xl border border-fuchsia-400/25 bg-gradient-to-br from-fuchsia-500/15 via-violet-500/10 to-cyan-500/10 p-6 md:p-8">
      <div className="flex items-center gap-3"><span className="rounded-2xl bg-fuchsia-400/15 p-3 text-fuchsia-200"><Crown size={27}/></span><div><p className="text-xs font-bold tracking-[.3em] text-fuchsia-200">GS MEMBERSHIP</p><h1 className="text-3xl font-black text-white">GS — GALAXY SUBSCRIPTION</h1></div></div>
      <p className="mt-3 max-w-2xl text-sm text-white/65">GS stands for Galaxy Subscription. Four subscription levels. Choose your place in the NEXUS universe.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-xs text-white/45">CURRENT PLAN</p><p className="mt-1 text-lg font-bold text-white">{isLoading ? "Checking…" : (plan?.isSuperOwner ? "Universe Diamond · Super Owner" : plans.find(p => p.id === currentTier)?.name || (plan?.isStaff ? "Universe Diamond (Staff)" : "No subscription"))}</p></div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-xs text-white/45">TIME REMAINING</p><p className="mt-1 text-lg font-bold text-white">{plan?.isStaff ? "Staff access" : days ? `${days} days` : "—"}</p></div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-xs text-white/45">EXPIRES</p><p className="mt-1 text-lg font-bold text-white">{until ? until.toLocaleDateString() : plan?.isStaff ? "Never" : "No active plan"}</p></div>
      </div>
    </header>
    {code && <section className="rounded-2xl border border-fuchsia-300/25 bg-fuchsia-500/10 p-5">
      <div className="flex items-center gap-2 text-fuchsia-100"><Gift size={20}/><h2 className="font-bold">YOU GOT GIFTED A SUBSCRIPTION 🎁</h2></div>
      {gift?.claimed ? <p className="mt-3 text-sm text-rose-200">This gift has already been redeemed.</p>
       : gift ? <><p className="mt-2 text-sm text-white/70">You have a gift for {gift.months} month(s)!</p><button onClick={() => void claim()} disabled={claiming} className="mt-4 rounded-xl bg-fuchsia-500 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{claiming ? "Claiming…" : "CLAIM YOUR GIFT"}</button></>
       : <p className="mt-2 text-sm text-white/60">Checking gift link…</p>}
    </section>}
    <section className="grid gap-4 md:grid-cols-2">
      {plans.map((item,index)=><article key={item.id} className="rounded-2xl border border-white/10 bg-card/60 p-5">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-fuchsia-300">TIER 0{index+1}</p><h2 className="mt-1 text-xl font-black text-white">{item.name}</h2><p className="mt-1 text-sm text-white/60">{item.summary}</p></div><Crown className="text-fuchsia-300"/></div>
        <p className="mt-4 text-2xl font-black text-white">{item.price.toLocaleString()} <span className="text-xs font-semibold text-white/50">Galactic Coins / month</span></p>
        <ul className="mt-3 space-y-2">{item.features.map(feature=><li key={feature} className="flex gap-2 text-sm text-foreground/80"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-fuchsia-300"/>{feature}</li>)}</ul>
        <button onClick={()=>void purchase(item.id)} disabled={Boolean(busyTier)||plan?.isStaff} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-fuchsia-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"><ShoppingCart size={16}/>{busyTier===item.id?"Processing…":currentTier===item.id?"Extend this plan":"Buy for one month"}</button>
      </article>)}
    </section>
    <section className="rounded-2xl border border-white/10 bg-card/50 p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold"><Sparkles className="text-fuchsia-300"/> Planet Bronze — 10 features</h2>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{bronzeFeatures.map((feature,i)=><div key={feature} className="flex items-center gap-2 rounded-xl border border-white/5 bg-black/10 px-3 py-3 text-sm text-foreground/85"><CheckCircle2 size={15} className="shrink-0 text-fuchsia-300"/><span>{i+1}. {feature}</span></div>)}</div>
    </section>
    <section className="rounded-2xl border border-white/10 bg-card/50 p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold"><Sparkles className="text-fuchsia-300"/> Solar System Silver — 30 features total</h2>
      <p className="mt-1 text-sm text-white/55">Includes all 10 Bronze features, plus these 20 Silver unlocks.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{silverFeatures.slice(10).map((feature,i)=><div key={feature} className="flex items-center gap-2 rounded-xl border border-white/5 bg-black/10 px-3 py-3 text-sm text-foreground/85"><CheckCircle2 size={15} className="shrink-0 text-fuchsia-300"/><span>{i+11}. {feature}</span></div>)}</div>
    </section>
    <section className="rounded-2xl border border-amber-300/20 bg-amber-500/5 p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold"><Crown className="text-amber-300"/> Galaxy Gold — 50 features total</h2>
      <p className="mt-1 text-sm text-white/55">Includes all 30 Bronze and Silver features, plus these 20 Gold unlocks.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{goldFeatures.slice(0,20).map((feature,i)=><div key={feature} className="flex items-center gap-2 rounded-xl border border-white/5 bg-black/10 px-3 py-3 text-sm text-foreground/85"><CheckCircle2 size={15} className="shrink-0 text-amber-300"/><span>{i+31}. {feature}</span></div>)}</div>
    </section>
    <section className="rounded-2xl border border-fuchsia-300/20 bg-fuchsia-500/5 p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold"><Crown className="text-fuchsia-300"/> Universe Diamond — 100 exclusive features</h2>
      <p className="mt-1 text-sm text-white/55">All Galaxy Gold features, plus these Universe-only unlocks.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{diamondFeatures.map((feature,i)=><div key={feature} className="rounded-lg border border-white/5 bg-black/10 px-3 py-2 text-xs text-foreground/80">{i+1}. {feature}</div>)}</div>
    </section>
    <section className="flex items-center gap-3 rounded-2xl border border-white/10 bg-card/50 p-5 text-sm text-muted-foreground"><Clock size={18}/> Subscriptions last one month per purchase. Renewals extend the expiry date. Block Blast monthly champions receive one month of Solar System Silver.</section>
  </div></Layout>;
}
