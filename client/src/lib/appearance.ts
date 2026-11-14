export const NEXUS_FONTS = {
  system: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  arial: "Arial, Helvetica, sans-serif",
  georgia: "Georgia, 'Times New Roman', serif",
  trebuchet: "'Trebuchet MS', sans-serif",
  comic: "'Comic Sans MS', 'Comic Sans', cursive",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as const;

export const NEXUS_GRADIENTS = {
  aurora: "radial-gradient(ellipse at 15% 0%, rgba(124,58,237,.24), transparent 48%), radial-gradient(ellipse at 90% 10%, rgba(6,182,212,.15), transparent 42%), linear-gradient(135deg,#090a13,#171329 55%,#0b1720)",
  violet: "linear-gradient(135deg,#090713 0%,#241044 52%,#0c1021 100%)",
  ocean: "linear-gradient(135deg,#07121f 0%,#0b3450 52%,#10152c 100%)",
  sunset: "linear-gradient(135deg,#1a0b1d 0%,#482044 48%,#18213b 100%)",
  graphite: "linear-gradient(135deg,#090a0f 0%,#191b28 52%,#101018 100%)",
  emerald: "linear-gradient(135deg,#061713 0%,#123c35 52%,#11182a 100%)",
} as const;

export type NexusFont = keyof typeof NEXUS_FONTS;
export type NexusGradient = keyof typeof NEXUS_GRADIENTS;
export type NexusAppearance = { font: NexusFont; gradient: NexusGradient };

export const DEFAULT_NEXUS_APPEARANCE: NexusAppearance = { font: "system", gradient: "aurora" };
const STORAGE_KEY = "nexus-appearance-v1";

export function readNexusAppearance(): NexusAppearance {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return {
      font: value?.font in NEXUS_FONTS ? value.font : DEFAULT_NEXUS_APPEARANCE.font,
      gradient: value?.gradient in NEXUS_GRADIENTS ? value.gradient : DEFAULT_NEXUS_APPEARANCE.gradient,
    };
  } catch { return DEFAULT_NEXUS_APPEARANCE; }
}

export function applyNexusAppearance(value: NexusAppearance) {
  const safeFont = NEXUS_FONTS[value.font] || NEXUS_FONTS.system;
  const safeGradient = NEXUS_GRADIENTS[value.gradient] || NEXUS_GRADIENTS.aurora;
  document.documentElement.style.setProperty("--font-sans", safeFont);
  document.body.style.backgroundImage = safeGradient;
  document.body.style.backgroundAttachment = "fixed";
}

export function saveNexusAppearance(value: NexusAppearance) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  applyNexusAppearance(value);
  window.dispatchEvent(new CustomEvent("nexus-appearance-change"));
}
