import { Link } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ShieldCheck, Globe2, MessageCircle, Video, Layers3, Code2, Server, Smartphone, Sparkles, LockKeyhole, Zap } from "@/components/ManagedIcons";
import { useAuth } from "@/hooks/use-auth";

const rise = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.65, ease: [0.22, 1, 0.36, 1] } },
};

const features = [
  { icon: Globe2, title: "A browser with a different route", copy: "Open websites through the NEXUS web proxy, keep useful destinations close and pick up where you left off." },
  { icon: MessageCircle, title: "People, not just pages", copy: "Chat with friends, build your circles and keep conversations together in one connected space." },
  { icon: Video, title: "Live conversations", copy: "NEXUS is being built around real-time voice and video experiences, alongside everyday messaging." },
  { icon: ShieldCheck, title: "Your own workspace", copy: "A single account connects your browser workspace, profile, settings and community features." },
];

const buildSteps = [
  { n: "01", title: "The interface", detail: "React, TypeScript and a responsive component system power the web experience." },
  { n: "02", title: "The engine", detail: "A Node.js and Express backend handles application routes, sessions and server-side features." },
  { n: "03", title: "The data", detail: "PostgreSQL stores the information that makes accounts, conversations and history persistent." },
  { n: "04", title: "Across devices", detail: "The web experience is the foundation, with Capacitor and Electron used to package dedicated mobile and desktop apps." },
];

function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return <motion.div className={className} variants={rise} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.18 }} transition={reduced ? { duration: 0 } : undefined}>{children}</motion.div>;
}

