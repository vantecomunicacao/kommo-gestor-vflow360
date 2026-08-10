import type { JSONContent } from "@tiptap/react";

// Extrai um resumo em texto puro de um doc Tiptap, para preview nos cards.
export function noteContentToPreview(content: JSONContent | null, maxLength = 180): string {
  if (!content) return "";
  const parts: string[] = [];
  const walk = (node: JSONContent) => {
    if (node.type === "text" && node.text) parts.push(node.text);
    node.content?.forEach(walk);
  };
  walk(content);
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
