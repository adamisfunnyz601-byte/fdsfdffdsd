import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { useEffect, Component } from "react";
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
 <Route path="/sign-in" component={Login}/>
 <Route path="/sign-up" component={Login}/>
 <Route path="/signup" component={Login}/>
 <Route path="/invite/:code">{params=><Invite code={params.code}/>}</Route>
 <Route path="/main-page"><ProtectedRoute component={Proxy}/></Route>
 <Route path="/proxy"><ProtectedRoute component={Proxy}/></Route>
 <Route path="/chat" component={()=>null}/>
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
function GlobalChatHost(){const {user,isLoading}=useAuth();const [location]=useLocation();if(isLoading||!user||location!=="/chat")return null;return <div style={{position:"fixed",inset:0,zIndex:30}}><ChatErrorBoundary><Chat/></ChatErrorBoundary></div>}
export default function App(){return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter hook={desktopFileApp ? useHashLocation : undefined}><Router/><PresenceHeartbeat/><GlobalChatHost/></WouterRouter><Toaster/></TooltipProvider></QueryClientProvider>}
