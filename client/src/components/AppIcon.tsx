import { useState } from "react";
import type { LucideIcon } from "lucide-react";

type AppIconProps = Omit<React.ComponentProps<LucideIcon>, "ref"> & {
  name: string;
  fallback: LucideIcon;
};

/** Every Lucide icon in the app can be overridden by a PNG uploaded in the Super Owner Icon Studio. */
export function AppIcon({ name, fallback: Fallback, size = 18, className, ...iconProps }: AppIconProps) {
  const [source, setSource] = useState<"png" | "svg" | "fallback">("png");
  if (source === "fallback") return <Fallback size={size} className={className} aria-hidden="true" {...iconProps} />;
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
