import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Globe, MessageSquare, History, ShieldAlert, LogOut, Menu, X, Settings, Blocks, UserRound, ShoppingBag, ScrollText, Sparkles, Command, Youtube, ShieldCheck } from "@/components/ManagedIcons";
import { useEffect, useState } from "react";
import { Gift } from "@/components/ManagedIcons";
import { applyNexusAppearance, readNexusAppearance } from "@/lib/appearance";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Avatar } from "./ProfileModal";
import { UserProfileTag } from "./UserProfileTag";
import { AppIcon } from "./AppIcon";

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navItems = [
    { href: "/proxy", label: "Net Proxy", icon: Globe, iconName: "net-proxy", section: "Workspace" },
    { href: "/chat", label: "Messages", icon: MessageSquare, iconName: "messages", section: "Workspace", accent: "violet" },
    { href: "/history", label: "History", icon: History, iconName: "history", section: "Workspace" },
    { href: "/updates", label: "Update Logs", icon: ScrollText, iconName: "updates", section: "Workspace" },
    { href: "/youtube-tools", label: "YouTube Tools", icon: Youtube, iconName: "youtube-tools", section: "Workspace", accent: "red" },
    { href: "/block-blast", label: "Block Blast", icon: Blocks, iconName: "block-blast", section: "Playground", accent: "amber" },
    { href: "/shop", label: "Shop", icon: ShoppingBag, iconName: "shop", section: "Playground", accent: "pink" },
    { href: "/gs", label: "GS · Galaxy Subscription", icon: Gift, iconName: "galaxy-subscription", section: "Account", accent: "pink" },
    { href: "/settings", label: "Settings", icon: Settings, iconName: "settings", section: "Account" },
  ];
  const role = String(user?.role || "").toLowerCase().replace(/_/g, "-");
  if (["owner","admin","trial-admin","moderator","trial-moderator","helper","trial-helper"].includes(role))
    navItems.push({ href: "/moderation", label: "Moderation", icon: ShieldAlert, iconName: "moderation", section: "Staff" });
  if (["owner","admin","trial-admin"].includes(role))
    navItems.push({ href: "/admin", label: "Admin Console", icon: Command, iconName: "admin-console", section: "Staff" });
  if (["owner", "admin", "super-owner"].includes(role)) navItems.push({ href: "/gs/gifts", label: "GS Gift Links", icon: Gift, iconName: "gs-gifts", section: "Account", accent: "pink" });
  const sections = Array.from(new Set(navItems.map(item => item.section)));
  const closeMenu = () => setIsMobileMenuOpen(false);
  const canGiftGS = ["owner", "admin", "super-owner"].includes(role);
  const giftGS = async () => {
    const raw = window.prompt("How many months should this subscription gift contain? (1–24)", "1");
    if (raw === null) return;
    const months = Number(raw);
    if (!Number.isInteger(months) || months < 1 || months > 24) { window.alert("Choose a duration from 1 to 24 months."); return; }
    try {
      const response = await fetch("/api/gs/gifts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ months }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not create gift.");
      await navigator.clipboard?.writeText(data.claimUrl);
      window.alert("CLAIM YOUR FREE GS SUBSCRIPTION 🎁\n\n" + data.claimUrl + "\n\nThe claim link has been copied.");
    } catch (error) { window.alert(error instanceof Error ? error.message : "Could not create gift."); }
  };
  useEffect(() => {
    const apply = () => applyNexusAppearance(readNexusAppearance());
    apply();
    window.addEventListener("nexus-appearance-change", apply);
    return () => window.removeEventListener("nexus-appearance-change", apply);
  }, []);

  return (
    <div className="nexus-shell min-h-screen flex flex-col md:flex-row">
      <header className="nexus-mobilebar flex lg:hidden">
        <button className="nexus-brand-mark" onClick={() => setIsMobileMenuOpen(v => !v)} aria-label="Toggle navigation">
          {isMobileMenuOpen ? <AppIcon name="close" fallback={X} size={19}/> : <AppIcon name="menu" fallback={Menu} size={19}/>}
        </button>
        <div className="flex items-center gap-2"><span className="nexus-brand-orb"><img src="/nexus-icon.png" alt="NEXUS" className="h-5 w-5 object-contain" onError={e=>{e.currentTarget.src="/nexus-icon.svg"}}/></span><span className="font-black tracking-[.18em] text-sm">NEXUS</span></div>
        <span className="nexus-live-pill"><i/> LIVE</span>
      </header>

      <AnimatePresence>
        {isMobileMenuOpen && <motion.button aria-label="Close navigation" className="nexus-mobile-scrim md:hidden" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={closeMenu}/>}
      </AnimatePresence>
      <aside
        className={cn("nexus-sidebar fixed inset-y-0 left-0 z-[60] flex w-[278px] flex-col lg:relative lg:translate-x-0", isMobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0")}
      >
        <div className="nexus-brand">
          <div className="nexus-brand-orb"><img src="/nexus-icon.png" alt="NEXUS" className="h-6 w-6 object-contain" onError={e=>{e.currentTarget.src="/nexus-icon.svg"}}/><span/></div>
          <div className="min-w-0"><div className="nexus-brand-name">NEXUS<span>OS</span></div><div className="nexus-brand-sub">YOUR DIGITAL UNIVERSE</div></div>
          <div className="ml-auto"><span className="nexus-version">2.6</span></div>
        </div>

        <div className="nexus-workspace-card">
          <div className="nexus-workspace-icon"><Sparkles size={16}/></div>
          <div className="min-w-0 flex-1"><div className="text-[11px] font-bold tracking-wide text-white">PERSONAL WORKSPACE</div><div className="mt-0.5 text-[10px] text-white/40">Everything in one place</div></div>
          <span className="nexus-live-dot"/>
        </div>

        <nav className="nexus-nav flex-1 overflow-y-auto px-3 pb-4">
          {sections.map((section, sectionIndex) => (
            <section key={section} className="nexus-nav-section">
              <div className="nexus-section-label"><span>{section}</span><i/></div>
              <div className="space-y-1">
                {navItems.filter(item => item.section === section).map(item => {
                  const active = location === item.href || (item.href !== "/" && location.startsWith(item.href + "/"));
                  const Icon = item.icon;
                  return (
                    <Link key={item.href} href={item.href} onClick={closeMenu}
                      className={cn("nexus-nav-link", active && "is-active", `nav-motion-${(navItems.indexOf(item) % 8) + 1}`)}
                      aria-current={active ? "page" : undefined}>
                      <span className="nexus-nav-icon"><AppIcon name={(item as typeof item & { iconName?: string }).iconName || "default"} fallback={Icon} size={17}/></span>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {active && <motion.span layoutId="nexus-active-indicator" className="nexus-nav-active-indicator"/>}
                      {item.href === "/chat" && <span className="nexus-nav-signal"/>}
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>

        <div className="nexus-sidebar-footer">
          <div className="nexus-user-card">
            <div className="relative"><Avatar url={user?.avatarUrl} name={user?.username || "?"} size={38} font={user?.usernameFont}/><span className="nexus-avatar-status"/></div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1"><span className="truncate text-[12px] font-bold text-white">{user?.username || "Loading…"}</span>{(user as any)?.isSuperOwner && <span title="Super Owner" className="inline-flex items-center gap-1 rounded-full border border-amber-300/40 bg-amber-400/10 px-1.5 py-0.5 text-[8px] font-black tracking-wider text-amber-200"><ShieldCheck size={10}/> SUPER OWNER</span>}<UserProfileTag tagSymbol={user?.tagSymbol} tagText={user?.tagText} tagColor={user?.tagColor} size="compact"/></div>
              <div className="mt-0.5 truncate text-[10px] text-emerald-300/80">{String(user?.role || "user").replace(/-/g," ")} · {user?.presenceStatus || "offline"}</div>
            </div>
            <button className="nexus-icon-button" onClick={() => logout()} title="Sign out" aria-label="Sign out"><AppIcon name="sign-out" fallback={LogOut} size={15}/></button>
          </div>
          <Link href="/profile" onClick={closeMenu} className={cn("nexus-profile-link", location === "/profile" && "is-active")}><AppIcon name="profile" fallback={UserRound} size={15}/> Open my profile <span>↗</span></Link>
          <div className="nexus-footer-meta"><span>● ALL SYSTEMS NOMINAL</span><span>SECURE SESSION</span></div><div className="mt-2 space-y-1 px-1 text-[10px] text-white/35"><div className="flex flex-wrap gap-x-3 gap-y-1"><Link href="/terms" onClick={closeMenu} className="transition hover:text-violet-300">Terms and Conditions</Link><Link href="/documentation" onClick={closeMenu} className="transition hover:text-violet-300">Error documentation</Link></div><div>© 2026 AdamisFunnyz · NEXUS™</div></div>
        </div>
      </aside>

      {canGiftGS && <button type="button" onClick={() => void giftGS()} title="Gift subscription" aria-label="Gift GS" className="fixed bottom-5 right-5 z-[90] flex h-14 w-14 items-center justify-center rounded-full border border-fuchsia-300/40 bg-gradient-to-br from-fuchsia-500 to-violet-600 text-white shadow-[0_8px_32px_rgba(168,85,247,.45)] transition hover:scale-105"><AppIcon name="gift" fallback={Gift} size={23}/></button>}\n      <main className="nexus-main flex min-w-0 flex-1 flex-col">
        <header className="nexus-topbar hidden h-[58px] shrink-0 items-center justify-between px-7 lg:flex">
          <div className="flex items-center gap-3"><span className="nexus-breadcrumb-dot"/><span className="text-[11px] font-semibold uppercase tracking-[.16em] text-white/45">Nexus Network</span><span className="text-white/15">/</span><span className="text-[11px] font-semibold text-white/85">{navItems.find(item => item.href === location)?.label || (location === "/profile" ? "My Profile" : "Workspace")}</span></div>
          <div className="flex items-center gap-4"><span className="nexus-encryption"><span/> AES-256 SESSION</span><span className="h-4 w-px bg-white/10"/><span className="inline-flex items-center gap-2 text-[10px] tracking-widest text-white/30"><img src="/nexus-icon.png" alt="NEXUS" className="h-4 w-4 object-contain"/> NEXUS / 02.06</span></div>
        </header>
        <motion.div key={location} className="nexus-content flex-1 overflow-y-auto p-4 md:p-7" initial={{opacity:0,y:13,filter:"blur(5px)"}} animate={{opacity:1,y:0,filter:"blur(0px)"}} transition={{duration:.24,ease:[.2,.8,.2,1]}}>
          {children}
        </motion.div>
      </main>
    </div>
  );
}
