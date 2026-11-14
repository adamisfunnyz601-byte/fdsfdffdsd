import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { MessageCircle, Server, Settings, LogOut, Shield, Compass, History, UserRound } from "lucide-react";
import { Avatar } from "./ProfileModal";
import { UserProfileTag } from "./UserProfileTag";

export function Layout({children}:{children:React.ReactNode}){
 const {user,logout}=useAuth();const [location]=useLocation();
 const links=[{href:"/chat",label:"Messages",icon:MessageCircle},{href:"/servers",label:"Servers",icon:Server},{href:"/proxy",label:"Explore",icon:Compass},{href:"/history",label:"History",icon:History},{href:"/settings",label:"Settings",icon:Settings}];
 return <div className="flex min-h-dvh flex-col bg-[#23252f] text-white md:flex-row">
  <aside className="z-40 flex shrink-0 flex-row items-center justify-between border-b border-black/20 bg-[#1b1d26] px-3 py-2 md:h-dvh md:w-[76px] md:flex-col md:justify-start md:gap-3 md:border-b-0 md:border-r md:px-0 md:py-4">
   <Link href="/chat" title="NEXUS" className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-600 text-lg font-black shadow-lg shadow-violet-950/30">N</Link>
   <div className="hidden h-px w-8 bg-white/10 md:block"/>
   <nav className="flex items-center gap-2 md:flex-col md:gap-3">{links.map(({href,label,icon:Icon})=><Link key={href} href={href} title={label} aria-label={label} className={`grid h-11 w-11 place-items-center rounded-2xl transition hover:rounded-xl hover:bg-violet-600/30 ${location===href?"rounded-xl bg-violet-600 text-white":"bg-[#30333f] text-white/60"}`}><Icon size={19}/></Link>)}</nav>
   <div className="hidden flex-1 md:block"/>
   {user&&<><Link href="/profile" title="My profile" className="hidden rounded-full ring-2 ring-transparent transition hover:ring-violet-400 md:block"><Avatar url={user.avatarUrl} name={user.username||"?"} size={42}/></Link><button onClick={()=>logout()} title="Sign out" className="grid h-10 w-10 place-items-center rounded-xl text-white/45 hover:bg-rose-500/15 hover:text-rose-300"><LogOut size={18}/></button></>}
  </aside>
  <main className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
 </div>;
}
