import { Switch, Route, Router as WouterRouter, useHashLocation, useLocation } from "wouter";
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
import Hub from "@/pages/Hub";
import Hangouts from "@/pages/Hangouts";
import Invite from "@/pages/Invite";
import MyProfile from "@/pages/MyProfile";
import ModerationPanel from "@/pages/ModerationPanel";
import Chat from "@/pages/Chat";
import UpdatesPage from "@/pages/Updates";
import ServersPage from "@/pages/Servers";
import Dihtro from "@/pages/Dihtro";

const desktopFileApp = window.location.protocol === "file:";
const nativeApp = Capacitor.isNativePlatform() || desktopFileApp;

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
 const {user,isLoading}=useAuth();
 if(isLoading)return <div className="flex min-h-screen items-center justify-center bg-background"><div className="flex flex-col items-center gap-4"><Loader2 className="h-10 w-10 animate-spin text-primary"/><span className="text-xs tracking-widest text-primary">LOADING NEXUS</span></div></div>;
 if(!user)return <Login/>;
 return <Component/>;
}
function Home(){const {user,isLoading}=useAuth();if(nativeApp && !desktopFileApp)return <Login/>;if(isLoading)return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary"/></div>;return user?<Proxy/>:<Landing/>;}
function Router(){return <Switch>
 <Route path="/" component={Home}/>
 <Route path="/sign-in" component={Login}/>
 <Route path="/sign-up" component={Login}/>
 <Route path="/signup" component={Login}/>
 <Route path="/invite/:code">{params=><Invite code={params.code}/>}</Route>
 <Route path="/main-page"><ProtectedRoute component={Proxy}/></Route>
 <Route path="/proxy"><ProtectedRoute component={Proxy}/></Route>
 <Route path="/chat" component={()=>null}/>
 <Route path="/servers"><ProtectedRoute component={ServersPage}/></Route>
 <Route path="/updates"><ProtectedRoute component={UpdatesPage}/></Route>
 <Route path="/history"><ProtectedRoute component={History}/></Route>
 <Route path="/moderation"><ProtectedRoute component={ModerationPanel}/></Route>
 <Route path="/admin"><ProtectedRoute component={Admin}/></Route>
 <Route path="/shop"><ProtectedRoute component={Shop}/></Route>
 <Route path="/dihtro"><ProtectedRoute component={Dihtro}/></Route>
 <Route path="/dihtro/claim/:code">{params => <ProtectedRoute component={() => <Dihtro code={params.code}/>} />}</Route>
 <Route path="/profile"><ProtectedRoute component={MyProfile}/></Route>
 <Route path="/settings"><ProtectedRoute component={SettingsPage}/></Route>
 <Route path="/block-blast"><ProtectedRoute component={BlockBlast}/></Route>
 <Route path="/hub"><ProtectedRoute component={Hub}/></Route>
 <Route path="/hangouts"><ProtectedRoute component={Hangouts}/></Route>
 <Route component={NotFound}/>
 </Switch>}
function GlobalChatHost(){const {user,isLoading}=useAuth();const [location]=useLocation();if(isLoading||!user)return null;const active=location==="/chat";return <div aria-hidden={!active} style={{position:"fixed",inset:0,zIndex:30,visibility:active?"visible":"hidden",pointerEvents:active?"auto":"none"}}><Chat/></div>}
export default function App(){return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter hook={desktopFileApp ? useHashLocation : undefined}><Router/><GlobalChatHost/></WouterRouter><Toaster/></TooltipProvider></QueryClientProvider>}
