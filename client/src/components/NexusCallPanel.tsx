import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl } from "@/lib/api-url";
import { getRtcConfiguration } from "@/lib/webrtc";
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, MonitorUp, X } from "@/components/ManagedIcons";

type IncomingCall = { callId:string; fromId:number; fromName:string; withVideo:boolean };
type ActiveCall = { callId:string; peerId:number; peerName:string; withVideo:boolean; direction:"incoming"|"outgoing" };
type Signal = { type:string; callId:string; fromId?:number; from?:number; fromName?:string; offer?:RTCSessionDescriptionInit; answer?:RTCSessionDescriptionInit; candidate?:RTCIceCandidateInit; withVideo?:boolean };
type Props = { targetId:number|null; targetName:string };

async function post(path:string, body:Record<string,unknown>) {
  const response = await fetch(apiUrl(path), { method:"POST", credentials:"include", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.message || "Call request failed");
  return data;
}

function AudioMeter({stream}:{stream:MediaStream|null}) {
  const [level,setLevel]=useState(0);
  useEffect(()=>{
    if(!stream)return;
    let context:AudioContext|undefined;let frame=0;let source:MediaStreamAudioSourceNode|undefined;let analyser:AnalyserNode|undefined;
    try{
      context=new AudioContext();void context.resume();analyser=context.createAnalyser();analyser.fftSize=128;
      source=context.createMediaStreamSource(stream);source.connect(analyser);
      const data=new Uint8Array(analyser.frequencyBinCount);
      const draw=()=>{if(!analyser)return;analyser.getByteFrequencyData(data);let sum=0;for(const value of data)sum+=value;setLevel(Math.min(1,sum/(data.length*255)));frame=requestAnimationFrame(draw);};
      draw();
    }catch{setLevel(0);}
    return()=>{cancelAnimationFrame(frame);source?.disconnect();void context?.close();setLevel(0);};
  },[stream]);
  return <div className="flex h-8 items-center justify-center gap-1" aria-label="Call audio level">{Array.from({length:18},(_,i)=><span key={i} className="w-1 rounded-full bg-gradient-to-t from-violet-600 to-cyan-300 transition-all duration-75" style={{height:`${5+Math.max(0,level*26-Math.abs(i-8.5)*1.8)}px`,opacity:.35+level*.65}}/>)}</div>;
}

export function NexusCallPanel({targetId,targetName}:Props) {
  const [incoming,setIncoming]=useState<IncomingCall|null>(null);
  const [call,setCall]=useState<ActiveCall|null>(null);
  const [status,setStatus]=useState("");
  const [error,setError]=useState("");
  const [localStream,setLocalStream]=useState<MediaStream|null>(null);
  const [remoteStream,setRemoteStream]=useState<MediaStream|null>(null);
  const [muted,setMuted]=useState(false);
  const [cameraOff,setCameraOff]=useState(false);
  const [sharing,setSharing]=useState(false);
  const pcRef=useRef<RTCPeerConnection|null>(null);
  const localRef=useRef<MediaStream|null>(null);
  const screenRef=useRef<MediaStream|null>(null);
  const callRef=useRef<ActiveCall|null>(null);
  const remoteVideoRef=useRef<HTMLVideoElement>(null);
  const pollingRef=useRef(false);

  const cleanup=useCallback(()=>{
    pcRef.current?.close();pcRef.current=null;
    localRef.current?.getTracks().forEach(track=>track.stop());localRef.current=null;
    screenRef.current?.getTracks().forEach(track=>track.stop());screenRef.current=null;
    setLocalStream(null);setRemoteStream(null);setSharing(false);setMuted(false);setCameraOff(false);
    callRef.current=null;setCall(null);setStatus("");
  },[]);

  useEffect(()=>{
    if(!call || status==="Connected")return;
    const timer=window.setTimeout(()=>{
      const active=callRef.current;
      if(active){void post("/api/chat/voice/end",{callId:active.callId}).catch(()=>{});cleanup();setError("No answer — the call was ended.");}
    },45000);
    return()=>window.clearTimeout(timer);
  },[call?.callId,status,cleanup]);

  useEffect(()=>{
    const video=remoteVideoRef.current;
    if(video){video.srcObject=remoteStream;void video.play().catch(()=>{});}
  },[remoteStream,call]);

  // Audible website ringtone while the incoming-call card is waiting for an answer.
  useEffect(()=>{
    if(!incoming)return;
    let context:AudioContext|undefined;
    const ring=()=>{
      try{
        context ||= new AudioContext();
        if(context.state==="suspended")void context.resume();
        const oscillator=context.createOscillator(),gain=context.createGain();
        oscillator.type="sine";oscillator.frequency.setValueAtTime(880,context.currentTime);oscillator.frequency.setValueAtTime(660,context.currentTime+.22);
        gain.gain.setValueAtTime(.0001,context.currentTime);gain.gain.exponentialRampToValueAtTime(.1,context.currentTime+.025);gain.gain.exponentialRampToValueAtTime(.0001,context.currentTime+.48);
        oscillator.connect(gain);gain.connect(context.destination);oscillator.start();oscillator.stop(context.currentTime+.5);
      }catch{}
    };
    ring();const timer=window.setInterval(ring,1100);
    return()=>{window.clearInterval(timer);void context?.close();};
  },[incoming?.callId]);

  const createPeer=useCallback(async(active:ActiveCall,stream:MediaStream)=>{
    const pc=new RTCPeerConnection(await getRtcConfiguration());
    pcRef.current=pc;
    stream.getTracks().forEach(track=>pc.addTrack(track,stream));
    pc.ontrack=event=>setRemoteStream(event.streams[0]||new MediaStream([event.track]));
    pc.onicecandidate=event=>{
      if(event.candidate)post("/api/chat/voice/ice",{callId:active.callId,recipientId:active.peerId,candidate:event.candidate.toJSON()}).catch(cause=>setError(cause.message));
    };
    pc.onconnectionstatechange=()=>{
      if(pc.connectionState==="connected")setStatus("Connected");
      if(pc.connectionState==="failed")setError("The connection failed. Check the network or configure a TURN relay.");
    };
    return pc;
  },[]);

  const acquireMedia=useCallback(async(withVideo:boolean)=>{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error("Microphone and camera access are not available in this app.");
    const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:withVideo});
    localRef.current=stream;setLocalStream(stream);return stream;
  },[]);

  const makeOffer=useCallback(async(active:ActiveCall,pc:RTCPeerConnection)=>{
    const offer=await pc.createOffer();await pc.setLocalDescription(offer);
    await post("/api/chat/voice/offer",{callId:active.callId,recipientId:active.peerId,offer:pc.localDescription});
  },[]);

  const handleSignal=useCallback(async(signal:Signal)=>{
    if(signal.type==="incoming"){
      if(!callRef.current)setIncoming({callId:signal.callId,fromId:Number(signal.fromId),fromName:signal.fromName||"NEXUS user",withVideo:Boolean(signal.withVideo)});
      return;
    }
    const active=callRef.current;
    if(!active||active.callId!==signal.callId)return;
    const pc=pcRef.current;
    if(signal.type==="accepted"&&active.direction==="outgoing"&&!pc){
      try{setStatus("Connecting…");const stream=await acquireMedia(active.withVideo);const peer=await createPeer(active,stream);await makeOffer(active,peer);}
      catch(cause){setError(cause instanceof Error?cause.message:"Could not start the call.");void post("/api/chat/voice/end",{callId:active.callId}).catch(()=>{});cleanup();}
    }else if(signal.type==="offer"&&pc&&signal.offer){
      try{await pc.setRemoteDescription(new RTCSessionDescription(signal.offer));const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await post("/api/chat/voice/answer",{callId:active.callId,recipientId:active.peerId,answer:pc.localDescription});}
      catch(cause){setError(cause instanceof Error?cause.message:"Could not answer the call.");}
    }else if(signal.type==="answer"&&pc&&signal.answer){
      await pc.setRemoteDescription(new RTCSessionDescription(signal.answer)).catch(cause=>setError(cause.message));
    }else if(signal.type==="ice"&&pc&&signal.candidate){
      await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(()=>{});
    }else if(signal.type==="ended"||signal.type==="declined"){
      setStatus(signal.type==="declined"?"Call declined":"Call ended");cleanup();
    }
  },[acquireMedia,cleanup,createPeer,makeOffer]);

  useEffect(()=>{
    let active=true;
    const poll=async()=>{
      if(pollingRef.current)return;pollingRef.current=true;
      try{
        const response=await fetch(apiUrl("/api/chat/voice/poll"),{credentials:"include",cache:"no-store"});
        if(response.ok){const signals:Signal[]=await response.json();for(const signal of signals){if(!active)break;await handleSignal(signal);}}
      }catch{}finally{pollingRef.current=false;}
    };
    void poll();const timer=window.setInterval(poll,1100);
    return()=>{active=false;window.clearInterval(timer);};
  },[handleSignal]);

  const startCall=async(withVideo:boolean)=>{
    if(!targetId||callRef.current)return;
    setError("");setStatus("Calling…");
    try{
      const data=await post("/api/chat/voice/start",{calleeId:targetId,withVideo});
      const active:ActiveCall={callId:data.callId,peerId:targetId,peerName:targetName,withVideo,direction:"outgoing"};
      callRef.current=active;setCall(active);
    }catch(cause){setStatus("");setError(cause instanceof Error?cause.message:"Could not start the call.");}
  };

  const acceptCall=async()=>{
    if(!incoming)return;
    setError("");
    const active:ActiveCall={callId:incoming.callId,peerId:incoming.fromId,peerName:incoming.fromName,withVideo:incoming.withVideo,direction:"incoming"};
    try{
      const stream=await acquireMedia(active.withVideo);
      await createPeer(active,stream);
      callRef.current=active;setCall(active);setIncoming(null);setStatus("Connecting…");
      await post("/api/chat/voice/accept",{callId:active.callId});
    }catch(cause){setError(cause instanceof Error?cause.message:"Could not accept the call.");cleanup();}
  };

  const hangup=async()=>{
    const active=callRef.current;
    if(active)await post("/api/chat/voice/end",{callId:active.callId}).catch(()=>{});
    cleanup();
  };

  const toggleMute=()=>{const next=!muted;localRef.current?.getAudioTracks().forEach(track=>track.enabled=!next);setMuted(next);};
  const toggleCamera=()=>{const next=!cameraOff;localRef.current?.getVideoTracks().forEach(track=>track.enabled=!next);setCameraOff(next);};

  const shareScreen=async()=>{
    const active=callRef.current;const pc=pcRef.current;
    if(!active||!pc)return;
    if(!navigator.mediaDevices?.getDisplayMedia){setError("Screen sharing is not supported by this app build.");return;}
    try{
      const screen=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
      screenRef.current=screen;const track=screen.getVideoTracks()[0];
      let sender=pc.getSenders().find(item=>item.track?.kind==="video");
      const cameraTrack=localRef.current?.getVideoTracks()[0];
      if(sender)await sender.replaceTrack(track);else sender=pc.addTrack(track,screen);
      setSharing(true);
      track.onended=()=>{
        setSharing(false);screenRef.current?.getTracks().forEach(item=>item.stop());screenRef.current=null;
        if(sender&&cameraTrack)void sender.replaceTrack(cameraTrack);
        else if(sender){pc.removeTrack(sender);void makeOffer(active,pc).catch(cause=>setError(cause.message));}
      };
      if(!cameraTrack)await makeOffer(active,pc);
    }catch(cause){setError(cause instanceof Error?cause.message:"Screen sharing was cancelled.");}
  };

  useEffect(()=>()=>{const active=callRef.current;if(active)void post("/api/chat/voice/end",{callId:active.callId}).catch(()=>{});cleanup();},[cleanup]);

  return <>
    <div className="ml-auto flex items-center gap-2">
      <button type="button" disabled={!targetId||!!call} onClick={()=>void startCall(false)} title="Start voice call" aria-label="Start voice call" className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-white/70 hover:bg-violet-500/20 disabled:opacity-30"><Phone size={16}/></button>
      <button type="button" disabled={!targetId||!!call} onClick={()=>void startCall(true)} title="Start video call" aria-label="Start video call" className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-white/70 hover:bg-violet-500/20 disabled:opacity-30"><Video size={16}/></button>
    </div>
    {incoming&&<div className="fixed bottom-5 right-5 z-[90] w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-violet-300/25 bg-[#151321]/95 p-4 text-white shadow-2xl backdrop-blur-2xl">
      <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-full bg-violet-500/20"><Phone size={18}/></span><div className="min-w-0 flex-1"><p className="font-semibold">{incoming.fromName}</p><p className="text-xs text-white/55">Incoming {incoming.withVideo?"video":"voice"} call</p></div><button type="button" onClick={()=>{void post("/api/chat/voice/decline",{callId:incoming.callId}).catch(()=>{});setIncoming(null);}} aria-label="Decline call" className="text-white/45"><X size={16}/></button></div>
      <div className="mt-4 flex gap-2"><button type="button" onClick={()=>void acceptCall()} className="nexus-btn nexus-btn--glow flex flex-1 items-center justify-center gap-2 rounded-xl py-2 text-sm"><Phone size={15}/> Accept</button><button type="button" onClick={()=>{void post("/api/chat/voice/decline",{callId:incoming.callId}).catch(()=>{});setIncoming(null);}} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-rose-400/25 bg-rose-500/15 py-2 text-sm text-rose-200"><PhoneOff size={15}/> Decline</button></div>
    </div>}
    {call&&<div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-3 backdrop-blur-lg">
      <section className="app-glass w-full max-w-3xl rounded-3xl border border-white/15 p-4 text-white shadow-2xl sm:p-6">
        <header className="flex items-center justify-between gap-3"><div><p className="text-lg font-bold">{call.peerName}</p><p className="text-xs text-white/50">{status||"Connecting…"}</p></div><button type="button" onClick={()=>void hangup()} aria-label="Close call" className="rounded-xl border border-white/10 bg-white/5 p-2 text-white/60"><X size={17}/></button></header>
        <div className="relative mt-4 grid min-h-[260px] grid-cols-1 gap-3 overflow-hidden rounded-2xl bg-black/35 p-3 sm:grid-cols-2">
          <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-white/10 bg-white/[0.035]">
            <video ref={remoteVideoRef} autoPlay muted playsInline className="h-full max-h-[360px] w-full rounded-xl object-cover"/>
            <audio autoPlay playsInline ref={element=>{if(element&&element.srcObject!==remoteStream){element.srcObject=remoteStream;void element.play().catch(()=>{});}}} className="hidden"/>
            {!remoteStream&&<><div className="mb-2 grid h-20 w-20 place-items-center rounded-full bg-violet-500/20 text-2xl font-bold">{call.peerName.slice(0,1).toUpperCase()}</div><p className="text-sm text-white/60">Waiting for {call.peerName}…</p></>}
            <AudioMeter stream={remoteStream}/>
          </div>
          <div className="flex min-h-[180px] flex-col items-center justify-center rounded-xl border border-white/10 bg-white/[0.035]">
            <div className="mb-2 grid h-16 w-16 place-items-center rounded-full bg-cyan-500/15 text-xl font-bold">N</div><p className="text-sm text-white/65">You</p><AudioMeter stream={localStream}/>
            {localStream?.getVideoTracks().length ? <video autoPlay muted playsInline ref={element=>{if(element&&element.srcObject!==localStream)element.srcObject=localStream;}} className="mt-2 max-h-28 w-40 rounded-lg object-cover"/> : null}
          </div>
        </div>
        {error&&<p role="alert" className="mt-3 rounded-lg border border-rose-400/20 bg-rose-500/10 p-2 text-xs text-rose-200">{error}</p>}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button type="button" onClick={toggleMute} className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/5">{muted?<MicOff size={18}/>:<Mic size={18}/>}</button>
          <button type="button" onClick={toggleCamera} disabled={!call.withVideo} className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/5 disabled:opacity-30">{cameraOff?<VideoOff size={18}/>:<Video size={18}/>}</button>
          <button type="button" onClick={()=>void shareScreen()} disabled={!call||!pcRef.current} className="flex h-11 items-center gap-2 rounded-xl border border-violet-300/20 bg-violet-500/15 px-4 text-sm disabled:opacity-30"><MonitorUp size={17}/>{sharing?"Sharing":"Share screen"}</button>
          <button type="button" onClick={()=>void hangup()} className="grid h-11 w-14 place-items-center rounded-xl bg-rose-600 text-white shadow-lg shadow-rose-950/40"><PhoneOff size={18}/></button>
        </div>
        <p className="mt-3 text-center text-[10px] text-white/35">Peer-to-peer WebRTC · A TURN relay may be required on restrictive networks.</p>
      </section>
    </div>}
    {error&&!call&&!incoming&&<div role="alert" className="fixed bottom-5 right-5 z-[90] max-w-sm rounded-xl border border-rose-400/20 bg-[#21131b]/95 p-3 text-xs text-rose-100 shadow-xl backdrop-blur-xl">{error}</div>}
  </>;
}
