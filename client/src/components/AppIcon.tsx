import { useState } from "react";
import type { LucideIcon } from "lucide-react";

type AppIconProps = {
  name: string;
  fallback: LucideIcon;
  size?: number;
  className?: string;
};

/** PNG overrides are managed by the super-owner icon studio; SVG remains a compatibility fallback. */
export function AppIcon({ name, fallback: Fallback, size = 18, className }: AppIconProps) {
  const [source, setSource] = useState<"png" | "svg" | "fallback">("png");
  if (source === "fallback") return <Fallback size={size} className={className} aria-hidden="true" />;
  return (
    <img
      src={source === "png" ? `/icons/${name}.png` : `/icons/${name}.svg`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className={className}
      style={{ width: size, height: size, objectFit: "contain" }}
      onError={() => setSource(current => current === "png" ? "svg" : "fallback")}
    />
  );
}
