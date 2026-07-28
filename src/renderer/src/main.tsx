import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-sc";
import "@fontsource-variable/noto-serif-sc";
import { App } from "./App";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CharacterSessionProvider } from "./characters/CharacterSessionProvider";
import { initializeTheme } from "./theme";
import "./styles.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Renderer root element was not found.");
}

initializeTheme();

createRoot(rootElement).render(
  <StrictMode>
    <TooltipProvider>
      <CharacterSessionProvider>
        <App />
      </CharacterSessionProvider>
    </TooltipProvider>
  </StrictMode>,
);
