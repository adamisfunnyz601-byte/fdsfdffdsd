import { useEffect, useMemo, useRef, useState } from "react";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/hooks/use-auth";
import { useChat } from "@/hooks/use-chat";
import { Avatar } from "@/components/ProfileModal";
import { ChatMediaAttachment } from "@/components/ChatMediaAttachment";
import { NexusCallPanel } from "@/components/NexusCallPanel";
import { Search, Send, MessageCircle, Users, Loader2, Paperclip, Mic, Square } from "lucide-react";

type ChatUser = { id:number; username:string; displayName?:string|null; avatarUrl?:string|null; presenceStatus?:string|null };
type ChatMessage = { id:number; senderId:number; content:string; createdAt:string; senderName?:string; senderDisplayName?:string|null; senderAvatarUrl?:string|null; hasMedia?:boolean; mediaType?:string|null };

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read this file."));
    reader.onerror = () => reject(new Error("Could not read this file."));
    reader.readAsDataURL(file);
  });
}

async function normalizeNexusAudioFile(file: File): Promise<File> {
  if (!file.name.toLowerCase().endsWith(".namaf1") || file.type.startsWith("audio/")) return file;
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = (start:number,end:number) => String.fromCharCode(...bytes.slice(start,end));
  let mime = "";
  if (ascii(0,4) === "RIFF") mime = "audio/wav";
  else if (ascii(0,4) === "OggS") mime = "audio/ogg";
  else if (ascii(0,4) === "fLaC") mime = "audio/flac";
  else if (ascii(0,3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) mime = "audio/mpeg";
  else if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) mime = "audio/webm";
  else if (ascii(4,8) === "ftyp") mime = "audio/mp4";
  else if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) mime = "audio/aac";
  if (!mime) throw new Error("This .namaf1 file does not contain a recognised standard audio stream.");
  return new File([file], file.name, { type: mime });
}

