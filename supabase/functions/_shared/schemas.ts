// Schemas zod do body das edge functions kommo-dashboard e kommo-report-snapshot.
// Espelham EXATAMENTE a validação manual que existia antes (mesmos defaults
// tolerantes) — o objetivo é ter uma única definição por function, não apertar a
// validação. Ver docs/plano-filtros-dashboard.md § "Fase 6".
import { z } from "https://esm.sh/zod@3.23.8";

// Aceita string única OU array (compat com chamadas antigas que mandavam string) e
// sempre normaliza pra array de strings não-vazias.
const stringArray = z.preprocess(
  (v) => (Array.isArray(v) ? v.filter((s) => typeof s === "string" && s) : []),
  z.array(z.string()),
);
const pipelineIdField = z.preprocess((v) => {
  if (Array.isArray(v)) return v.filter((s) => typeof s === "string" && s);
  if (typeof v === "string" && v) return [v];
  return [];
}, z.array(z.string()));
const nullableString = z.preprocess((v) => (typeof v === "string" && v ? v : null), z.string().nullable());
const dateBasisField = z.preprocess((v) => (v === "fechamento" ? "fechamento" : "criacao"), z.enum(["criacao", "fechamento"]));

export const KommoDashboardPayloadSchema = z.object({
  workspace_id: z.string().min(1),
  startDate: nullableString,
  endDate: nullableString,
  dateBasis: dateBasisField,
  additionalStartDate: nullableString,
  additionalEndDate: nullableString,
  pipelineId: pipelineIdField,
  stageIds: stringArray,
  sellerIds: stringArray,
  utmMedium: stringArray,
  utmCampaign: stringArray,
  origin: stringArray,
});
export type KommoDashboardPayload = z.infer<typeof KommoDashboardPayloadSchema>;

export const KommoReportSnapshotPayloadSchema = z.object({
  workspace_id: z.string().min(1),
  // Clamp tolerante (não integer-only, igual ao comportamento manual anterior).
  months: z.preprocess(
    (v) => (Number.isFinite(v) ? Math.max(1, Math.min(36, Number(v))) : 12),
    z.number().min(1).max(36),
  ),
});
export type KommoReportSnapshotPayload = z.infer<typeof KommoReportSnapshotPayloadSchema>;