export default function Landing() {
  const { user, isLoading } = useAuth();
  const destination = user ? "/main-page" : "/sign-in";
  return (
    <main className="nexus-landing min-h-screen overflow-hidden text-white">
      <div className="nexus-landing-noise" aria-hidden="true" />
      <header className="nexus-landing-nav">
        <Link href="/" className="nexus-landing-brand"><span className="nexus-landing-mark">N</span><span>NEXUS<span className="nexus-landing-brand-dot">.</span></span></Link>
        <nav className="flex items-center gap-3">
          <a href="#features" className="hidden sm:inline text-sm text-white/55 transition hover:text-white">Features</a>
          <a href="#build" className="hidden sm:inline text-sm text-white/55 transition hover:text-white">How it's built</a>
          <Link href={destination} className="nexus-landing-nav-cta">{isLoading ? "Loading…" : user ? "Main Page" : "Sign In"} <ArrowRight size={15}/></Link>
        </nav>
      </header>

      <section className="nexus-landing-hero">
        <div className="nexus-landing-grid" aria-hidden="true" />
        <motion.div className="nexus-landing-orb nexus-landing-orb-a" animate={{ y: [0, -18, 0], scale: [1, 1.06, 1] }} transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }} />
        <motion.div className="nexus-landing-orb nexus-landing-orb-b" animate={{ y: [0, 16, 0], x: [0, 12, 0] }} transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }} />
        <Reveal className="relative z-10 mx-auto max-w-5xl text-center">
          <div className="nexus-landing-eyebrow"><span className="nexus-landing-live-dot"/> ONE SPACE. MANY POSSIBILITIES.</div>
          <h1>Everything you need.<br/><span>Connected in NEXUS.</span></h1>
          <p className="nexus-landing-lead">A modern web workspace bringing browsing, communication and your digital world together — built to keep growing.</p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link href={destination} className="nexus-landing-primary">{user ? "Open Main Page" : "Get started"} <ArrowRight size={17}/></Link>
            <a href="#features" className="nexus-landing-secondary">Explore NEXUS <span>↓</span></a>
          </div>
          <div className="nexus-landing-preview-wrap">
            <div className="nexus-landing-preview">
              <div className="nexus-landing-preview-top"><div className="flex gap-1.5"><i/><i/><i/></div><span>nexus / workspace</span><span className="nexus-landing-preview-lock"><LockKeyhole size={12}/> PRIVATE SESSION</span></div>
              <div className="nexus-landing-preview-body">
                <aside><div className="nexus-landing-mini-logo">N</div><span className="active">⌂</span><span>◎</span><span>▤</span><span>⚙</span></aside>
                <div className="nexus-landing-preview-content"><div className="text-left"><small>YOUR DIGITAL SPACE</small><h3>Welcome to your<br/><b>next starting point.</b></h3><p>Browse. Connect. Create.</p></div><div className="nexus-landing-preview-cards"><div><Globe2/><b>Web proxy</b><small>Explore the web</small></div><div><MessageCircle/><b>Messages</b><small>Stay connected</small></div><div><Sparkles/><b>Your space</b><small>Make it yours</small></div></div></div>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      <section id="features" className="nexus-landing-section">
        <Reveal><div className="nexus-landing-kicker">BUILT TO BRING IT TOGETHER</div><h2>More than a homepage.<br/><span>A connected experience.</span></h2><p className="nexus-landing-section-lead">NEXUS brings useful tools and the people you care about into one place.</p></Reveal>
        <div className="nexus-landing-feature-grid">
          {features.map((feature, index) => <Reveal key={feature.title} className="h-full"><article className="nexus-landing-feature"><div className="nexus-landing-feature-icon"><feature.icon size={21}/></div><span className="nexus-landing-feature-number">0{index + 1}</span><h3>{feature.title}</h3><p>{feature.copy}</p></article></Reveal>)}
        </div>
      </section>

      <section id="build" className="nexus-landing-section nexus-landing-build">
        <Reveal><div className="nexus-landing-kicker">UNDER THE HOOD</div><h2>Designed with purpose.<br/><span>Built piece by piece.</span></h2><p className="nexus-landing-section-lead">A look at the technology and ideas behind the NEXUS website.</p></Reveal>
        <div className="nexus-landing-timeline">{buildSteps.map((step, index) => <Reveal key={step.n}><article className="nexus-landing-step"><div className="nexus-landing-step-number">{step.n}</div><div><h3>{step.title}</h3><p>{step.detail}</p></div><div className="nexus-landing-step-icon">{[<Code2/>,<Server/>,<Layers3/>,<Smartphone/>][index]}</div></article></Reveal>)}</div>
        <Reveal><div className="nexus-landing-stack"><span><Code2/> React + TypeScript</span><span><Server/> Node.js + Express</span><span><Layers3/> PostgreSQL</span><span><Zap/> WebRTC</span></div></Reveal>
      </section>

      <section id="downloads" className="nexus-landing-section nexus-landing-build">
        <Reveal><div className="nexus-landing-kicker">TAKE NEXUS WITH YOU</div><h2>One account.<br/><span>Every device.</span></h2><p className="nexus-landing-section-lead">Install NEXUS on your computer or Android device, or keep using the website in your browser. Desktop and mobile installers contain the app only — not the backend source or database.</p></Reveal>
        <div className="nexus-landing-feature-grid">
          <Reveal><article className="nexus-landing-feature"><div className="nexus-landing-feature-icon"><Smartphone size={21}/></div><h3>Android APK</h3><p>Install the NEXUS Android app directly on a compatible Android device.</p><a className="nexus-landing-primary mt-5 inline-flex" href="https://github.com/adamisfunnyz601-byte/fdsfdffdsd/releases" target="_blank" rel="noreferrer">Get Android build <ArrowRight size={16}/></a></article></Reveal>
          <Reveal><article className="nexus-landing-feature"><div className="nexus-landing-feature-icon"><Code2 size={21}/></div><h3>Windows installer</h3><p>Download the Windows setup installer and install NEXUS on your PC.</p><a className="nexus-landing-primary mt-5 inline-flex" href="https://github.com/adamisfunnyz601-byte/fdsfdffdsd/releases" target="_blank" rel="noreferrer">Get Windows setup <ArrowRight size={16}/></a></article></Reveal>
          <Reveal><article className="nexus-landing-feature"><div className="nexus-landing-feature-icon"><Globe2 size={21}/></div><h3>Website</h3><p>Use the full NEXUS experience in your browser without installing anything.</p><a className="nexus-landing-primary mt-5 inline-flex" href="/sign-in">Open NEXUS <ArrowRight size={16}/></a></article></Reveal>
        </div>
      </section>

      <section className="nexus-landing-final">
        <Reveal><div className="nexus-landing-kicker">YOUR NEXT TAB STARTS HERE</div><h2>Ready to enter<br/><span>your NEXUS?</span></h2><p>Sign in and jump straight into your workspace.</p><Link href={destination} className="nexus-landing-primary">{user ? "Go to Main Page" : "Sign In to NEXUS"} <ArrowRight size={17}/></Link></Reveal>
      </section>
      <footer className="nexus-landing-footer"><Link href="/" className="nexus-landing-brand"><span className="nexus-landing-mark">N</span><span>NEXUS™<span className="nexus-landing-brand-dot">.</span></span></Link><span>Built to bring your digital world together.</span><div className="flex flex-wrap items-center gap-4 text-xs"><Link href="/terms" className="text-white/55 transition hover:text-white">Terms and Conditions</Link><a href="#top" onClick={e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Back to top ↑</a></div><small className="basis-full text-[10px] text-white/35">© 2026 AdamisFunnyz. All rights reserved. AdamisFunnyz™ and BLOCKED™ are creator brand names.</small></footer>
    </main>
  );
}
