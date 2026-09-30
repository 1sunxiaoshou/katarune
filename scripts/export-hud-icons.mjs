import { writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ChevronDown, ChevronsRight, Ellipsis, MessageCircleMore,
  Mic, MicOff, RefreshCw, X,
} from "lucide-react";

// Use the same locked icon library as Electron; Unity only needs static vectors.
const icons = {
  "chevron-down": ChevronDown,
  "chevrons-right": ChevronsRight,
  close: X,
  ellipsis: Ellipsis,
  "message-circle-more": MessageCircleMore,
  mic: Mic,
  "mic-off": MicOff,
  "refresh-cw": RefreshCw,
};
const directory = new URL(
  "../unity/KataruneAvatar/Assets/Katarune/Runtime/UI/Hud/Icons/",
  import.meta.url,
);

for (const [name, icon] of Object.entries(icons)) {
  const svg = renderToStaticMarkup(createElement(icon, {
    size: 24, color: "#fff", strokeWidth: 2,
  }));
  // VectorImage trims mesh bounds even with viewport clipping enabled. A fully
  // transparent rectangle preserves Lucide's canvas without changing its glyph.
  const canvas = '<rect width="24" height="24" fill="#fff" fill-opacity="0" stroke="none"/>';
  writeFileSync(new URL(`${name}.svg`, directory), svg.replace(/(<svg[^>]*>)/, `$1${canvas}`) + "\n");
}
