import { describe, it, expect } from "vitest";
import { fmtValue, trendClass, pctChange, aggregateBySellers, buildReachCatalog } from "./reports-metrics";
import type { ReportMonth, ReportMetrics } from "@/hooks/useReportSnapshots";

describe("fmtValue", () => {
  it("formata BRL", () => {
    expect(fmtValue(1234.5, "brl")).toContain("1.23");
    expect(fmtValue(1234.5, "brl")).toContain("R$");
  });
  it("formata percentual com 1 casa", () => {
    expect(fmtValue(12.345, "pct")).toBe("12.3%");
  });
  it("formata número com separador pt-BR", () => {
    expect(fmtValue(1234567, "num")).toBe("1.234.567");
  });
});

describe("trendClass", () => {
  it("sem variação: neutro", () => {
    expect(trendClass(10, 10)).toBe("text-muted-foreground");
  });
  it("subiu, sem invert: positivo", () => {
    expect(trendClass(20, 10)).toBe("text-success");
  });
  it("subiu, com invert (ex.: perdas): negativo", () => {
    expect(trendClass(20, 10, true)).toBe("text-destructive");
  });
  it("caiu, com invert (ex.: perdas): positivo", () => {
    expect(trendClass(5, 10, true)).toBe("text-success");
  });
});

describe("pctChange", () => {
  it("prev=0 e curr>0: 'novo'", () => {
    expect(pctChange(5, 0)).toBe("novo");
  });
  it("prev=0 e curr=0: traço", () => {
    expect(pctChange(0, 0)).toBe("—");
  });
  it("variação abaixo de 0.1% vira 0%", () => {
    expect(pctChange(100.05, 100)).toBe("0%");
  });
  it("alta com sinal +", () => {
    expect(pctChange(150, 100)).toBe("+50%");
  });
  it("queda sem sinal + (já vem negativo)", () => {
    expect(pctChange(50, 100)).toBe("-50%");
  });
});

function metrics(overrides: Partial<ReportMetrics> = {}): ReportMetrics {
  return { leads: 0, won: 0, wonRevenue: 0, lost: 0, lostRevenue: 0, ticket: 0, winRate: 0, ...overrides };
}
function month(m: string, metricsVal: ReportMetrics): ReportMonth {
  return { month: m, isPartial: false, frozenAt: "2026-08-01T00:00:00Z", metrics: metricsVal };
}

describe("aggregateBySellers", () => {
  it("sellerIds vazio: devolve rawMonths sem alterar", () => {
    const raw = [month("2026-07-01", metrics({ leads: 10 }))];
    expect(aggregateBySellers(raw, [])).toBe(raw);
  });

  it("soma os sub-blocos dos vendedores selecionados e recalcula ticket/winRate", () => {
    const raw = [month("2026-07-01", metrics({
      leads: 10, won: 4, wonRevenue: 4000, lost: 1, lostRevenue: 500,
      bySeller: {
        s1: metrics({ leads: 6, won: 3, wonRevenue: 3000, lost: 1, lostRevenue: 500 }),
        s2: metrics({ leads: 4, won: 1, wonRevenue: 1000, lost: 0, lostRevenue: 0 }),
      },
    }))];
    const out = aggregateBySellers(raw, ["s1"]);
    expect(out[0].metrics.leads).toBe(6);
    expect(out[0].metrics.won).toBe(3);
    expect(out[0].metrics.wonRevenue).toBe(3000);
    expect(out[0].metrics.ticket).toBe(1000); // 3000/3
    expect(out[0].metrics.winRate).toBe(75); // 3/(3+1)*100
  });

  it("vendedor sem sub-bloco naquele mês é ignorado (não quebra)", () => {
    const raw = [month("2026-07-01", metrics({ bySeller: { s1: metrics({ leads: 5, won: 2, wonRevenue: 200 }) } }))];
    const out = aggregateBySellers(raw, ["s1", "s-inexistente"]);
    expect(out[0].metrics.leads).toBe(5);
  });
});

describe("buildReachCatalog", () => {
  it("eixo fechamento: devolve só o catálogo base, sem taxas de etapa", () => {
    const out = buildReachCatalog("fechamento", []);
    expect(out.every((m) => !m.id.startsWith("reach:") && !m.id.startsWith("count:"))).toBe(true);
  });

  it("eixo criacao sem meses com 'reached': só o catálogo base", () => {
    const raw = [month("2026-07-01", metrics({ reached: [] }))];
    const out = buildReachCatalog("criacao", raw);
    expect(out.every((m) => !m.id.startsWith("reach:"))).toBe(true);
  });

  it("eixo criacao: gera count+taxa por etapa alcançada, exceto 'fechamento' (só count)", () => {
    const raw = [month("2026-07-01", metrics({
      leads: 10,
      reached: [
        { id: "contato_inicial", label: "Contato Inicial", count: 10 },
        { id: "fechamento", label: "Fechamento", count: 3 },
      ],
    }))];
    const out = buildReachCatalog("criacao", raw);
    const ids = out.map((m) => m.id);
    expect(ids).toContain("count:contato_inicial");
    expect(ids).toContain("reach:contato_inicial");
    expect(ids).toContain("count:fechamento");
    expect(ids).not.toContain("reach:fechamento");
  });

  it("usa o mês mais recente com dados em 'reached' (ignora meses vazios no fim da lista)", () => {
    const raw = [
      month("2026-06-01", metrics({ leads: 5, reached: [{ id: "contato_inicial", label: "Contato Inicial", count: 5 }] })),
      month("2026-07-01", metrics({ leads: 0, reached: [] })),
    ];
    const out = buildReachCatalog("criacao", raw);
    expect(out.map((m) => m.id)).toContain("count:contato_inicial");
  });
});
