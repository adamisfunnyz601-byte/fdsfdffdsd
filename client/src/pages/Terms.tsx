import { Link } from "wouter";
import { ArrowLeft, ShieldCheck } from "lucide-react";

const sections = [
  { title: "1. Who can use NEXUS", body: "You must be at least 13 years old, or the minimum age required to use online services in your country if that age is higher. If you are under 18, you must have permission from a parent or legal guardian. Do not create an account if you are not eligible." },
  { title: "2. Your account", body: "Keep your login details secure and do not share your password. You are responsible for activity carried out through your account. Give accurate information, use a username you are allowed to use, and tell the NEXUS operator if you believe someone has accessed your account without permission. Accounts are personal and must not be sold, rented or impersonated." },
  { title: "3. Acceptable use", body: "Do not use NEXUS to break the law, threaten or harass people, bully, stalk, exploit or groom anyone, share sexual content involving minors, distribute malware, scam people, spam, impersonate others, infringe intellectual property, or interfere with the service or its security. Do not attempt to access another person's account, messages, data or systems without permission." },
  { title: "4. Messages and user content", body: "You keep ownership of content you create, to the extent the law allows. By submitting content, you give the NEXUS operator permission to host, process, transmit and display it only as needed to operate, secure and provide the features you use. You are responsible for having the rights and permissions needed to share content. Do not share private information about another person without a proper reason and permission." },
  { title: "5. Moderation and safety", body: "The NEXUS operator may review reported content and may remove content, restrict features, suspend or close accounts when reasonably necessary to protect users, comply with law, enforce these terms or keep the service working. Moderation decisions may be appealed through any support or contact route published for your NEXUS instance. Do not rely on NEXUS as an emergency service." },
  { title: "6. Third-party services", body: "Some features may rely on third-party services, links, media providers or app stores. Those services may have their own terms and privacy practices. The NEXUS operator does not control third-party services and is not responsible for their independent content, availability or policies." },
  { title: "7. Availability and changes", body: "NEXUS is provided as it is available. Features may change, be interrupted or be discontinued, and maintenance or technical problems may cause downtime or data loss. The operator will make reasonable efforts to keep the service working but does not promise uninterrupted or error-free availability." },
  { title: "8. Disclaimers and liability", body: "To the extent permitted by law, NEXUS is provided without guarantees that it will meet every requirement or always be secure, available or compatible with every device. Nothing in these terms limits liability that cannot legally be limited, including liability for fraud or for death or personal injury caused by negligence. Otherwise, the operator is not responsible for indirect or unforeseeable losses arising from use of the service." },
  { title: "9. Suspension and ending your use", body: "You can stop using NEXUS at any time. The operator may suspend or end access for serious or repeated breaches, security risks, legal requirements or where the service is being discontinued. Where reasonable and lawful, notice or an opportunity to resolve the issue will be provided." },
  { title: "10. Privacy", body: "These terms do not replace a Privacy Policy. Information about what personal data NEXUS collects, why it is used, how long it is kept and how to exercise your privacy rights should be provided in a separate privacy notice for the NEXUS instance you use. Do not assume private messages are end-to-end encrypted unless the app explicitly says so." },
  { title: "11. Changes to these terms", body: "The operator may update these terms as NEXUS changes or when required by law. Material changes should be brought to users' attention. If you continue using NEXUS after an updated version takes effect, the updated terms apply where permitted by law. If you do not agree, stop using the service." },
  { title: "12. Contact", body: "NEXUS may be operated by an individual or organisation separate from the software provider. For questions, complaints or legal notices, use the contact details published by the operator of the NEXUS instance you are using." },
];

export default function TermsPage() {
  return <main className="min-h-screen bg-[#090811] px-4 py-8 text-white sm:px-6">
    <div className="mx-auto max-w-4xl">
      <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm text-violet-300 transition hover:text-white"><ArrowLeft size={16}/> Back to NEXUS</Link>
      <header className="mb-8 rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-500/10 to-transparent p-6 sm:p-9">
        <div className="mb-3 flex items-center gap-2 text-xs font-bold tracking-[.2em] text-violet-300"><ShieldCheck size={16}/> NEXUS · LEGAL</div>
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Terms and Conditions</h1>
        <p className="mt-3 text-sm text-white/55">Effective date: 15 November 2026</p>
        <p className="mt-5 max-w-2xl leading-7 text-white/75">These terms explain the basic rules for using NEXUS, including accounts, messages, user content and acceptable behaviour. Please read them before creating an account.</p>
      </header>
      <div className="space-y-4">
        {sections.map(section => <section key={section.title} className="rounded-xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
          <h2 className="text-base font-bold text-violet-200">{section.title}</h2>
          <p className="mt-2 text-sm leading-7 text-white/70">{section.body}</p>
        </section>)}
      </div>
      <p className="mt-8 border-t border-white/10 pt-5 text-xs leading-6 text-white/40">This is a general starter terms document, not legal advice. The NEXUS operator should review it for the actual service, identify the responsible legal entity and publish accurate contact details and a separate privacy notice before public launch.</p>
    </div>
  </main>;
}
