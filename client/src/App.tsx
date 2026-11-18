import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { useEffect, useState, Component } from "react";
import { apiUrl } from "@/lib/api-url";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import Login from "@/pages/Login";
import Landing from "@/pages/Landing";
import Proxy from "@/pages/Proxy";
import History from "@/pages/History";
import Admin from "@/pages/Admin";
import Shop from "@/pages/Shop";
import NotFound from "@/pages/not-found";
import SettingsPage from "@/pages/Settings";
import BlockBlast from "@/pages/BlockBlast";
import Invite from "@/pages/Invite";
import MyProfile from "@/pages/MyProfile";
import ModerationPanel from "@/pages/ModerationPanel";
import Chat from "@/pages/Chat";
import UpdatesPage from "@/pages/Updates";
import Dihtro from "@/pages/Dihtro";
import GSGifts from "@/pages/GSGifts";
import TermsPage from "@/pages/Terms";
import YouTubeTools from "@/pages/YouTubeTools";
import DocumentationPage from "@/pages/Documentation";

const desktopFileApp = window.location.protocol === "file:";
const nativeApp = Capacitor.isNativePlatform() || desktopFileApp;

function PresenceHeartbeat() {
 const { user } = useAuth();
 useEffect(() => {
  if (!user) return;
  const heartbeat = () => {
   if (document.visibilityState !== "visible") return;
   fetch(apiUrl("/api/presence/heartbeat"), { method: "POST", credentials: "include", keepalive: true }).catch(() => {});
  };
  heartbeat();
  const timer = window.setInterval(heartbeat, 25_000);
  document.addEventListener("visibilitychange", heartbeat);
  window.addEventListener("pagehide", () => {
   // The server's 90-second expiry is the reliable fallback if this best-effort request is lost.
   if (document.visibilityState === "visible") heartbeat();
  });
  return () => {
   window.clearInterval(timer);
   document.removeEventListener("visibilitychange", heartbeat);
  };
 }, [user?.id]);
 return null;
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
 const {user,isLoading}=useAuth();
 if(isLoading)return <div className="flex min-h-screen items-center justify-center bg-background"><div className="flex flex-col items-center gap-4"><Loader2 className="h-10 w-10 animate-spin text-primary"/><span className="text-xs tracking-widest text-primary">LOADING NEXUS</span></div></div>;
 if(!user)return <Login/>;
 return <Component/>;
}
function Home(){const {user,isLoading}=useAuth();if(nativeApp && !desktopFileApp)return <Login/>;if(isLoading)return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary"/></div>;return user?<Proxy/>:<Landing/>;}
function Router(){return <Switch>
 <Route path="/" component={Home}/>
 <Route path="/terms" component={TermsPage}/>
 <Route path="/documentation" component={DocumentationPage}/>
 <Route path="/sign-in" component={Login}/>
 <Route path="/sign-up" component={Login}/>
 <Route path="/signup" component={Login}/>
 <Route path="/invite/:code">{params=><Invite code={params.code}/>}</Route>
 <Route path="/main-page"><ProtectedRoute component={Proxy}/></Route>
 <Route path="/proxy"><ProtectedRoute component={Proxy}/></Route>
 <Route path="/chat"><ProtectedRoute component={()=> <ChatErrorBoundary><Chat/></ChatErrorBoundary>}/></Route>
 <Route path="/updates"><ProtectedRoute component={UpdatesPage}/></Route>
 <Route path="/youtube-tools"><ProtectedRoute component={YouTubeTools}/></Route>
 <Route path="/history"><ProtectedRoute component={History}/></Route>
 <Route path="/moderation"><ProtectedRoute component={ModerationPanel}/></Route>
 <Route path="/admin"><ProtectedRoute component={Admin}/></Route>
 <Route path="/shop"><ProtectedRoute component={Shop}/></Route>
 <Route path="/gs"><ProtectedRoute component={Dihtro}/></Route>
 <Route path="/gs/claim/:code">{params => <Dihtro code={params.code}/>}</Route>
 <Route path="/gs/gifts"><ProtectedRoute component={GSGifts}/></Route>
 <Route path="/dihtro/claim/:code">{params => <Redirect to={`/gs/claim/${params.code}`}/>}</Route>
 <Route path="/dihtro"><Redirect to="/gs"/></Route>
 <Route path="/profile"><ProtectedRoute component={MyProfile}/></Route>
 <Route path="/settings"><ProtectedRoute component={SettingsPage}/></Route>
 <Route path="/block-blast"><ProtectedRoute component={BlockBlast}/></Route>
 <Route component={NotFound}/>
 </Switch>}
class ChatErrorBoundary extends Component<{children: React.ReactNode},{error: Error | null}> {
 state = { error: null as Error | null };
 static getDerivedStateFromError(error: Error) { return { error }; }
 componentDidCatch(error: Error, info: React.ErrorInfo) {
  console.error("[NEXUS CHAT CRASH]", error, info.componentStack);
 }
 render() {
  if (this.state.error) return <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-auto bg-[#090611] p-5 text-white"><div className="w-full max-w-xl rounded-2xl border border-red-400/30 bg-[#160d20] p-6 shadow-2xl"><div className="mb-2 text-xs font-black tracking-[.2em] text-red-300">CHAT RECOVERY MODE</div><h1 className="text-xl font-bold">Chat hit an error</h1><p className="mt-2 text-sm text-white/60">The rest of NEXUS is still running. This error was caught so it cannot blank the whole app.</p><pre className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/40 p-3 text-xs text-red-200">{this.state.error.message}</pre><button className="mt-4 rounded-lg bg-violet-500 px-4 py-2 text-sm font-bold" onClick={() => this.setState({error:null})}>Try chat again</button></div></div>;
  return this.props.children;
 }
}

function CrashScreenController(){
 const {user}=useAuth();
 const [state,setState]=useState<{active:boolean;errorCode?:string;details?:string;isSuperOwner?:boolean}>({active:false});
 useEffect(()=>{
  if(!user)return;
  let alive=true;
  const load=()=>fetch(apiUrl("/api/system/crash-state"),{credentials:"include",cache:"no-store"}).then(r=>r.ok?r.json():null).then(v=>{if(alive&&v)setState(v)}).catch(()=>{});
  void load(); const timer=window.setInterval(load,4000);
  return()=>{alive=false;window.clearInterval(timer)};
 },[user?.id]);
 if(!user||!state.active||state.isSuperOwner)return null;
 const docUrl=window.location.origin+"/documentation?code="+encodeURIComponent(state.errorCode||"NEXUS-0x0001");
 const qrUrl="https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=0&data="+encodeURIComponent(docUrl);
 return <div role="alert" aria-live="assertive" className="fixed inset-0 z-[100000] overflow-auto bg-black text-white" style={{fontFamily:"Arial,Helvetica,sans-serif"}}>
  <div className="mx-auto flex min-h-full w-full max-w-[1620px] flex-col justify-center px-[7.8vw] py-12">
   <div className="mb-8 text-[clamp(100px,16vw,190px)] font-light leading-[.8] tracking-[-.1em]">:(</div>
   <p className="max-w-[1320px] text-[clamp(25px,2.5vw,42px)] font-light leading-[1.9]">Uh oh! Seems that Nexus hub has crashed or either triggered by an external system event. Please scan the QR code or read documentation for more details.</p>
   <div className="mt-8 flex flex-wrap items-center gap-4 sm:gap-5">
    <a href={docUrl} aria-label="Open NEXUS error documentation" className="block h-[180px] w-[180px] shrink-0 bg-white p-2"><img src={qrUrl} alt="QR code linking to NEXUS documentation" className="h-full w-full" /></a>
    <div className="min-w-0">
     <a href={docUrl} className="text-[clamp(22px,2.3vw,40px)] font-light hover:underline">Scan this for more information.</a>
     <div className="break-words text-[clamp(20px,2.2vw,38px)] font-light">STOP_CODE: {state.errorCode||"NEXUS-0x0001"}</div>
     <div className="mt-1 text-[clamp(15px,1.5vw,25px)]">{state.details||"Thank you for using nexus, we will try troubleshooting as soon as possible."}</div>
    </div>
   </div>
   <div className="mt-8 text-sm text-white/40">NEXUS SYSTEM RECOVERY · <a className="underline" href={docUrl}>Open documentation</a></div>
  </div>
 </div>;
}
\nexport default function App(){return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter hook={desktopFileApp ? useHashLocation : undefined}><Router/><CrashScreenController/><PresenceHeartbeat/><GlobalChatHost/></WouterRouter><Toaster/></TooltipProvider></QueryClientProvider>}
