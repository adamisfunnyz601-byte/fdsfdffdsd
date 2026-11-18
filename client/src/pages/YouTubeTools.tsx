import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import { Youtube, Download, Music2, Film, Loader2, ShieldCheck, AlertCircle, Clapperboard } from "lucide-react";

type Format = "mp4" | "mp3" | "mov";
type Result = { url: string; filename: string };
const videoQualities = ["360", "480", "720", "1080", "1440", "best"] as const;
const audioQualities = ["128", "192", "256", "320"] as const;

export default function YouTubeTools() {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<Format>("mp4");
  const [quality, setQuality] = useState("720");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    return () => {
      if (result?.url) URL.revokeObjectURL(result.url);
    };
  }, [result?.url]);

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
        body: JSON.stringify({ url: url.trim(), format, quality }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Conversion could not be completed.");
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error("The converter returned an empty file.");
      const disposition = response.headers.get("content-disposition") || "";
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] || `nexus-conversion.${format}`;
      const downloadUrl = URL.createObjectURL(blob);
      setResult({ url: downloadUrl, filename });
      toast({ title: "Your file is ready", description: "The file was streamed directly from the NEXUS converter and was not saved in a database." });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const chooseFormat = (next: Format) => {
    setFormat(next);
    setQuality(next === "mp3" ? "192" : "720");
    setResult(null);
    setError("");
  };

  return (
    <Layout>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="relative overflow-hidden rounded-3xl border border-red-400/20 bg-gradient-to-br from-[#241017] via-[#111827] to-[#101323] p-6 sm:p-9">
          <div className="pointer-events-none absolute -right-10 -top-16 h-64 w-64 rounded-full bg-red-500/10 blur-3xl"/>
          <div className="relative flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-red-400/30 bg-red-500/10 text-red-300"><Youtube size={26}/></div>
            <div><div className="text-[10px] font-bold uppercase tracking-[.24em] text-red-300">NEXUS MEDIA TOOLS · POWERED BY yt-dlp</div><h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">YouTube Converter</h1></div>
          </div>
          <p className="relative mt-4 max-w-2xl text-sm leading-6 text-white/60">Convert videos you own or are authorised to download. Pick MP4, MOV or MP3 and choose the quality. Files are streamed to your browser and are never written to Neon or Enzonic.</p>
        </div>

        <form onSubmit={convert} className="rounded-3xl border border-white/10 bg-[#111827]/90 p-5 shadow-2xl sm:p-7">
          <label htmlFor="youtube-url" className="mb-2 block text-xs font-bold uppercase tracking-wider text-white/60">YouTube video link</label>
          <input id="youtube-url" type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." className="h-12 w-full rounded-xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-red-400/60"/>

          <div className="mt-5">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-white/60">Output format</div>
            <div className="grid grid-cols-3 gap-3">
              <button type="button" onClick={() => chooseFormat("mp4")} className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-bold transition ${format === "mp4" ? "border-red-400/60 bg-red-500/10 text-white" : "border-white/10 bg-black/20 text-white/55 hover:border-white/20"}`}><Film size={19}/> MP4</button>
              <button type="button" onClick={() => chooseFormat("mov")} className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-bold transition ${format === "mov" ? "border-red-400/60 bg-red-500/10 text-white" : "border-white/10 bg-black/20 text-white/55 hover:border-white/20"}`}><Clapperboard size={19}/> MOV</button>
              <button type="button" onClick={() => chooseFormat("mp3")} className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-bold transition ${format === "mp3" ? "border-red-400/60 bg-red-500/10 text-white" : "border-white/10 bg-black/20 text-white/55 hover:border-white/20"}`}><Music2 size={19}/> MP3</button>
            </div>
          </div>

          <div className="mt-5">
            <label htmlFor="youtube-quality" className="mb-2 block text-xs font-bold uppercase tracking-wider text-white/60">{format === "mp3" ? "Audio bitrate" : "Video quality"}</label>
            <select id="youtube-quality" value={quality} onChange={e => {setQuality(e.target.value);setResult(null);setError("");}} className="h-12 w-full rounded-xl border border-white/10 bg-[#0b1020] px-4 text-sm text-white outline-none focus:border-red-400/60">
              {format === "mp3"
                ? audioQualities.map(value => <option key={value} value={value}>{value} kbps</option>)
                : videoQualities.map(value => <option key={value} value={value}>{value === "best" ? "Best available" : `${value}p`}</option>)}
            </select>
            {format !== "mp3" && <p className="mt-2 text-[11px] text-white/40">The selected resolution is a maximum; if the video has no matching stream, yt-dlp selects the best available lower quality.</p>}
          </div>

          <button type="submit" disabled={busy || !url.trim()} className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-500 px-6 text-sm font-extrabold text-white shadow-lg shadow-red-950/30 transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? <><Loader2 size={17} className="animate-spin"/> Converting…</> : <><Download size={17}/> Convert to {format.toUpperCase()}</>}
          </button>
        </form>

        {error && <div role="alert" className="flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-100"><AlertCircle size={18} className="mt-0.5 shrink-0 text-amber-300"/><span>{error}</span></div>}
        {result && <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/5 p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-emerald-200"><ShieldCheck size={18}/> Conversion ready</div>
          <p className="mt-2 truncate text-xs text-white/55">{result.filename}</p>
          {format === "mp4" || format === "mov" ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-black">
              <video
                key={result.url}
                src={result.url}
                controls
                playsInline
                preload="metadata"
                className="block aspect-video max-h-[65vh] w-full bg-black object-contain"
                aria-label="Converted video preview"
              >
                Your browser does not support video playback.
              </video>
              <p className="px-3 py-2 text-[11px] text-white/45">Preview works inline on iPhone, iPad and Android. Tap play to watch.</p>
            </div>
          ) : (
            <audio key={result.url} src={result.url} controls preload="metadata" className="mt-4 w-full" aria-label="Converted audio preview" />
          )}
          <a href={result.url} download={result.filename} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-5 py-3 text-sm font-extrabold text-[#07130d] transition hover:bg-emerald-300"><Download size={17}/> Download {format.toUpperCase()}</a>
        </div>}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[.03] p-4"><div className="text-xs font-bold text-white">No database storage</div><p className="mt-1 text-xs leading-5 text-white/50">The converted file is temporarily held on the app server only while it is being downloaded. NEXUS does not save media, conversion output or download history in either database.</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/[.03] p-4"><div className="text-xs font-bold text-white">Use responsibly</div><p className="mt-1 text-xs leading-5 text-white/50">Only convert content you own or are authorised to download. Respect copyright and YouTube's terms.</p></div>
        </div>
      </div>
    </Layout>
  );
}
