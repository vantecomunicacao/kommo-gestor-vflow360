// Conversas 2.0 — logica compartilhada de enriquecimento de attachments.
//
// Extraido de ghl-enrich-attachments para rodar INLINE no tick do cron
// (sem edge->edge, que falha nesse Supabase — ver feedback-edge-fn-no-http).
//
// Pega ghl_messages com attachments mas sem enriched_body, baixa as URLs e:
//   - imagem -> OpenAI vision -> descricao
//   - audio  -> Whisper -> transcricao
//   - PDF    -> pdf-extract edge function -> texto
// Grava em ghl_messages.enriched_body para o ai-analyze-v2 ler.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024; // 25 MB (limite do Whisper)

// Modelos de enriquecimento (baratos por padrao, configuraveis por env):
//   - audio: gpt-4o-mini-transcribe = $0.003/min (metade do whisper-1)
//   - imagem: gpt-4o-mini = modelo de visao mais barato da OpenAI
// Desacoplados do modelo de ANALISE do usuario (descricao de midia nao precisa
// de modelo premium). Para tunar, setar os secrets GHL_ENRICH_AUDIO_MODEL /
// GHL_ENRICH_IMAGE_MODEL nas edge functions.
const ENRICH_AUDIO_MODEL = Deno.env.get("GHL_ENRICH_AUDIO_MODEL") || "gpt-4o-mini-transcribe";
const ENRICH_IMAGE_MODEL = Deno.env.get("GHL_ENRICH_IMAGE_MODEL") || "gpt-4o-mini";

// ============================================================
// Helpers de download/conversao
// ============================================================
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function downloadAsBase64(url: string): Promise<{ base64: string; mimetype: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`download ${res.status} ${url.slice(0, 80)}`);
  const len = Number(res.headers.get("content-length") || 0);
  if (len && len > MAX_DOWNLOAD_BYTES) {
    throw new Error(`arquivo muito grande (${Math.round(len / 1024 / 1024)} MB)`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`arquivo muito grande (${Math.round(buf.byteLength / 1024 / 1024)} MB)`);
  }
  const mimetype = res.headers.get("content-type") || "application/octet-stream";
  return { base64: arrayBufferToBase64(buf), mimetype };
}

function kindFromUrl(url: string): "image" | "audio" | "video" | "pdf" | "other" {
  const clean = url.split("?")[0].toLowerCase();
  if (/\.(jpe?g|png|gif|webp|avif|bmp)$/.test(clean)) return "image";
  if (/\.(mp3|ogg|oga|wav|m4a|aac|opus)$/.test(clean)) return "audio";
  if (/\.(mp4|webm|mov|m4v|mkv)$/.test(clean)) return "video";
  if (/\.pdf$/.test(clean)) return "pdf";
  return "other";
}

function fileNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.split("/").pop() || "arquivo");
  } catch {
    return "arquivo";
  }
}

// ============================================================
// Enriquecedores (OpenAI vision / Whisper / pdf-extract)
// ============================================================
async function describeImage(
  base64: string,
  mimetype: string,
  apiKey: string,
  model = ENRICH_IMAGE_MODEL,
): Promise<string> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Descreva esta imagem de forma objetiva e concisa em português. Se houver texto, transcreva integralmente. Retorne APENAS a descrição, sem preâmbulo.",
            },
            { type: "image_url", image_url: { url: `data:${mimetype};base64,${base64}` } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!resp.ok) throw new Error(`OpenAI vision ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const desc = data.choices?.[0]?.message?.content?.trim();
  if (!desc) throw new Error("vision retornou vazio");
  return `📷 [Imagem]: ${desc}`;
}

async function transcribeAudio(
  base64: string,
  mimetype: string,
  apiKey: string,
): Promise<string> {
  const contentType = mimetype || "audio/ogg";
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  const ext = contentType.includes("ogg")
    ? "ogg"
    : contentType.includes("mp4") || contentType.includes("m4a")
      ? "m4a"
      : contentType.includes("wav")
        ? "wav"
        : "mp3";
  const formData = new FormData();
  formData.append("file", new Blob([bytes], { type: contentType }), `audio.${ext}`);
  formData.append("model", ENRICH_AUDIO_MODEL);
  formData.append("language", "pt");

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
    signal: AbortSignal.timeout(120_000),
  });
  if (!resp.ok) throw new Error(`transcribe ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const text = data.text?.trim();
  if (!text) throw new Error("transcribe retornou vazio");
  return `🎵 [Áudio]: ${text}`;
}

