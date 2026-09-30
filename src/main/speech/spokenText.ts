import { unified } from "unified";
import remarkParse from "remark-parse";
import type { RootContent } from "mdast";

const parser = unified().use(remarkParse);
export function extractSpokenText(markdown: string): string {
  const root = parser.parse(markdown);
  function read(node: RootContent): string {
    if (["code", "image", "imageReference", "html", "definition"].includes(node.type)) return "";
    if (node.type === "text" || node.type === "inlineCode") return node.value;
    if (node.type === "break") return "\n";
    if ("children" in node) {
      const text = node.children.map(read).join("");
      return ["paragraph", "heading", "listItem", "blockquote"].includes(node.type) ? `${text}\n` : text;
    }
    return "";
  }
  return root.children.map(read).join("").trim();
}
