import { useEffect, useState } from "react";
import { X, Expand, Image as ImageIcon, Film, Loader2 } from "lucide-react";
import { apiUrl } from "@/lib/api-url";
import { NexusAudioPlayer } from "@/components/NexusAudioPlayer";

type Props = { messageId: number; mediaType?: string | null };

export function ChatMediaAttachment({ messageId, mediaType }: Props) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const kind = (mediaType || "").toLowerCase();
  const isAudio = kind.startsWith("audio");
  const isVideo = kind === "video" || kind.startsWith("video/");
  const isImage = kind === "image" || kind.startsWith("image/");

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(apiUrl(`/api/chat/messages/${messageId}/media`), { credentials: "include" })
      .then(async response => {
        if (!response.ok) throw new Error("Attachment unavailable");
        const data = await response.json();
        if (typeof data.mediaUrl !== "string" || !(data.mediaUrl.startsWith("data:") || data.mediaUrl.startsWith("https://"))) throw new Error("Unsupported attachment");
        if (active) setSrc(data.mediaUrl);
      })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Could not load attachment"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [messageId]);

  if (loading) return <div className="mt-2 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/45"><Loader2 size={14} className="animate-spin"/> Loading attachment…</div>;
  if (error || !src) return <p className="mt-2 text-xs text-rose-300">{error || "Attachment unavailable"}</p>;
  if (isAudio) return <div className="mt-2"><NexusAudioPlayer src={src} nexusFormat={kind.includes("namaf1")} title={kind.includes("namaf1") ? "NEXUS voice message" : "Audio attachment"}/></div>;

  return <>
    <button type="button" onClick={() => setOpen(true)} className="group relative mt-2 block max-w-full overflow-hidden rounded-xl border border-white/10 bg-black/25 text-left">
      {isVideo ? <video src={src} preload="metadata" className="max-h-64 max-w-full" /> : isImage ? <img src={src} alt="Chat attachment" loading="lazy" className="max-h-72 max-w-full object-contain"/> : <span className="flex items-center gap-2 p-3 text-xs text-white/60"><ImageIcon size={16}/> Open attachment</span>}
      <span className="absolute bottom-2 right-2 rounded-lg bg-black/65 p-2 text-white opacity-80"><Expand size={14}/></span>
    </button>
    {open && <div role="dialog" aria-modal="true" aria-label={isVideo ? "Video viewer" : "Image viewer"} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-3 backdrop-blur-xl" onClick={() => setOpen(false)}>
      <button type="button" aria-label="Close viewer" onClick={() => setOpen(false)} className="absolute right-4 top-4 z-10 rounded-full border border-white/20 bg-white/10 p-3 text-white"><X size={20}/></button>
      <div className="flex max-h-full max-w-full items-center justify-center" onClick={event => event.stopPropagation()}>
        {isVideo ? <video src={src} controls autoPlay playsInline className="max-h-[90vh] max-w-[94vw] rounded-xl shadow-2xl"/> : <img src={src} alt="Expanded chat attachment" className="max-h-[90vh] max-w-[94vw] rounded-xl object-contain shadow-2xl"/>}
      </div>
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs text-white/70">{isVideo ? <Film size={14}/> : <ImageIcon size={14}/>} {isVideo ? "NEXUS video viewer" : "NEXUS image viewer"} · click outside to close</div>
    </div>}
  </>;
}
