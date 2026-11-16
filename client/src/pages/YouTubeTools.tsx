import { useState } from "react";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import { Youtube, Download, Music2, Film, Loader2, ShieldCheck, ExternalLink, AlertCircle } from "lucide-react";

type Format = "mp3" | "mp4";
type Result = { url: string; filename: string };

export default function YouTubeTools() {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<Format>("mp4");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const { toast } = useToast();

  const convert = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setResult(null);
    setBusy(true);
    try {
      const response = await fetch("/api/youtube/convert", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), format }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Conversion could not be started.");
      if (!data.downloadUrl || typeof data.downloadUrl !== "string") throw new Error("The converter returned no download link.");
      setResult({ url: data.downloadUrl, filename: data.filename || (format === "mp3" ? "audio.mp3" : "video.mp4") });
      toast({ title: "Your file is ready", description: "The file is served by the converter, not stored by NEXUS." });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Something went wrong.";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="relative overflow-hidden rounded-3xl border border-red-400/20 bg-gradient-to-br from-[#241017] via-[#111827] to-[#101323] p-6 sm:p-9">
          <div className="pointer-events-none absolute -right-10 -top-16 h-64 w-64 rounded-full bg-red-500/10 blur-3xl"/>
          <div className="relative flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-red-400/30 bg-red-500/10 text-red-300"><Youtube size={26}/></div>
            <div><div className="text-[10px] font-bold uppercase tracking-[.24em] text-red-300">NEXUS MEDIA TOOLS</div><h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">YouTube Converter</h1></div>
          </div>
          <p className="relative mt-4 max-w-2xl text-sm leading-6 text-white/60">Convert videos you own or have permission to download into MP4 video or MP3 audio. Your downloads are streamed by the converter and are never saved in NEXUS databases.</p>
        </div>

        <form onSubmit={convert} className="rounded-3xl border border-white/10 bg-[#111827]/90 p-5 shadow-2xl sm:p-7">
          <label htmlFor="youtube-url" className="mb-2 block text-xs font-bold uppercase tracking-wider text-white/60">YouTube video link</label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input id="youtube-url" type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." className="h-12 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-red-400/60"/>
            <button type="submit" disabled={busy || !url.trim()} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-red-500 px-6 text-sm font-extrabold text-white shadow-lg shadow-red-950/30 transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? <><Loader2 size={17} className="animate-spin"/> Preparing…</> : <><Download size={17}/> Convert</>}
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => {setFormat("mp4");setResult(null);setError("");}} className={`flex items-center gap-3 rounded-xl border p-4 text-left transition ${format === "mp4" ? "border-red-400/60 bg-red-500/10 text-white" : "border-white/10 bg-black/20 text-white/55 hover:border-white/20"}`}>
              <Film size={22}/><span><span className="block text-sm font-bold">MP4 Video</span><span className="mt-0.5 block text-[11px] opacity-60">720p · H.264</span></span>
            </button>
            <button type="button" onClick={() => {setFormat("mp3");setResult(null);setError("");}} className={`flex items-center gap-3 rounded-xl border p-4 text-left transition ${format === "mp3" ? "border-red-400/60 bg-red-500/10 text-white" : "border-white/10 bg-black/20 text-white/55 hover:border-white/20"}`}>
              <Music2 size={22}/><span><span className="block text-sm font-bold">MP3 Audio</span><span className="mt-0.5 block text-[11px] opacity-60">192 kbps</span></span>
            </button>
          </div>
        </form>

        {error && <div role="alert" className="flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-100"><AlertCircle size={18} className="mt-0.5 shrink-0 text-amber-300"/><span>{error}</span></div>}
        {result && <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/5 p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-emerald-200"><ShieldCheck size={18}/> Conversion ready</div>
          <p className="mt-2 truncate text-xs text-white/55">{result.filename}</p>
          <a href={result.url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-5 py-3 text-sm font-extrabold text-[#07130d] transition hover:bg-emerald-300"><Download size={17}/> Download {format.toUpperCase()} <ExternalLink size={14}/></a>
        </div>}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[.03] p-4"><div className="text-xs font-bold text-white">No NEXUS file storage</div><p className="mt-1 text-xs leading-5 text-white/50">NEXUS stores no media, conversion output, or download history in Neon or Enzonic. The external converter handles the stream.</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/[.03] p-4"><div className="text-xs font-bold text-white">Use responsibly</div><p className="mt-1 text-xs leading-5 text-white/50">Only convert content you own or are authorised to download. Respect copyright and YouTube's terms.</p></div>
        </div>
      </div>
    </Layout>
  );
}
