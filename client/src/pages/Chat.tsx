import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/hooks/use-auth";
import { useChat } from "@/hooks/use-chat";
import { Avatar } from "@/components/ProfileModal";
import { Search, Send, MessageCircle, Users, Loader2 } from "lucide-react";

type ChatUser = { id:number; username:string; displayName?:string|null; avatarUrl?:string|null; presenceStatus?:string|null };
type ChatMessage = { id:number; senderId:number; content:string; createdAt:string; senderName?:string; senderDisplayName?:string|null; senderAvatarUrl?:string|null };

export default function Chat() {
  const { user } = useAuth();
  const [selectedId,setSelectedId] = useState<number|null>(null);
  const [draft,setDraft] = useState("");
  const [search,setSearch] = useState("");
  const { users, messages, isLoadingUsers, isLoadingMessages, sendMessage } = useChat({ recipientId:selectedId });
  const people = useMemo(() => ((users || []) as ChatUser[]).filter(person => person.id !== user?.id),[users,user?.id]);
  const selected = people.find(person => person.id === selectedId) || null;
  const rows = (messages || []) as ChatMessage[];

  useEffect(() => {
    if (selectedId === null && people.length) setSelectedId(people[0].id);
    if (selectedId !== null && !people.some(person => person.id === selectedId)) setSelectedId(people[0]?.id ?? null);
  },[people,selectedId]);

  const filtered = people.filter(person => `${person.displayName || person.username} ${person.username}`.toLowerCase().includes(search.toLowerCase()));
  const submit = (event:React.FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !selectedId || sendMessage.isPending) return;
    sendMessage.mutate({content,recipientId:selectedId},{onSuccess:()=>setDraft("")});
  };

  return <Layout>
    <div className="mx-auto flex h-full min-h-[480px] max-w-7xl overflow-hidden rounded-2xl border border-white/10 bg-[#171923] shadow-2xl">
      <aside className="flex w-full max-w-[280px] shrink-0 flex-col border-r border-white/10 bg-[#1e202b] max-sm:max-w-[92px]">
        <div className="border-b border-white/10 p-4 max-sm:px-2">
          <div className="flex items-center gap-2 text-sm font-bold text-white"><MessageCircle size={18}/> <span className="max-sm:hidden">Direct messages</span></div>
          <div className="relative mt-4 max-sm:hidden"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Find a conversation" className="w-full rounded-lg border border-white/10 bg-black/20 py-2 pl-9 pr-3 text-xs text-white outline-none focus:border-violet-400/60"/></div>
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
      <section className="flex min-w-0 flex-1 flex-col bg-[#313440]">
        {selected?<>
          <header className="flex h-[68px] shrink-0 items-center gap-3 border-b border-black/10 px-5 shadow-sm">
            <Avatar url={selected.avatarUrl} name={selected.displayName||selected.username} size={38}/>
            <div className="min-w-0"><div className="truncate font-bold text-white">{selected.displayName||selected.username}</div><div className="text-[11px] text-white/45">@{selected.username}</div></div>
          </header>
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-6">
            {isLoadingMessages?<div className="flex justify-center py-10 text-white/45"><Loader2 className="animate-spin"/></div>:rows.length?rows.map(message=><article key={message.id} className="flex gap-3">
              <Avatar url={message.senderAvatarUrl} name={message.senderDisplayName||message.senderName||"?"} size={36}/>
              <div className="min-w-0"><div className="flex flex-wrap items-baseline gap-2"><span className="text-sm font-semibold text-white">{message.senderDisplayName||message.senderName||"User"}</span><time className="text-[10px] text-white/35">{message.createdAt?new Date(message.createdAt).toLocaleString(): ""}</time></div><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-white/85">{message.content}</p></div>
            </article>):<div className="flex h-full flex-col items-center justify-center text-center text-white/45"><MessageCircle size={38} className="mb-3 opacity-40"/><p className="font-semibold text-white/70">This is the beginning</p><p className="mt-1 text-xs">Send a message to {selected.displayName||selected.username}.</p></div>}
          </div>
          <form onSubmit={submit} className="m-4 flex items-center gap-2 rounded-xl bg-[#242631] p-2">
            <input value={draft} onChange={e=>setDraft(e.target.value)} maxLength={2000} placeholder={`Message @${selected.username}`} className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-white/35"/>
            <button type="submit" disabled={!draft.trim()||sendMessage.isPending} aria-label="Send message" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-violet-600 text-white transition hover:bg-violet-500 disabled:opacity-40"><Send size={17}/></button>
          </form>
        </>:<div className="flex flex-1 flex-col items-center justify-center text-center text-white/45"><MessageCircle size={42} className="mb-3 opacity-40"/><p className="font-semibold text-white/70">Your messages</p><p className="mt-1 text-xs">Choose someone to start chatting.</p></div>}
      </section>
    </div>
  </Layout>;
}
