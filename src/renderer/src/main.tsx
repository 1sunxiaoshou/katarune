import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { TooltipProvider } from "@/components/ui/tooltip";
import { KataruneAssistantRuntimeProvider } from "./KataruneAssistantRuntimeProvider";
import { initializeTheme } from "./theme";
import "./styles.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Renderer root element was not found.");
}

const initialTheme = initializeTheme();

createRoot(rootElement).render(
  <StrictMode>
    <TooltipProvider>
      <KataruneAssistantRuntimeProvider>
        <App initialTheme={initialTheme} />
      </KataruneAssistantRuntimeProvider>
    </TooltipProvider>
  </StrictMode>,
);
