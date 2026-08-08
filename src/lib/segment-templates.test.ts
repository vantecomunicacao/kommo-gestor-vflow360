import { describe, it, expect } from "vitest";
import {
  SEGMENT_TEMPLATES,
  applyTemplateToSettings,
} from "./segment-templates";
import { FUNNEL_BUCKETS, type FunnelBucketKey } from "./dashboard-funnel";

const clinicas = SEGMENT_TEMPLATES.find((t) => t.id === "clinicas")!;

describe("catálogo de templates", () => {
  it("tem pelo menos um template e ids únicos", () => {
    expect(SEGMENT_TEMPLATES.length).toBeGreaterThan(0);
    const ids = SEGMENT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("só usa chaves de fase válidas em stageLabels", () => {
    const valid = new Set(FUNNEL_BUCKETS.map((b) => b.key));
    for (const t of SEGMENT_TEMPLATES) {
      for (const k of Object.keys(t.stageLabels)) expect(valid.has(k as FunnelBucketKey)).toBe(true);
    }
  });

  it('usa metas no formato "<eixo>:<metricId>"', () => {
    for (const t of SEGMENT_TEMPLATES) {
      for (const key of Object.keys(t.reportGoals)) {
        expect(key).toMatch(/^(criacao|fechamento):/);
      }
    }
  });

  it("metricSuggestions (quando existe) é só dica em texto, com formato válido", () => {
    for (const t of SEGMENT_TEMPLATES) {
      for (const s of t.metricSuggestions ?? []) {
        expect(["percent", "number"]).toContain(s.format);
        expect(s.name.length).toBeGreaterThan(0);
        expect(s.hint.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("applyTemplateToSettings", () => {
  it("preenche a partir do estado vazio", () => {
    const out = applyTemplateToSettings(clinicas, {
      stageLabels: {},
      reportGoals: {},
    });
    expect(out.stageLabels.proposta_enviada).toBe("Consulta Agendada");
    expect(out.reportGoals["criacao:convGeral"]).toBe(25);
  });

  it("mescla de forma não destrutiva: chaves não cobertas pelo template sobrevivem", () => {
    const out = applyTemplateToSettings(clinicas, {
      stageLabels: { contato_inicial: "Meu rótulo custom" }, // será sobrescrito (template cobre)
      reportGoals: { "fechamento:lost": 5 }, // preservado
    });
    // template vence nas chaves que define
    expect(out.stageLabels.contato_inicial).toBe("Contato Inicial");
    // meta pré-existente de outra chave permanece
    expect(out.reportGoals["fechamento:lost"]).toBe(5);
    expect(out.reportGoals["criacao:convGeral"]).toBe(25);
  });

  it("não muta o estado de entrada", () => {
    const current = { stageLabels: {}, reportGoals: {} };
    applyTemplateToSettings(clinicas, current);
    expect(current.stageLabels).toEqual({});
    expect(current.reportGoals).toEqual({});
  });
});
