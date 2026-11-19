import { useState } from "react";
import type { LucideIcon } from "lucide-react";

type AppIconProps = Omit<React.ComponentProps<LucideIcon>, "ref"> & { name: string; fallback: LucideIcon; };

/** Show the Lucide fallback immediately; swap in a custom asset only after it has loaded. */
export function AppIcon({ name, fallback: Fallback, size = 18, className, ...iconProps }: AppIconProps) {
  const [source, setSource] = useState<"png" | "svg" | "fallback">("png");
  const [loaded, setLoaded] = useState(false);
  return (
    <span className={className} aria-hidden="true" style={{ position: "relative", display: "inline-flex", flex: "0 0 auto", width: size, height: size, verticalAlign: "middle" }}>
      <Fallback size={size} className="absolute inset-0" style={{ width: size, height: size }} aria-hidden="true" {...iconProps} />
      {source !== "fallback" && <img
        src={source === "png" ? "/icons/" + name + ".png" : "/icons/" + name + ".svg"}
        width={size} height={size} alt="" aria-hidden="true" loading="eager" decoding="async"
        className="absolute inset-0"
        style={{ width: size, height: size, objectFit: "contain", opacity: loaded ? 1 : 0 }}
        onLoad={() => setLoaded(true)}
        onError={() => { setLoaded(false); setSource(current => current === "png" ? "svg" : "fallback"); }}
      />}
    </span>
  );
}
