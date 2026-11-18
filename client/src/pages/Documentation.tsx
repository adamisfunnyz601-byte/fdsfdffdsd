import { Link, useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { AlertTriangle, BookOpen, CheckCircle2, Copy, ExternalLink, ShieldAlert } from "lucide-react";

const errors = [
  { code:"NEXUS-0x0001", title:"Global crash screen / maintenance mode", severity:"SYSTEM", cause:"A Super Owner has activated the global crash screen. Super Owner accounts are exempt.", fix:"Wait for a Super Owner to clear the screen. If you are a Super Owner, open Moderation → NEXUS Crash Screen / BSOD Control and select Clear / restore NEXUS." },
  { code:"NEXUS-0x0002", title:"Chat failed to render", severity:"CLIENT", cause:"The Chat interface encountered a rendering error or an incompatible component state.", fix:"Reload NEXUS. If it repeats, capture the browser console error and report it with this code. Chat is isolated as a protected route so other pages should remain available." },
  { code:"NEXUS-0x0003", title:"Chat messages unavailable", severity:"NETWORK", cause:"The messages endpoint did not return a successful response, or the session expired.", fix:"Check that you are signed in, refresh the page, and retry. If only chat is affected, include the time and this code when reporting it." },
  { code:"NEXUS-0x0004", title:"Session could not be verified", severity:"AUTH", cause:"The server could not validate the current login session.", fix:"Sign out and sign in again. If the issue continues, check that cookies are enabled for the NEXUS site." },
  { code:"NEXUS-0x0005", title:"Live updates are delayed", severity:"NETWORK", cause:"The browser cannot reach one or more polling endpoints reliably.", fix:"Check your connection, reload NEXUS, and try again. A temporary delay does not necessarily mean your messages were lost." },
  { code:"NEXUS-0x0006", title:"Media or attachment unavailable", severity:"MEDIA", cause:"An uploaded image, audio clip, video, or thumbnail could not be loaded.", fix:"Retry the upload or reload the conversation. If the file repeatedly returns 404, report the attachment URL and this code to an administrator." },
  { code:"NEXUS-0x0007", title:"Permission denied", severity:"ACCESS", cause:"Your account does not have the role required for the requested action.", fix:"Check your account role. Only authorised staff can use moderation tools; only Super Owners can control the global crash screen." },
  { code:"NEXUS-0x0008", title:"Server temporarily unavailable", severity:"SERVER", cause:"The NEXUS server or a dependent service did not respond.", fix:"Wait briefly and retry. If the issue persists, provide the time, page, and this code to the NEXUS administrator." },
];

export default function DocumentationPage(){
 const [location]=useLocation();
 const code=new URLSearchParams(window.location.search).get("code")||"";
 const selected=errors.find(item=>item.code===code);
 const copy=(value:string)=>{void navigator.clipboard?.writeText(value)};
 return <Layout><div className="nexus-page mx-auto max-w-5xl space-y-6 py-5">
  <header className="rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-500/10 to-transparent p-6 sm:p-8">
   <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[.2em] text-violet-300"><BookOpen size={16}/> NEXUS SYSTEM DOCUMENTATION</div>
   <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">Error codes & troubleshooting</h1>
   <p className="mt-3 max-w-2xl text-sm leading-6 text-white/55">A practical guide to NEXUS stop codes, chat issues, sign-in problems, media errors, and service interruptions.</p>
   <div className="mt-5 flex flex-wrap gap-3"><Link href="/chat" className="rounded-lg bg-violet-500 px-4 py-2 text-xs font-bold text-white">Return to chat</Link><Link href="/moderation" className="rounded-lg border border-white/10 px-4 py-2 text-xs font-bold text-white/70">Moderation</Link></div>
  </header>
  {code&&<section className="rounded-xl border border-amber-300/30 bg-amber-300/5 p-4"><div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-amber-200"><AlertTriangle size={15}/> Requested stop code</div>{selected?<><h2 className="mt-2 font-bold text-white">{selected.code} · {selected.title}</h2><p className="mt-2 text-sm text-white/60">{selected.cause}</p><p className="mt-2 text-sm text-white/80"><b>What to do:</b> {selected.fix}</p></>:<p className="mt-2 text-sm text-white/60">The code <b>{code}</b> is not in this published list yet. Copy it and include it when reporting the issue.</p>}</section>}
  <section className="grid gap-3 sm:grid-cols-2">
   {errors.map(item=><article key={item.code} className={`rounded-xl border p-4 ${item.code===code?"border-amber-300/40 bg-amber-300/5":"border-white/10 bg-white/[.025]"}`}>
    <div className="flex items-start justify-between gap-3"><div><div className="font-mono text-xs font-black text-violet-200">{item.code}</div><h2 className="mt-1 text-base font-bold text-white">{item.title}</h2></div><span className="rounded-md border border-white/10 px-2 py-1 text-[9px] font-bold tracking-wider text-white/45">{item.severity}</span></div>
    <p className="mt-3 text-xs leading-5 text-white/55"><b className="text-white/75">Cause:</b> {item.cause}</p>
    <p className="mt-2 text-xs leading-5 text-white/70"><b className="text-white">Fix:</b> {item.fix}</p>
    <button onClick={()=>copy(item.code)} className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold text-violet-300 hover:text-white"><Copy size={12}/> Copy code</button>
   </article>)}
  </section>
  <section className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-5"><div className="flex items-center gap-2 text-sm font-bold text-emerald-200"><CheckCircle2 size={17}/> Before reporting a problem</div><ol className="mt-3 list-decimal space-y-2 pl-5 text-xs leading-5 text-white/65"><li>Refresh NEXUS once and confirm your internet connection.</li><li>Check whether the problem affects one page or the whole site.</li><li>Copy the exact stop code and note the time it happened.</li><li>For a blank page, include a screenshot and any browser console error. Never send passwords, session cookies, or API keys.</li></ol></section>
  <p className="text-center text-[10px] text-white/30">NEXUS documentation · Error codes may be expanded as new diagnostics are added.</p>
 </div></Layout>;
}
