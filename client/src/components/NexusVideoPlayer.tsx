import { useEffect, useRef, useState } from "react";
import { Download, Pause, Play, Volume2, Maximize } from "@/components/ManagedIcons";

type Props = { src: string; title?: string };

function timeLabel(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const n = Math.floor(value);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

export function NexusVideoPlayer({ src, title = "NEXUS video" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setPlaying(false); setCurrent(0); setDuration(0); setError("");
    const video = videoRef.current;
    if (!video) return;
    video.pause(); video.currentTime = 0;
  }, [src]);

  const toggle = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      try { await video.play(); setPlaying(true); setError(""); }
      catch { setError("Playback could not start. Try opening or saving the video."); }
    } else { video.pause(); setPlaying(false); }
  };

  const seek = (value: number) => {
    const video = videoRef.current;
    if (video) { video.currentTime = value; setCurrent(value); }
  };

  return <div className="nexus-video-player mt-2 w-full max-w-3xl overflow-hidden rounded-2xl border border-violet-300/20 bg-[#080611] shadow-[0_18px_70px_rgba(0,0,0,.4)]">
    <div className="relative flex max-h-[min(65vh,560px)] min-h-40 items-center justify-center bg-black">
      <video ref={videoRef} src={src} preload="metadata" playsInline className="max-h-[min(65vh,560px)] w-full object-contain"
        onTimeUpdate={event=>setCurrent(event.currentTarget.currentTime||0)}
        onLoadedMetadata={event=>setDuration(Number.isFinite(event.currentTarget.duration)?event.currentTarget.duration:0)}
        onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)}
        onError={()=>setError("This video format could not be played in your browser.")}/>
      {!playing&&<button type="button" onClick={()=>void toggle()} aria-label="Play video" className="absolute grid h-16 w-16 place-items-center rounded-full border border-white/30 bg-violet-600/80 text-white shadow-[0_0_40px_rgba(139,92,246,.45)] backdrop-blur-md transition hover:scale-105"><Play size={27}/></button>}
      <div className="absolute left-3 top-3 rounded-lg border border-white/10 bg-black/55 px-3 py-1.5 text-[11px] font-semibold text-white/80 backdrop-blur">{title}</div>
    </div>
    <div className="space-y-2 p-3">
      <input aria-label="Video timeline" type="range" min="0" max={Math.max(duration,0.01)} step="0.01" value={Math.min(current,duration||0)} onChange={event=>seek(Number(event.target.value))} className="h-1.5 w-full cursor-pointer accent-violet-400"/>
      <div className="flex items-center gap-3">
        <button type="button" onClick={()=>void toggle()} aria-label={playing?"Pause video":"Play video"} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/20 text-violet-100 hover:bg-violet-500/35">{playing?<Pause size={17}/>:<Play size={17}/>}</button>
        <span className="min-w-[82px] text-[11px] tabular-nums text-white/55">{timeLabel(current)} / {timeLabel(duration)}</span>
        <div className="flex min-w-0 flex-1 items-center gap-2"><button type="button" onClick={()=>{const next=!muted;setMuted(next);if(videoRef.current)videoRef.current.muted=next;}} aria-label={muted?"Unmute":"Mute"} className="text-white/60"><Volume2 size={16}/></button><input aria-label="Video volume" type="range" min="0" max="1" step="0.01" value={muted?0:volume} onChange={event=>{const next=Number(event.target.value);setVolume(next);setMuted(false);if(videoRef.current){videoRef.current.volume=next;videoRef.current.muted=false;}}} className="h-1 w-20 accent-violet-400"/></div>
        <button type="button" onClick={()=>{const video=videoRef.current as any;if(video?.requestFullscreen)void video.requestFullscreen();else if(video?.webkitEnterFullscreen)video.webkitEnterFullscreen();}} aria-label="Fullscreen" className="rounded-lg p-2 text-white/65 hover:bg-white/10"><Maximize size={16}/></button>
        <a href={src} download="nexus-video" className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-[10px] text-white/70 hover:bg-white/10"><Download size={13}/> Save</a>
      </div>
      {error&&<p role="status" className="text-xs text-rose-300">{error}</p>}
    </div>
  </div>;
}
