// Funções puras do kommo-dashboard, extraídas pra um arquivo sem `serve()` (ou
// qualquer outro efeito colateral no nível do módulo) de propósito: importar
// index.ts pra testar essas funções executaria o handler HTTP inteiro. Extração
// mecânica — mesmo código, sem mudança de lógica (Fase 4 do plano de
// remediação, 2026-08). Testadas em pure.test.ts.

export type Bucket = "contato_inicial" | "proposta_enviada" | "fechamento" | "venda_ganha";

export interface KommoStatus { id: string; name: string; sort?: number; type?: number; }

/**
 * Infere a fase do funil (Bucket) pelo NOME da etapa quando não há mapeamento
 * configurado (`kommo.dashboard_settings.funnel_stage_mapping`) — ver uso em
 * `bucketOf`/`fallbackByStage` no handler (index.ts).
 */
export function inferFunnelMapping(stages: KommoStatus[]): Record<Bucket, string[]> {
  const out: Record<Bucket, string[]> = { contato_inicial: [], proposta_enviada: [], fechamento: [], venda_ganha: [] };
  for (const s of stages) {
    const id = String(s.id);
    if (id === "142") { out.venda_ganha.push(id); continue; }
    if (id === "143") continue; // perdido nunca entra no funil
    const n = (s.name || "").toLowerCase();
    if (/(ganho|ganha|won|venda)/.test(n)) out.venda_ganha.push(id);
    else if (/(fechamento|closing|negocia|proposta enviada)/.test(n)) out.fechamento.push(id);
    else if (/(proposta|proposal|enviar|oferta|reuni)/.test(n)) out.proposta_enviada.push(id);
    else out.contato_inicial.push(id);
  }
  if (!out.venda_ganha.includes("142")) out.venda_ganha.push("142");
  return out;
}

/** Extrai valor de um custom field de lead (array custom_fields_values) por code/id. */
export function extractCf(cfv: any, codeOrId: string | null): string | null {
  if (!codeOrId || !Array.isArray(cfv)) return null;
  for (const f of cfv) {
    if (String(f?.field_code ?? "") === codeOrId || String(f?.field_id ?? "") === codeOrId) {
      const vals = (f?.values ?? []).map((v: any) => v?.value).filter((v: any) => v != null && String(v).trim() !== "");
      return vals.length ? vals.join(", ") : null;
    }
  }
  return null;
}

/** Valor de um custom field do tipo DATA como Date (Kommo grava unix em segundos). */
export function extractCfDate(cfv: any, codeOrId: string | null): Date | null {
  const vals = extractCfValues(cfv, codeOrId);
  if (!vals.length) return null;
  const n = Number(vals[0]);
  if (!Number.isFinite(n)) {
    const d = new Date(vals[0]);
    return isNaN(d.getTime()) ? null : d;
  }
  // unix em segundos (Kommo) → ms
  return new Date(n * 1000);
}

/** Como extractCf, mas devolve cada valor individualmente (p/ multiselect e distribuição). */
export function extractCfValues(cfv: any, codeOrId: string | null): string[] {
  if (!codeOrId || !Array.isArray(cfv)) return [];
  for (const f of cfv) {
    if (String(f?.field_code ?? "") === codeOrId || String(f?.field_id ?? "") === codeOrId) {
      return (f?.values ?? [])
        .map((v: any) => v?.value)
        .filter((v: any) => v != null && String(v).trim() !== "")
        .map((v: any) => String(v));
    }
  }
  return [];
}
