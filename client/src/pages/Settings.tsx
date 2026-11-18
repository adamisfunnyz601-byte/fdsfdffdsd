import { useEffect, useState } from "react";
import { enableBrowserNotifications, showTestNotification, getNotificationSupport } from "@/lib/platform-notifications";
import { enableNativeNotifications, isNativeApp, nativePlatform, showNativeTestNotification } from "@/lib/native-notifications";
import { Bell, BellOff, Check, Circle, KeyRound, Moon, Settings as SettingsIcon, Trash2, Volume2 } from "lucide-react";
import { Layout } from "@/components/Layout";
import { CyberButton } from "@/components/CyberButton";
import { CyberInput } from "@/components/CyberInput";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { apiUrl } from "@/lib/api-url";
import { startRegistration } from "@simplewebauthn/browser";
import { NEXUS_FONTS, NEXUS_GRADIENTS, readNexusAppearance, saveNexusAppearance, type NexusFont, type NexusGradient } from "@/lib/appearance";

const statuses = [
  { id: "online", label: "Online", description: "You are available", color: "bg-green-400" },
  { id: "idle", label: "Idle", description: "Away from keyboard", color: "bg-yellow-400" },
  { id: "dnd", label: "Do Not Disturb", description: "Mute notification attention", color: "bg-red-400" },
  { id: "offline", label: "Invisible", description: "Appear offline to everyone", color: "bg-gray-500" },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState(user?.presenceStatus || "online");
  const [muteNotifications, setMuteNotifications] = useState(Boolean(user?.muteNotifications));
  const [muteEmotes, setMuteEmotes] = useState(Boolean((user as any)?.muteEmotes));
  const [muteNonFriendCalls, setMuteNonFriendCalls] = useState(Boolean((user as any)?.muteNonFriendCalls));
  const [dmFriendsOnly, setDmFriendsOnly] = useState(Boolean((user as any)?.dmFriendsOnly));
  const [ringtoneUrl, setRingtoneUrl] = useState(user?.ringtoneUrl || "");
  const [saving, setSaving] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeys, setPasskeys] = useState<Array<{ id: number; createdAt: string | null; transports: string[] }>>([]);
  const [passkeysLoading, setPasskeysLoading] = useState(false);
  const [deletingPasskeyId, setDeletingPasskeyId] = useState<number | null>(null);
  const [appleTeamId, setAppleTeamId] = useState(() => localStorage.getItem("nexus-apple-team-id") || "");
  const [teamIdSaved, setTeamIdSaved] = useState(false);
  const [appearance, setAppearance] = useState(readNexusAppearance);
  const [notificationState, setNotificationState] = useState(() => isNativeApp()
    ? { supported: true, permission: "default" as NotificationPermission, description: "Native operating-system notifications are available on this device." }
    : getNotificationSupport());
  const [notificationBusy, setNotificationBusy] = useState(false);
  const nativeApp = isNativeApp();

  useEffect(() => { saveNexusAppearance(appearance); }, []);

  const loadPasskeys = async () => {
    if (!user) return;
    setPasskeysLoading(true);
    try {
      const response = await fetch(apiUrl("/api/auth/passkeys"), { credentials: "include", cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not load your passkeys.");
      setPasskeys(Array.isArray(data.passkeys) ? data.passkeys : []);
    } catch (error: any) {
      toast({ title: "Could not load passkeys", description: error?.message || "Try refreshing Settings.", variant: "destructive" });
    } finally { setPasskeysLoading(false); }
  };

  useEffect(() => { void loadPasskeys(); }, [user?.id]);

  const deletePasskey = async (id: number) => {
    setDeletingPasskeyId(id);
    try {
      const response = await fetch(apiUrl("/api/auth/passkeys/" + id), { method: "DELETE", credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not remove this passkey.");
      setPasskeys(current => current.filter(item => item.id !== id));
      toast({ title: "Passkey removed", description: "This passkey can no longer sign in to your NEXUS account." });
    } catch (error: any) {
      toast({ title: "Could not remove passkey", description: error?.message || "Please try again.", variant: "destructive" });
    } finally { setDeletingPasskeyId(null); }
  };

  const registerPasskey = async () => {
    setPasskeyBusy(true);
    try {
      const optionsResponse = await fetch(apiUrl("/api/auth/passkeys/register/options"), { credentials: "include", method: "POST" });
      const options = await optionsResponse.json().catch(() => ({}));
      if (!optionsResponse.ok) throw new Error(options.message || "Could not start passkey setup.");
      const response = await startRegistration({ optionsJSON: options });
      const verifyResponse = await fetch(apiUrl("/api/auth/passkeys/register/verify"), {
        credentials: "include", method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      const result = await verifyResponse.json().catch(() => ({}));
      if (!verifyResponse.ok || !result.verified) throw new Error(result.message || "Passkey verification failed.");
      await loadPasskeys();
      toast({ title: "Passkey saved to your account", description: "NEXUS verified and stored this passkey. You can manage it below." });
    } catch (error: any) {
      toast({ title: "Passkey setup failed", description: error?.message || "This browser or device could not create a passkey.", variant: "destructive" });
    } finally { setPasskeyBusy(false); }
  };

  const enableNotifications = async () => {
    setNotificationBusy(true);
    try {
      if (nativeApp) {
        await enableNativeNotifications();
        toast({ title: "Native notification permission enabled", description: `The device registered with ${nativePlatform()} push services. NEXUS still needs its server push sender before messages can be delivered remotely.` });
      } else {
        await enableBrowserNotifications();
        setNotificationState(getNotificationSupport());
        toast({ title: "Browser notifications enabled", description: "This device can now display browser notifications." });
      }
    } catch (error: any) {
      toast({ title: "Notifications unavailable", description: error?.message || "Check your browser or device notification settings.", variant: "destructive" });
      setNotificationState(getNotificationSupport());
    } finally { setNotificationBusy(false); }
  };

  useEffect(() => {
    if (!user) return;
    setStatus(user.presenceStatus || "online");
    setMuteNotifications(Boolean(user.muteNotifications));
    setMuteEmotes(Boolean((user as any).muteEmotes));
    setMuteNonFriendCalls(Boolean((user as any).muteNonFriendCalls));
    setDmFriendsOnly(Boolean((user as any).dmFriendsOnly));
    setRingtoneUrl(user.ringtoneUrl || "");
  }, [user]);

  const save = async (changes: Record<string, unknown>) => {
    setSaving(true);
    try {
      const response = await fetch(apiUrl("/api/user/settings"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      if (!response.ok) throw new Error("Could not save settings");
      const updated = await response.json();
      queryClient.setQueryData(["/api/auth/me"], updated);
      queryClient.invalidateQueries({ queryKey: ["/api/chat/users"] });
      toast({ title: "Settings saved" });
    } catch (error: any) {
      toast({ title: "Settings failed", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="nexus-page nexus-page-settings max-w-3xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <SettingsIcon className="w-6 h-6 text-primary" /> Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Control how people see you and how NEXUS notifies you.</p>
        </div>

        <section className="discord-card p-5">
          <h2 className="font-semibold text-foreground mb-1">Presence</h2>
          <p className="text-xs text-muted-foreground mb-4">Choose how your status appears in the server and DMs.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {statuses.map(item => (
              <button
                key={item.id}
                onClick={() => {
                  setStatus(item.id);
                  save({ presenceStatus: item.id });
                }}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border text-left transition-colors",
                  status === item.id ? "border-primary bg-primary/10" : "border-border hover:bg-secondary/60"
                )}
              >
                <span className={cn("w-3 h-3 rounded-full shrink-0", item.color)} />
                <span className="flex-1">
                  <span className="block text-sm font-medium text-foreground">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">{item.description}</span>
                </span>
                {status === item.id && <Check className="w-4 h-4 text-primary" />}
              </button>
            ))}
          </div>
        </section>

        <section className="discord-card p-5 space-y-4">
          <div>
            <h2 className="font-semibold text-foreground mb-1">Notifications & calls</h2>
            <p className="text-xs text-muted-foreground">Customize the sounds and alerts you receive.</p>
          </div>
          <button
            onClick={() => {
              const next = !muteNotifications;
              setMuteNotifications(next);
              save({ muteNotifications: next });
            }}
            className="w-full flex items-center gap-3 p-3 rounded-lg bg-secondary/40 hover:bg-secondary/70 text-left"
          >
            {muteNotifications ? <BellOff className="w-5 h-5 text-muted-foreground" /> : <Bell className="w-5 h-5 text-primary" />}
            <span className="flex-1">
              <span className="block text-sm font-medium text-foreground">Mute notifications</span>
              <span className="block text-xs text-muted-foreground">{muteNotifications ? "Notifications are muted" : "Notifications are enabled"}</span>
            </span>
            <span className={cn("w-10 h-5 rounded-full p-0.5 transition-colors", muteNotifications ? "bg-primary" : "bg-muted")}>
              <span className={cn("block w-4 h-4 rounded-full bg-white transition-transform", muteNotifications && "translate-x-5")} />
            </span>
          </button>
          <div className="space-y-2">
            {[
              { key: "muteEmotes", label: "Mute emotes", description: "Hide incoming animated and sound emotes.", value: muteEmotes, set: setMuteEmotes },
              { key: "muteNonFriendCalls", label: "Mute calls from non-friends", description: "Only accepted friends can ring your account.", value: muteNonFriendCalls, set: setMuteNonFriendCalls },
              { key: "dmFriendsOnly", label: "Lock DMs to friends", description: "Only accepted friends can send you direct messages.", value: dmFriendsOnly, set: setDmFriendsOnly },
            ].map(option => (
              <button key={option.key} type="button" disabled={saving} onClick={() => {
                const next = !option.value;
                option.set(next);
                void save({ [option.key]: next });
              }} className="w-full flex items-center gap-3 rounded-lg border border-border bg-secondary/30 p-3 text-left transition hover:bg-secondary/60 disabled:opacity-60">
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-foreground">{option.label}</span><span className="block text-xs text-muted-foreground">{option.description}</span></span>
                <span className={cn("h-5 w-10 shrink-0 rounded-full p-0.5 transition-colors", option.value ? "bg-primary" : "bg-muted")}><span className={cn("block h-4 w-4 rounded-full bg-white transition-transform", option.value && "translate-x-5")} /></span>
              </button>
            ))}
          </div>
          <div className="rounded-xl border border-border p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0"><div className="text-sm font-medium text-foreground">Device notifications</div><div className="text-xs text-muted-foreground">{notificationState.description}</div></div>
              <span className="text-xs text-muted-foreground">{nativeApp ? `Native · ${nativePlatform()}` : notificationState.permission}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <CyberButton disabled={notificationBusy || (!nativeApp && notificationState.permission === "granted")} onClick={enableNotifications}>{notificationBusy ? "Enabling..." : "Enable notifications"}</CyberButton>
              <CyberButton disabled={!nativeApp && notificationState.permission !== "granted"} onClick={() => (nativeApp ? showNativeTestNotification() : showTestNotification()).catch((error: any) => toast({ title: "Test notification failed", description: error.message, variant: "destructive" }))}>Send test notification</CyberButton>
            </div>
            <p className="text-[11px] text-muted-foreground">Native Android/iOS builds use the operating-system notification APIs. Web/PWA notifications depend on browser support. Remote delivery requires Firebase Cloud Messaging, APNs configuration and a server-side sender; Windows desktop notifications are handled separately by Electron.</p>
          </div>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <CyberInput label="Custom ringtone URL" value={ringtoneUrl} onChange={e => setRingtoneUrl(e.target.value)} placeholder="https://...mp3" />
            </div>
            <CyberButton disabled={saving} onClick={() => save({ ringtoneUrl })}>
              <Volume2 className="w-4 h-4" /> Save
            </CyberButton>
          </div>
        </section>

        <section className="discord-card app-glass space-y-4 p-5">
          <div><h2 className="font-semibold text-foreground mb-1">Appearance</h2><p className="text-xs text-muted-foreground">Choose a built-in font and a free NEXUS background gradient. Changes apply instantly on this device.</p></div>
          <label className="block space-y-2"><span className="text-sm font-medium text-foreground">Interface font</span>
            <select value={appearance.font} onChange={event => { const next = { ...appearance, font: event.target.value as NexusFont }; setAppearance(next); saveNexusAppearance(next); }} className="w-full rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-sm text-foreground">
              {Object.entries(NEXUS_FONTS).map(([key, value]) => <option key={key} value={key}>{key === "system" ? "System / Inter-style" : key.charAt(0).toUpperCase() + key.slice(1)}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(NEXUS_GRADIENTS).map(([key, value]) => <button key={key} type="button" onClick={() => { const next = { ...appearance, gradient: key as NexusGradient }; setAppearance(next); saveNexusAppearance(next); }} aria-pressed={appearance.gradient === key} className={cn("overflow-hidden rounded-xl border p-2 text-left transition", appearance.gradient === key ? "border-violet-300 ring-2 ring-violet-400/40" : "border-white/10 hover:border-white/25")}>
              <span className="mb-2 block h-12 rounded-lg" style={{ backgroundImage: value }} />
              <span className="text-xs font-medium capitalize text-foreground">{key}</span>
            </button>)}
          </div>
        </section>

        <section className="discord-card app-glass space-y-4 p-5">
          <div><h2 className="font-semibold text-foreground mb-1">Passkeys</h2><p className="text-xs text-muted-foreground">Use Windows Hello, Touch ID, Face ID, Android biometrics or a security key where your browser supports WebAuthn.</p></div>
          <CyberButton disabled={passkeyBusy || !user} onClick={registerPasskey}>{passkeyBusy ? "Setting up passkey…" : "Add a passkey to this account"}</CyberButton>
          <div className="rounded-xl border border-border p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div><h3 className="text-sm font-medium text-foreground">Your saved passkeys</h3><p className="text-xs text-muted-foreground">Only passkeys confirmed as saved by NEXUS appear here.</p></div>
              <CyberButton disabled={passkeysLoading} onClick={() => void loadPasskeys()}>{passkeysLoading ? "Refreshing…" : "Refresh"}</CyberButton>
            </div>
            {passkeysLoading && passkeys.length === 0 ? <p className="text-xs text-muted-foreground">Loading passkeys…</p>
              : passkeys.length === 0 ? <p className="text-xs text-muted-foreground">No passkeys are saved to this account yet. Add one above while signed in.</p>
              : <div className="space-y-2">{passkeys.map((item, index) => <div key={item.id} className="flex items-center gap-3 rounded-lg bg-secondary/40 p-3">
                <KeyRound className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1"><p className="text-sm font-medium text-foreground">Passkey {passkeys.length - index}</p><p className="text-xs text-muted-foreground">Added {item.createdAt ? new Date(item.createdAt).toLocaleString() : "date unavailable"}</p></div>
                <button type="button" aria-label={"Remove passkey " + item.id} disabled={deletingPasskeyId === item.id} onClick={() => void deletePasskey(item.id)} className="rounded-md p-2 text-destructive hover:bg-destructive/10 disabled:opacity-50"><Trash2 className="h-4 w-4" /></button>
              </div>)}</div>}
          </div>
          <p className="text-[11px] text-muted-foreground">If a passkey is unavailable or this browser glitches, use your normal password on the sign-in screen. Passkey login cannot safely bypass credential verification.</p>
          <p className="text-[11px] text-muted-foreground">Passkeys require the production WEBAUTHN_ORIGIN and WEBAUTHN_RP_ID settings on the server.</p>
          <div className="border-t border-border pt-4 space-y-2">
            <div><h3 className="text-sm font-medium text-foreground">Apple Developer Team ID</h3><p className="text-xs text-muted-foreground">Save the Team ID associated with your Apple account for NEXUS iOS app configuration.</p></div>
            <div className="flex flex-col sm:flex-row gap-2">
              <CyberInput label="Team ID" value={appleTeamId} onChange={event => { setAppleTeamId(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10)); setTeamIdSaved(false); }} placeholder="10-character Team ID" />
              <CyberButton disabled={appleTeamId.length !== 10} onClick={() => { localStorage.setItem("nexus-apple-team-id", appleTeamId); setTeamIdSaved(true); toast({ title: "Apple Team ID saved", description: "Saved in this browser on this device." }); }}>{teamIdSaved ? "Saved" : "Save Team ID"}</CyberButton>
            </div>
            <p className="text-[11px] text-muted-foreground">This is stored locally in this browser. It does not change website WebAuthn/passkey verification; those use the relying-party domain and origin.</p>
          </div>
        </section>

        <section className="discord-card p-5">
          <h2 className="font-semibold text-foreground mb-2">Account</h2>
          <div className="text-sm text-muted-foreground">
            Signed in as <span className="text-foreground font-medium">{user?.displayName || user?.nickname || user?.username}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Use your profile card in chat to edit your username, display name, avatar, banner, bio, and pronouns.
          </div>
        </section>
      </div>
    </Layout>
  );
}