async function extractPdf(
  base64: string,
  fileName: string,
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
): Promise<string> {
  const resp = await fetch(`${supabaseUrl}/functions/v1/pdf-extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({ pdf_base64: base64, file_name: fileName, user_id: userId }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!resp.ok) throw new Error(`pdf-extract ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  if (data?.error) throw new Error(`pdf-extract: ${data.error}`);
  return data?.message || `📄 [PDF]: ${fileName}`;
}

// ============================================================
// Worker de enriquecimento (pendentes do workspace / conversa)
// ============================================================
export interface EnrichResult {
  scanned: number;
  enriched: number;
  errors: number;
}

// NOTA: pdf-extract continua sendo chamado via HTTP. Embora seja edge->edge,
// esse caminho ja funcionava no ghl-enrich-attachments original (eh um servico
// utilitario, nao orquestracao). Mantido identico para nao mudar comportamento.
export async function enrichPending(
  supabase: SupabaseClient,
  opts: {
    workspaceId: string;
    ghlConversationId?: string | null;
    max: number;
    aiKey: string;
    aiModel: string;
    ownerId: string;
    supabaseUrl: string;
    serviceKey: string;
    // Marco de corte: so enriquece mensagens com date_added >= notBefore.
    // Midia anterior (historico antes da entrada no 2.0) nunca e tratada.
    notBefore?: string | null;
  },
): Promise<EnrichResult> {
  // aiModel ainda aceito no tipo (callers passam), mas o enrich usa modelos
  // proprios baratos (ENRICH_*_MODEL), nao o modelo de analise.
  const { workspaceId, ghlConversationId, max, aiKey, ownerId, supabaseUrl, serviceKey, notBefore } = opts;

  let q = supabase
    .from("ghl_messages")
    .select("id, ghl_conversation_id, body, attachments_json, date_added")
    .eq("workspace_id", workspaceId)
    .not("attachments_json", "is", null)
    .is("enriched_body", null)
    .is("enrich_error", null)
    .order("date_added", { ascending: false })
    .limit(max);
  if (ghlConversationId) q = q.eq("ghl_conversation_id", ghlConversationId);
  if (notBefore) q = q.gte("date_added", notBefore);
  const { data: pending, error: pendErr } = await q;
  if (pendErr) throw pendErr;

  let enrichedCount = 0;
  let errorCount = 0;

  for (const msg of pending || []) {
    const urls = (msg.attachments_json as string[]) || [];
    if (!urls.length) continue;

    const parts: string[] = [];
    let lastErr: string | null = null;

    for (const url of urls) {
      const kind = kindFromUrl(url);
      try {
        if (kind === "image") {
          const { base64, mimetype } = await downloadAsBase64(url);
          // Modelo de visao barato e fixo (ENRICH_IMAGE_MODEL), desacoplado do
          // modelo de analise do usuario.
          parts.push(await describeImage(base64, mimetype, aiKey));
        } else if (kind === "audio") {
          const { base64, mimetype } = await downloadAsBase64(url);
          parts.push(await transcribeAudio(base64, mimetype, aiKey));
        } else if (kind === "pdf") {
          const { base64 } = await downloadAsBase64(url);
          parts.push(await extractPdf(base64, fileNameFromUrl(url), supabaseUrl, serviceKey, ownerId));
        } else if (kind === "video") {
          parts.push(`🎬 [Vídeo]: ${fileNameFromUrl(url)} (transcrição de vídeo não implementada)`);
        } else {
          parts.push(`📎 [Arquivo]: ${fileNameFromUrl(url)}`);
        }
      } catch (e) {
        lastErr = (e as Error).message || String(e);
        console.warn(`enrich falhou (${kind}) ${url.slice(0, 80)}:`, lastErr);
      }
    }

    // Adiciona o body original como caption se houver e nao for generico
    const trimmed = (msg.body || "").trim();
    const isGeneric =
      /^arquivo de \w+$/i.test(trimmed) ||
      /^\[(image|audio|video|document|sticker|file)\]$/i.test(trimmed);
    if (trimmed && !isGeneric) parts.unshift(trimmed);

    if (parts.length > 0) {
      await supabase
        .from("ghl_messages")
        .update({
          enriched_body: parts.join("\n\n"),
          enriched_at: new Date().toISOString(),
          enrich_error: null,
        })
        .eq("id", msg.id);
      enrichedCount++;
    } else if (lastErr) {
      await supabase
        .from("ghl_messages")
        .update({ enrich_error: lastErr.slice(0, 500) })
        .eq("id", msg.id);
      errorCount++;
    }
  }

  return { scanned: pending?.length ?? 0, enriched: enrichedCount, errors: errorCount };
}

// Resolve a API key + modelo da OpenAI: override por usuario (ai_provider_config
// do owner) ou fallback no env. Reusado pelo wrapper e pelo tick do cron.
// Resolve a chave/modelo de IA do owner do workspace. Cada conta DEVE ter sua
// propria chave (sem fallback de token global do sistema). Retorna aiKey vazio
// se a conta nao tiver chave configurada — o chamador decide pular/lancar.
export async function resolveAiKey(
  supabase: SupabaseClient,
  ownerId: string | null,
): Promise<{ aiKey: string; aiModel: string }> {
  let aiKey = "";
  let aiModel = "gpt-4o-mini";
  if (ownerId) {
    const { data: providerCfg } = await supabase
      .from("ai_provider_config")
      .select("provider, api_key, model")
      .eq("user_id", ownerId)
      .maybeSingle();
    if (providerCfg?.provider === "openai" && providerCfg?.api_key) {
      aiKey = providerCfg.api_key;
      aiModel = providerCfg.model || aiModel;
    }
  }
  return { aiKey, aiModel };
}
