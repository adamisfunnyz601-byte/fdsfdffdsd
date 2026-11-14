import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Pause, Play, Volume2 } from "lucide-react";

type Props = { src: string; title?: string; nexusFormat?: boolean };

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const seconds = Math.floor(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function extensionFor(src: string) {
  const mime = src.match(/^data:([^;,]+)/i)?.[1]?.toLowerCase() || "";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("mp4") || mime.includes("aac")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("flac")) return "flac";
  if (mime.includes("webm")) return "webm";
  return "audio";
}

export function NexusAudioPlayer({ src, title = "Audio message", nexusFormat = false }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const animationRef = useRef<number>(0);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const bars = useMemo(() => Array.from({ length: 44 }, (_, index) => {
    const wave = Math.abs(Math.sin(index * 1.73) * Math.cos(index * 0.39));
    return 18 + Math.round(wave * 82);
  }), []);
  const progress = duration ? current / duration : 0;
  const [liveBars, setLiveBars] = useState<number[] | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const update = () => setCurrent(audio.currentTime || 0);
    const metadata = () => setDuration(audio.duration || 0);
    const ended = () => setPlaying(false);
    audio.addEventListener("timeupdate", update);
    audio.addEventListener("loadedmetadata", metadata);
    audio.addEventListener("durationchange", metadata);
    audio.addEventListener("ended", ended);
    return () => {
      audio.removeEventListener("timeupdate", update);
      audio.removeEventListener("loadedmetadata", metadata);
      audio.removeEventListener("durationchange", metadata);
      audio.removeEventListener("ended", ended);
    };
  }, [src]);

  useEffect(() => () => {
    cancelAnimationFrame(animationRef.current);
    sourceRef.current?.disconnect();
    void audioContextRef.current?.close();
  }, []);

  const animateSpectrum = () => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const values = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(values);
    const next = Array.from({ length: 44 }, (_, index) => {
      const bucket = Math.min(values.length - 1, Math.floor((index / 44) * values.length));
      return 12 + Math.round((values[bucket] / 255) * 88);
    });
    setLiveBars(next);
    animationRef.current = requestAnimationFrame(animateSpectrum);
  };

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try { await audio.play(); setPlaying(true); } catch { setPlaying(false); }
    } else { audio.pause(); setPlaying(false); cancelAnimationFrame(animationRef.current); setLiveBars(null); }
  };

  const seek = (value: number) => {
    const audio = audioRef.current;
    if (audio && duration) { audio.currentTime = value; setCurrent(value); }
  };

  return (
    <div className="nexus-audio-player app-glass w-full max-w-xl rounded-2xl border border-white/10 p-3">
      <audio ref={audioRef} src={src} preload="metadata" crossOrigin="anonymous" />
      <div className="flex items-center gap-3">
        <button type="button" onClick={toggle} aria-label={playing ? "Pause audio" : "Play audio"} className="nexus-btn nexus-btn--glow grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white">
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="truncate text-xs font-semibold text-white">{title}</span>
            <span className="shrink-0 text-[10px] tabular-nums text-white/45">{formatTime(current)} / {formatTime(duration)}</span>
          </div>
          <button type="button" aria-label="Seek audio" onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            seek(Math.max(0, Math.min(duration, ((event.clientX - rect.left) / rect.width) * duration)));
          }} className="flex h-9 w-full items-center gap-[3px] overflow-hidden rounded-md px-0.5">
            {bars.map((height, index) => { const shownHeight = liveBars?.[index] ?? height; return <span key={index} className="min-w-0 flex-1 rounded-full transition-colors" style={{ height: `${shownHeight}%`, background: index / bars.length <= progress ? "linear-gradient(180deg,#c4b5fd,#7c3aed)" : "rgba(255,255,255,.17)" }} />; })}
          </button>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 border-t border-white/10 pt-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-white/45"><Volume2 size={13}/><input aria-label="Audio volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={event => { const next = Number(event.target.value); setVolume(next); if (audioRef.current) audioRef.current.volume = next; }} className="h-1 w-24 accent-violet-400"/></label>
        <div className="flex gap-2">
          {nexusFormat && <a href={src} download="voice-message.namaf1" title="Download NEXUS audio message" className="inline-flex items-center gap-1 rounded-lg border border-violet-400/25 bg-violet-400/10 px-2 py-1 text-[10px] text-violet-100"><Download size={12}/> .namaf1</a>}
          <a href={src} download={`audio-message.${extensionFor(src)}`} title="Download in its standard audio format" className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white/65"><Download size={12}/> Audio file</a>
        </div>
      </div>
    </div>
  );
}
