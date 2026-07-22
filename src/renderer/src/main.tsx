import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { TooltipProvider } from "@/components/ui/tooltip";
import { KataruneAssistantRuntimeProvider } from "./KataruneAssistantRuntimeProvider";
import "./styles.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Renderer root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <TooltipProvider>
      <KataruneAssistantRuntimeProvider>
        <App />
      </KataruneAssistantRuntimeProvider>
    </TooltipProvider>
  </StrictMode>,
);
