import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { registerNotificationWorker } from "./lib/platform-notifications";
import { installApiFetchBridge } from "./lib/api-url";

installApiFetchBridge();
void registerNotificationWorker();

// Keep the app aligned with the real visible area when the iOS/Android
// software keyboard opens. 100vh alone does not track the visual viewport.
const syncVisualViewport = () => {
  const viewport = window.visualViewport;
  const height = viewport?.height ?? window.innerHeight;
  const offsetTop = viewport?.offsetTop ?? 0;
  document.documentElement.style.setProperty("--nexus-visual-height", height + "px");
  document.documentElement.style.setProperty("--nexus-visual-offset-top", offsetTop + "px");
};
syncVisualViewport();
window.addEventListener("resize", syncVisualViewport, { passive: true });
window.visualViewport?.addEventListener("resize", syncVisualViewport, { passive: true });
window.visualViewport?.addEventListener("scroll", syncVisualViewport, { passive: true });

createRoot(document.getElementById("root")!).render(<App />);
