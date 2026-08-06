import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";

import { reportEdgeError } from "../_shared/error-reporter.ts";
import { corsHeadersExtended as corsHeaders } from "../_shared/cors.ts";

interface OpenAIResponseContentItem {
  text?: string;
}
interface OpenAIResponseOutputItem {
  content?: OpenAIResponseContentItem[];
}

// Limits
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_PAGES = 50;
const MAX_CHARS = 50_000;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function base64ToBytes(b64: string): Uint8Array {
  const cleaned = b64.replace(/\s/g, "").replace(/^data:[^;]+;base64,/, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function summarizeWithAI(
  text: string,
  apiKey: string,
  endpoint: string,
  model: string,
  fileName: string,
): Promise<string> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "Você resume documentos PDF em português. Gere um resumo curto (2 a 4 frases) destacando o tipo do documento, o assunto principal e dados relevantes (nomes, valores, datas). Se houver tabelas ou números importantes, mencione-os. Retorne APENAS o resumo, sem títulos.",
          },
          {
            role: "user",
            content: `Arquivo: ${fileName}\n\nTexto extraído:\n${text}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error("AI summary error:", response.status, await response.text());
      return "";
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || "";
  } catch (e) {
    console.error("AI summary failed:", e);
    return "";
  }
}

/**
 * OCR via OpenAI — sobe o PDF para a Files API e usa a Responses API (gpt-4o),
 * que lê PDFs nativamente (input_file), extraindo texto de páginas escaneadas.
 * Retorna { text, summary } combinados em uma única chamada.
 */
async function ocrWithOpenAI(
  pdfBytes: Uint8Array,
  apiKey: string,
  fileName: string,
  totalPages: number,
): Promise<{ text: string; summary: string }> {
  let fileId = "";
  try {
    console.log(`OCR fallback: uploading ${formatBytes(pdfBytes.byteLength)} PDF to OpenAI Files`);

    // 1. Upload the PDF to the Files API (purpose user_data → usable as input_file)
    const uploadForm = new FormData();
    uploadForm.append("purpose", "user_data");
    uploadForm.append("file", new Blob([pdfBytes], { type: "application/pdf" }), fileName || "document.pdf");

    const uploadResp = await fetch("https://api.openai.com/v1/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: uploadForm,
    });
    if (!uploadResp.ok) {
      console.error("OpenAI file upload error:", uploadResp.status, await uploadResp.text());
      return { text: "", summary: "" };
    }
    fileId = (await uploadResp.json()).id;

    // 2. Run OCR + summary via the Responses API (gpt-4o reads the PDF natively)
    const instructions =
      "Você é um OCR de PDFs em português. Receberá um PDF (possivelmente escaneado) e deve: 1) extrair TODO o texto visível, página por página; 2) gerar um resumo curto (2-4 frases) destacando tipo de documento, assunto e dados relevantes. Retorne no formato exato:\n\n===TEXTO===\n[texto extraído]\n\n===RESUMO===\n[resumo]";

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `${instructions}\n\nArquivo: ${fileName} (${totalPages} páginas). Faça OCR completo e gere o resumo.`,
              },
              { type: "input_file", file_id: fileId },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error("OpenAI Responses OCR error:", response.status, await response.text());
      return { text: "", summary: "" };
    }

    const data = await response.json();
    // Aggregate the model output. The raw HTTP response exposes `output[].content[]`
    // with `{ type: "output_text", text }`; some responses also include `output_text`.
    let fullContent = "";
    if (typeof data.output_text === "string") {
      fullContent = data.output_text;
    } else if (Array.isArray(data.output)) {
      fullContent = (data.output as OpenAIResponseOutputItem[])
        .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
        .map((c) => c?.text ?? "")
        .join("");
    }
    fullContent = fullContent.trim();

    // Parse response into text + summary
    const textMatch = fullContent.match(/===TEXTO===\s*([\s\S]*?)\s*===RESUMO===/);
    const summaryMatch = fullContent.match(/===RESUMO===\s*([\s\S]*?)$/);

    const text = textMatch?.[1]?.trim() || "";
    const summary = summaryMatch?.[1]?.trim() || fullContent;

    return { text, summary };
  } catch (e) {
    console.error("OpenAI OCR failed:", e);
    return { text: "", summary: "" };
  } finally {
    // Best-effort cleanup of the uploaded file
    if (fileId) {
      fetch(`https://api.openai.com/v1/files/${fileId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
      }).catch(() => {});
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json();
    const {
      pdf_base64,
      pdf_url,
      file_name = "documento.pdf",
      user_id,
    } = body as {
      pdf_base64?: string;
      pdf_url?: string;
      file_name?: string;
      user_id?: string;
    };

    if (!pdf_base64 && !pdf_url) {
      return new Response(
        JSON.stringify({ error: "pdf_base64 or pdf_url required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load PDF bytes
    let pdfBytes: Uint8Array;
    if (pdf_base64) {
      pdfBytes = base64ToBytes(pdf_base64);
    } else {
      const resp = await fetch(pdf_url!);
      if (!resp.ok) throw new Error(`Failed to fetch PDF URL: ${resp.status}`);
      pdfBytes = new Uint8Array(await resp.arrayBuffer());
    }

    const fileSize = pdfBytes.byteLength;
    console.log(`PDF received: ${file_name}, size: ${formatBytes(fileSize)}`);

    // Size guard
    if (fileSize > MAX_BYTES) {
      const message = `📄 [PDF]: ${file_name} (${formatBytes(fileSize)}) — Arquivo muito grande para análise automática (limite: 10 MB).`;
      return new Response(
        JSON.stringify({
          success: true,
          truncated: false,
          oversized: true,
          message,
          file_size: fileSize,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve AI provider for this user
    const aiEndpoint = "https://api.openai.com/v1/chat/completions";
    let aiKey = "";
    let aiModel = "gpt-4o-mini";

    if (user_id) {
      try {
        const { data: providerCfg } = await supabase
          .from("ai_provider_config")
          .select("provider, api_key, model")
          .eq("user_id", user_id)
          .maybeSingle();
        if (providerCfg?.provider === "openai" && providerCfg?.api_key) {
          aiKey = providerCfg.api_key;
          aiModel = providerCfg.model || "gpt-4o-mini";
        }
      } catch { /* defaults */ }
    }

    // Extract text
    let text = "";
    let totalPages = 0;
    let pagesUsed = 0;
    let extractionError = false;

    try {
      const pdf = await getDocumentProxy(pdfBytes);
      totalPages = pdf.numPages;
      pagesUsed = Math.min(totalPages, MAX_PAGES);
      console.log(`PDF pages: ${totalPages}, extracting first ${pagesUsed}`);

      const result = await extractText(pdf, { mergePages: false });
      const pageTexts = (result.text as string[]).slice(0, MAX_PAGES);
      text = pageTexts.join("\n\n").trim();
    } catch (e) {
      console.error("PDF text extraction failed:", e);
      extractionError = true;
    }

    // Char limit
    let truncatedChars = false;
    if (text.length > MAX_CHARS) {
      text = text.slice(0, MAX_CHARS);
      truncatedChars = true;
    }

    const needsOcr = extractionError || !text || text.trim().length < 20;
    let usedOcr = false;
    let summary = "";

    if (needsOcr && aiKey) {
      // Fallback: scanned PDF — send entire PDF to OpenAI (gpt-4o) for OCR + summary
      console.log("Text extraction insufficient, falling back to OpenAI OCR");
      const ocrResult = await ocrWithOpenAI(pdfBytes, aiKey, file_name, totalPages || 0);
      if (ocrResult.text || ocrResult.summary) {
        usedOcr = true;
        text = ocrResult.text || text;
        if (text.length > MAX_CHARS) {
          text = text.slice(0, MAX_CHARS);
          truncatedChars = true;
        }
        summary = ocrResult.summary;
      }
    }

    if (needsOcr && !usedOcr) {
      const reason = extractionError
        ? "Não foi possível ler o conteúdo do PDF (pode ser corrompido)."
        : "PDF parece ser apenas imagens (escaneado) e o OCR não conseguiu extrair texto.";
      const message = `📄 [PDF]: ${file_name} (${formatBytes(fileSize)}${totalPages ? `, ${totalPages} pág` : ""}) — ${reason}`;
      return new Response(
        JSON.stringify({
          success: true,
          message,
          empty: !extractionError,
          extraction_failed: extractionError,
          file_size: fileSize,
          total_pages: totalPages,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // If we have text but no summary yet (text-extraction path), summarize now
    if (!summary) {
      summary = await summarizeWithAI(text, aiKey, aiEndpoint, aiModel, file_name);
    }

    const truncatedPages = totalPages > MAX_PAGES;
    const ocrTag = usedOcr ? ", OCR" : "";
    const sizeNote = `${formatBytes(fileSize)}, ${totalPages} pág${truncatedPages ? ` (analisadas ${MAX_PAGES})` : ""}${truncatedChars ? ", texto truncado" : ""}${ocrTag}`;

    const message = summary
      ? `📄 [PDF]: ${file_name} (${sizeNote})\n\nResumo: ${summary}`
      : `📄 [PDF]: ${file_name} (${sizeNote}) — Conteúdo extraído mas não foi possível resumir.`;

    return new Response(
      JSON.stringify({
        success: true,
        message,
        summary,
        text_preview: text.slice(0, 500),
        total_pages: totalPages,
        pages_used: pagesUsed,
        truncated_pages: truncatedPages,
        truncated_chars: truncatedChars,
        used_ocr: usedOcr,
        file_size: fileSize,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("pdf-extract error:", error);
    const message = error instanceof Error ? error.message : String(error);
    await reportEdgeError("edge:pdf-extract", error);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
