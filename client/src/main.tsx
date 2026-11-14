import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { registerNotificationWorker } from "./lib/platform-notifications";

void registerNotificationWorker();

createRoot(document.getElementById("root")!).render(<App />);
