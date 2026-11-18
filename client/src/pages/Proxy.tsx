import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
import { CyberInput } from "@/components/CyberInput";
import { CyberButton } from "@/components/CyberButton";
import { Search, Globe, Shield, AlertTriangle, RefreshCw, ArrowLeft, ArrowRight, Maximize2, Minimize2 } from "@/components/ManagedIcons";
import { useHistory } from "@/hooks/use-history";
import { useToast } from "@/hooks/use-toast";

export default function Proxy() {
  const [url, setUrl] = useState("");
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [proxyUrl, setProxyUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setIsFullscreen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFullscreen]);
  const { addEntry } = useHistory();
  const { toast } = useToast();

  const navigate = (target: string) => {
    let fixed = target.trim();
    if (!fixed) return;
    if (!fixed.startsWith("http://") && !fixed.startsWith("https://")) {
      // If it looks like a domain, add https
      if (fixed.includes(".") && !fixed.includes(" ")) {
        fixed = `https://${fixed}`;
      } else {
        // Otherwise treat as a search
        fixed = `https://www.google.com/search?q=${encodeURIComponent(fixed)}`;
      }
    }
    setActiveUrl(fixed);
    setUrl(fixed);
    const encoded = `/api/proxy?url=${encodeURIComponent(fixed)}`;
    setProxyUrl(encoded);
    setIsLoading(true);
    addEntry.mutate({ url: fixed, query: "Proxy Visit" });
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(url);
  };

  return (
    <Layout>
      <div className={`${isFullscreen ? "fixed inset-0 z-[100] h-[100dvh] w-screen bg-background p-2 sm:p-3" : ""} nexus-page nexus-page-proxy flex min-h-0 w-full flex-col gap-3 space-y-0`}>
        {/* Browser Chrome */}
        <div className="cyber-box min-w-0 p-3 sm:p-4">
          <form onSubmit={handleSearch} className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">
            <button
              type="button"
              disabled={!activeUrl}
              className="p-2 border border-primary/20 hover:border-primary text-primary/50 hover:text-primary disabled:opacity-30 transition-all"
              title="Reload"
              onClick={() => { if (activeUrl) navigate(activeUrl); }}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <div className="relative min-w-0 flex-1 basis-full sm:basis-0">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-primary/30" />
              <input
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="Enter URL or search term..."
                className="h-11 w-full min-w-0 rounded-md bg-black border border-primary/20 pl-9 pr-3 py-2 text-base sm:text-[13px] font-mono text-primary outline-none focus:border-primary/50 transition-all"
                autoFocus
              />
            </div>
            <CyberButton type="submit" className="h-10 px-5 py-2 text-[12px] shrink-0">
              <Search className="w-3.5 h-3.5 mr-1.5 inline" />
              GO
            </CyberButton>
          </form>
        </div>

        {/* Browser Window */}
        <div className={`flex ${isFullscreen ? "min-h-0" : "min-h-[min(62vh,620px)]"} min-w-0 flex-1 flex-col overflow-hidden relative cyber-box p-0`}>
          {/* Tab bar */}
          <div className="flex h-10 min-w-0 shrink-0 items-center gap-2 border-b border-primary/20 bg-black/60 px-3 sm:gap-3 sm:px-4">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/50" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
              <div className="w-3 h-3 rounded-full bg-green-500/50" />
            </div>
            <div className="flex h-7 min-w-0 flex-1 items-center truncate rounded border border-primary/10 bg-black/30 px-2 text-[10px] font-mono text-muted-foreground sm:px-3 sm:text-[11px]">
              {activeUrl ? (
                <span className="flex items-center gap-2">
                  <Shield className="w-3 h-3 text-primary/50 shrink-0" />
                  {activeUrl}
                </span>
              ) : "NO_TARGET_SELECTED"}
            </div>
            {isLoading && activeUrl && (
              <div className="text-[9px] font-mono text-primary/40 animate-pulse">LOADING...</div>
            )}
            <button
              type="button"
              onClick={() => setIsFullscreen(value => !value)}
              className="shrink-0 rounded border border-primary/20 p-1.5 text-primary/70 transition-colors hover:border-primary hover:text-primary"
              title={isFullscreen ? "Exit full screen" : "Full screen"}
              aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>

          {/* Content area */}
          <div className="relative min-h-0 min-w-0 flex-1 bg-white">
            {proxyUrl ? (
              <iframe
                key={proxyUrl}
                src={proxyUrl}
                className="w-full h-full border-none bg-white"
                title="Proxy View"
                onLoad={() => setIsLoading(false)}
                onError={() => setIsLoading(false)}
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 overflow-y-auto bg-black px-4 py-6 text-primary sm:gap-6">
                <Globe className="w-20 h-20 opacity-30 animate-pulse" />
                <div className="text-center space-y-2">
                  <h2 className="text-xl font-display tracking-widest">SECURE_BROWSER_READY</h2>
                  <p className="text-muted-foreground font-mono text-sm">ENTER URL OR SEARCH TERM ABOVE</p>
                </div>
                <div className="grid w-full max-w-xl grid-cols-1 gap-3 px-1 sm:grid-cols-3 sm:gap-4 sm:px-4">
                  {[
                    { icon: Shield, title: "PROXIED", desc: "Traffic routed through server" },
                    { icon: AlertTriangle, title: "HISTORY", desc: "Session logged locally only" },
                    { icon: Globe, title: "ANY SITE", desc: "Bypass iframe restrictions" },
                  ].map(({ icon: Icon, title, desc }) => (
                    <div key={title} className="min-w-0 rounded-lg border border-primary/20 bg-primary/5 p-3 text-center sm:p-4">
                      <Icon className="w-7 h-7 mx-auto mb-2 text-primary/60" />
                      <div className="text-[10px] font-bold mb-1">{title}</div>
                      <div className="text-[9px] text-muted-foreground">{desc}</div>
                    </div>
                  ))}
                </div>
                <div className="grid w-full max-w-xl grid-cols-2 gap-2 px-1 sm:grid-cols-3 sm:px-4">
                  {["google.com", "youtube.com", "wikipedia.org", "reddit.com", "github.com", "twitch.tv"].map(site => (
                    <button key={site} onClick={() => navigate(site)}
                      className="min-w-0 truncate rounded-md border border-primary/10 px-2 py-2 text-[10px] font-mono text-primary/55 transition-all hover:border-primary/40 hover:text-primary/90">
                      {site}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
