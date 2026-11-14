import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { MessageCircle, Server, Settings, LogOut } from "lucide-react";
import { Avatar } from "./ProfileModal";
import { useEffect } from "react";
import { applyNexusAppearance, readNexusAppearance } from "@/lib/appearance";

export function Layout({children}:{children:React.ReactNode}){
 const {user,logout}=useAuth();const [location]=useLocation();
 const links=[{href:"/chat",label:"Messages",icon:MessageCircle},{href:"/servers",label:"Servers",icon:Server},{href:"/settings",label:"Settings",icon:Settings}];
 useEffect(()=>{const apply=()=>applyNexusAppearance(readNexusAppearance());apply();window.addEventListener("nexus-appearance-change",apply);return()=>window.removeEventListener("nexus-appearance-change",apply);},[]);
 return <div className="nexus-shell flex h-dvh flex-col text-white md:flex-row">
  <aside className="z-40 flex shrink-0 flex-row items-center justify-between border-b border-white/10 bg-black/25 backdrop-blur-2xl px-3 py-2 md:h-dvh md:w-[76px] md:flex-col md:justify-start md:gap-3 md:border-b-0 md:border-r md:px-0 md:py-4">
   <Link href="/chat" title="NEXUS" className="grid h-11 w-11 place-items-center nexus-btn nexus-btn--glow rounded-2xl text-lg font-black shadow-lg shadow-violet-950/30">N</Link>
   <div className="hidden h-px w-8 bg-white/10 md:block"/>
   <nav className="flex items-center gap-2 md:flex-col md:gap-3">{links.map(({href,label,icon:Icon})=><Link key={href} href={href} title={label} aria-label={label} className={`grid h-11 w-11 place-items-center rounded-2xl transition hover:rounded-xl hover:bg-violet-600/30 ${location===href?"rounded-xl bg-violet-600 text-white":"border border-white/10 bg-white/[0.045] text-white/60 backdrop-blur-xl"}`}><Icon size={19}/></Link>)}</nav>
   <div className="hidden flex-1 md:block"/>
   {user&&<><Link href="/profile" title="My profile" className="hidden rounded-full ring-2 ring-transparent transition hover:ring-violet-400 md:block"><Avatar url={user.avatarUrl} name={user.username||"?"} size={42}/></Link><button onClick={()=>logout()} title="Sign out" className="grid h-10 w-10 place-items-center rounded-xl text-white/45 hover:bg-rose-500/15 hover:text-rose-300"><LogOut size={18}/></button></>}
  </aside>
  <main className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
 </div>;
}