export default function Chat() {
  const { user } = useAuth();
  const [selectedId,setSelectedId] = useState<number|null>(null);
  const [draft,setDraft] = useState("");
  const [search,setSearch] = useState("");
  const [recording,setRecording] = useState(false);
  const [attachmentBusy,setAttachmentBusy] = useState(false);
  const recorderRef = useRef<MediaRecorder|null>(null);
  const streamRef = useRef<MediaStream|null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { users, messages, isLoadingUsers, isLoadingMessages, sendMessage } = useChat({ recipientId:selectedId });
  const people = useMemo(() => ((users || []) as ChatUser[]).filter(person => person.id !== user?.id),[users,user?.id]);
  const selected = people.find(person => person.id === selectedId) || null;
  const rows = (messages || []) as ChatMessage[];

  useEffect(() => {
    if (selectedId === null && people.length) setSelectedId(people[0].id);
    if (selectedId !== null && !people.some(person => person.id === selectedId)) setSelectedId(people[0]?.id ?? null);
  },[people,selectedId]);

  useEffect(() => () => {
    recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  const filtered = people.filter(person => `${person.displayName || person.username} ${person.username}`.toLowerCase().includes(search.toLowerCase()));
  const submit = (event:React.FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !selectedId || sendMessage.isPending) return;
    sendMessage.mutate({content,recipientId:selectedId},{onSuccess:()=>setDraft("")});
  };

  const sendAttachment = async (file: File, voice = false) => {
    if (!selectedId) return;
    if (file.size > 8 * 1024 * 1024) {
      window.alert("Attachments must be 8 MB or smaller.");
      return;
    }
    setAttachmentBusy(true);
    try {
      const preparedFile = await normalizeNexusAudioFile(file);
      const dataUrl = await readAsDataUrl(preparedFile);
      const mediaType = voice || preparedFile.name.toLowerCase().endsWith(".namaf1") ? "audio/namaf1" : preparedFile.type.startsWith("image/") ? "image" : preparedFile.type.startsWith("video/") ? "video" : "audio";
      sendMessage.mutate({ content: "", recipientId: selectedId, mediaUrl: dataUrl, mediaType });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not attach this file.");
    } finally { setAttachmentBusy(false); }
  };

  const startRecording = async () => {
    if (!selectedId || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      window.alert("Voice recording is not supported by this device or browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const preferred = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        if (blob.size) {
          const extension = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
          await sendAttachment(new File([blob], `nexus-voice-message.${extension}`, { type: (blob.type.split(";")[0] || "audio/webm") }), true);
        }
      };
      recorderRef.current = recorder;
      recorder.start(250);
      setRecording(true);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Microphone permission was denied.");
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  return <Layout>
    <div className="nexus-page nexus-page-chat h-full p-2 sm:p-3"><div className="app-glass mx-auto flex h-full min-h-[480px] max-w-7xl overflow-hidden rounded-2xl">
      <aside className="flex w-full max-w-[280px] shrink-0 flex-col border-r border-white/10 bg-white/[0.035] backdrop-blur-xl max-sm:max-w-[92px]">
        <div className="border-b border-white/10 p-4 max-sm:px-2">
          <div className="flex items-center gap-2 text-sm font-bold text-white"><MessageCircle size={18}/> <span className="max-sm:hidden">Direct messages</span></div>
          <div className="relative mt-4 max-sm:hidden"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Find a conversation" className="w-full rounded-lg border border-white/10 bg-black/20 backdrop-blur-xl py-2 pl-9 pr-3 text-xs text-white outline-none focus:border-violet-400/60"/></div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <div className="px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-white/35 max-sm:hidden">Messages</div>
          {isLoadingUsers?<div className="p-4 text-center text-white/40"><Loader2 className="mx-auto animate-spin"/></div>:filtered.map(person=><button key={person.id} onClick={()=>setSelectedId(person.id)} className={`mb-1 flex w-full items-center gap-3 rounded-lg p-2 text-left transition hover:bg-white/5 ${selectedId===person.id?"bg-violet-500/20 text-white":"text-white/65"}`}>
            <span className="relative shrink-0"><Avatar url={person.avatarUrl} name={person.displayName||person.username} size={38}/><i className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[#1e202b] ${person.presenceStatus==="online"?"bg-emerald-400":"bg-slate-500"}`}/></span>
            <span className="min-w-0 max-sm:hidden"><span className="block truncate text-sm font-semibold">{person.displayName||person.username}</span><span className="block truncate text-[11px] text-white/35">@{person.username}</span></span>
          </button>)}
          {!isLoadingUsers&&!filtered.length&&<p className="px-3 py-5 text-center text-xs text-white/35 max-sm:hidden">No people found yet.</p>}
        </div>
        <div className="border-t border-white/10 p-3 text-[10px] text-white/35 max-sm:hidden"><Users size={13} className="mr-1 inline"/> {people.length} people</div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col bg-white/[0.025] backdrop-blur-xl">
        {selected?<>
          <header className="flex h-[68px] shrink-0 items-center gap-3 border-b border-black/10 px-5 shadow-sm">
            <Avatar url={selected.avatarUrl} name={selected.displayName||selected.username} size={38}/>
            <div className="min-w-0"><div className="truncate font-bold text-white">{selected.displayName||selected.username}</div><div className="text-[11px] text-white/45">@{selected.username}</div></div>
            <NexusCallPanel targetId={selected.id} targetName={selected.displayName||selected.username}/>
          </header>
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-6">
            {isLoadingMessages?<div className="flex justify-center py-10 text-white/45"><Loader2 className="animate-spin"/></div>:rows.length?rows.map(message=><article key={message.id} className="flex gap-3">
              <Avatar url={message.senderAvatarUrl} name={message.senderDisplayName||message.senderName||"?"} size={36}/>
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline gap-2"><span className="text-sm font-semibold text-white">{message.senderDisplayName||message.senderName||"User"}</span><time className="text-[10px] text-white/35">{message.createdAt?new Date(message.createdAt).toLocaleString(): ""}</time></div>{message.content&&<p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-white/85">{message.content}</p>}{message.hasMedia&&<ChatMediaAttachment messageId={message.id} mediaType={message.mediaType}/>}</div>
            </article>):<div className="flex h-full flex-col items-center justify-center text-center text-white/45"><MessageCircle size={38} className="mb-3 opacity-40"/><p className="font-semibold text-white/70">This is the beginning</p><p className="mt-1 text-xs">Send a message to {selected.displayName||selected.username}.</p></div>}
          </div>
          <form onSubmit={submit} className="m-4 flex items-center gap-2 app-glass rounded-xl p-2">
            <input ref={undefined} value={draft} onChange={e=>setDraft(e.target.value)} maxLength={2000} placeholder={`Message @${selected.username}`} className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-white/35"/>
            <input ref={fileInputRef} type="file" accept=".namaf1,image/*,video/*,audio/*" className="hidden" onChange={event=>{const file=event.target.files?.[0];if(file)void sendAttachment(file);event.target.value="";}}/>
            <button type="button" disabled={attachmentBusy||sendMessage.isPending} onClick={()=>fileInputRef.current?.click()} aria-label="Attach image, video or audio" title="Attach media" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/70 disabled:opacity-40"><Paperclip size={17}/></button>
            <button type="button" disabled={recording||attachmentBusy||sendMessage.isPending} onClick={()=>void startRecording()} aria-label="Record voice message" title="Record voice message" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/70 disabled:opacity-40"><Mic size={17}/></button>
            {recording&&<button type="button" onClick={stopRecording} aria-label="Stop and send voice message" title="Stop and send voice message" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-rose-500/20 text-rose-200"><Square size={15}/></button>}
            <button type="submit" disabled={!draft.trim()||sendMessage.isPending} aria-label="Send message" className="grid h-10 w-10 shrink-0 place-items-center nexus-btn nexus-btn--glow rounded-lg p-0 text-white disabled:opacity-40"><Send size={17}/></button>
          </form>
          {(attachmentBusy||recording)&&<div className="px-5 pb-2 text-[11px] text-violet-200/70">{recording?"Recording voice message — press stop to send.": "Preparing attachment…"}</div>}
        </>:<div className="flex flex-1 flex-col items-center justify-center text-center text-white/45"><MessageCircle size={42} className="mb-3 opacity-40"/><p className="font-semibold text-white/70">Your messages</p><p className="mt-1 text-xs">Choose someone to start chatting.</p></div>}
      </section>
    </div></div>
  </Layout>;
}
