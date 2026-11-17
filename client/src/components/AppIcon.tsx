import { useState } from "react";
import type { LucideIcon } from "lucide-react";

type AppIconProps = {
  name: string;
  fallback: LucideIcon;
  size?: number;
  className?: string;
};

/**
 * Loads a replaceable SVG from /icons/<name>.svg.
 * If an icon file is missing or invalid, the original Lucide icon is shown.
 */
export function AppIcon({ name, fallback: Fallback, size = 18, className }: AppIconProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Fallback size={size} className={className} aria-hidden="true" />;
  return (
    <img
      src={`/icons/${name}.svg`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className={className}
      style={{ width: size, height: size, objectFit: "contain" }}
      onError={() => setFailed(true)}
    />
  );
}
