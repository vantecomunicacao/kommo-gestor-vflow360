import { describe, it, expect } from "vitest";
import { fmtValue, trendClass, pctChange, aggregateBySellers, buildReachCatalog, buildCustomRateCatalog, shiftMonthKey, resolveComparisonValue } from "./reports-metrics";
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
  it("prev negativo: usa abs(prev) no denominador", () => {
    // curr=-50, prev=-100: (curr-prev)/|prev| = 50/100 = +50% (o valor subiu, mesmo
    // que ambos sejam negativos — a leitura do sinal cabe a quem interpreta, via `invert`).
    expect(pctChange(-50, -100)).toBe("+50%");
  });
});

function metrics(overrides: Partial<ReportMetrics> = {}): ReportMetrics {
  return { leads: 0, won: 0, wonRevenue: 0, lost: 0, lostRevenue: 0, ticket: 0, winRate: 0, ...overrides };
}
function month(m: string, metricsVal: ReportMetrics): ReportMonth {
  return { month: m, isPartial: false, frozenAt: "2026-08-01T00:00:00Z", locked: false, metrics: metricsVal };
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

  it("preserva reached (ordem/labels da célula agregada) ao filtrar por vendedor, recalculando só o count", () => {
    const raw = [month("2026-07-01", metrics({
      leads: 10,
      // Ordem/labels de referência (célula agregada, todos os vendedores).
      reached: [
        { id: "proposta_enviada", label: "Proposta Enviada", count: 7 },
        { id: "contato_inicial", label: "Contato Inicial", count: 9 },
      ],
      bySeller: {
        // Sub-blocos em ORDEM DIFERENTE da célula agregada — não deve importar.
        s1: metrics({
          leads: 6, won: 2, wonRevenue: 2000,
          reached: [
            { id: "contato_inicial", label: "Contato Inicial", count: 5 },
            { id: "proposta_enviada", label: "Proposta Enviada", count: 4 },
          ],
        }),
        s2: metrics({
          leads: 4, won: 1, wonRevenue: 1000,
          reached: [{ id: "proposta_enviada", label: "Proposta Enviada", count: 2 }],
          // s2 nunca teve nenhum lead em "contato_inicial" — id ausente no seu reached.
        }),
      },
    }))];
    const out = aggregateBySellers(raw, ["s1", "s2"]);
    // Ordem/labels seguem a célula agregada (não a ordem dos sub-blocos).
    expect(out[0].metrics.reached).toEqual([
      { id: "proposta_enviada", label: "Proposta Enviada", count: 6 }, // 4 (s1) + 2 (s2)
      { id: "contato_inicial", label: "Contato Inicial", count: 5 },   // só s1
    ]);
  });

  it("reached ausente na célula agregada (eixo fechamento) permanece undefined", () => {
    const raw = [month("2026-07-01", metrics({
      bySeller: { s1: metrics({ leads: 5, won: 2, wonRevenue: 200 }) },
    }))];
    const out = aggregateBySellers(raw, ["s1"]);
    expect(out[0].metrics.reached).toBeUndefined();
  });

  it("customRates: soma passed/base dos vendedores selecionados, preservando ordem/nome da célula agregada", () => {
    const raw = [month("2026-07-01", metrics({
      leads: 10,
      customRates: [{ id: "no-show", name: "Taxa de No Show", format: "percent", passed: 3, base: 8 }],
      bySeller: {
        s1: metrics({ leads: 6, customRates: [{ id: "no-show", name: "Taxa de No Show", format: "percent", passed: 2, base: 5 }] }),
        s2: metrics({ leads: 4, customRates: [{ id: "no-show", name: "Taxa de No Show", format: "percent", passed: 1, base: 3 }] }),
      },
    }))];
    const out = aggregateBySellers(raw, ["s1", "s2"]);
    expect(out[0].metrics.customRates).toEqual([
      { id: "no-show", name: "Taxa de No Show", format: "percent", passed: 3, base: 8 },
    ]);
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

describe("buildCustomRateCatalog", () => {
  it("eixo fechamento: nunca gera métricas personalizadas (só safra por criação)", () => {
    const raw = [month("2026-07-01", metrics({
      customRates: [{ id: "no-show", name: "Taxa de No Show", format: "percent", passed: 3, base: 8 }],
    }))];
    expect(buildCustomRateCatalog("fechamento", raw)).toEqual([]);
  });

  it("eixo criacao sem customRates: array vazio", () => {
    const raw = [month("2026-07-01", metrics({}))];
    expect(buildCustomRateCatalog("criacao", raw)).toEqual([]);
  });

  it("format 'percent': value = passed/base * 100, 'sem base' vira 0", () => {
    const raw = [month("2026-07-01", metrics({
      customRates: [{ id: "no-show", name: "Taxa de No Show", format: "percent", passed: 3, base: 12 }],
    }))];
    const out = buildCustomRateCatalog("criacao", raw);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("custom:no-show");
    expect(out[0].fmt).toBe("pct");
    expect(out[0].value(raw[0].metrics)).toBe(25); // 3/12*100
    expect(out[0].value(metrics({ customRates: [{ id: "no-show", name: "x", format: "percent", passed: 5, base: 0 }] }))).toBe(0);
  });

  it("format 'number': value = passed (contagem direta, sem razão)", () => {
    const raw = [month("2026-07-01", metrics({
      customRates: [{ id: "atendidos", name: "Atendidos", format: "number", passed: 42, base: 0 }],
    }))];
    const out = buildCustomRateCatalog("criacao", raw);
    expect(out[0].fmt).toBe("num");
    expect(out[0].value(raw[0].metrics)).toBe(42);
  });
});

describe("shiftMonthKey", () => {
  it("desloca dentro do mesmo ano", () => {
    expect(shiftMonthKey("2026-08-01", -1)).toBe("2026-07-01");
    expect(shiftMonthKey("2026-08-01", 1)).toBe("2026-09-01");
  });
  it("vira o ano pra trás (janeiro -1 mês)", () => {
    expect(shiftMonthKey("2026-01-01", -1)).toBe("2025-12-01");
  });
  it("vira o ano pra frente (dezembro +1 mês)", () => {
    expect(shiftMonthKey("2025-12-01", 1)).toBe("2026-01-01");
  });
  it("12 meses atrás (YoY)", () => {
    expect(shiftMonthKey("2026-08-01", -12)).toBe("2025-08-01");
  });
});

describe("resolveComparisonValue", () => {
  const val = (m: ReportMetrics) => m.leads;

  it("mode 'none': sempre null, mesmo com dado disponível", () => {
    const raw = [month("2026-07-01", metrics({ leads: 10 })), month("2026-08-01", metrics({ leads: 20 }))];
    expect(resolveComparisonValue(raw, "2026-08-01", "none", val)).toBeNull();
  });

  it("mode 'previous': acha o mês anterior por calendário, não por índice do array", () => {
    // A série completa tem o mês anterior mesmo que o "recorte visível" não tivesse.
    const raw = [month("2026-07-01", metrics({ leads: 10 })), month("2026-08-01", metrics({ leads: 20 }))];
    expect(resolveComparisonValue(raw, "2026-08-01", "previous", val)).toBe(10);
  });

  it("mode 'previous': sem o mês anterior na série, retorna null (não 'novo' nem 0)", () => {
    const raw = [month("2026-08-01", metrics({ leads: 20 }))];
    expect(resolveComparisonValue(raw, "2026-08-01", "previous", val)).toBeNull();
  });

  it("mode 'yoy': acha o mesmo mês do ano anterior", () => {
    const raw = [month("2025-08-01", metrics({ leads: 7 })), month("2026-08-01", metrics({ leads: 20 }))];
    expect(resolveComparisonValue(raw, "2026-08-01", "yoy", val)).toBe(7);
  });

  it("mode 'yoy': sem o mês do ano anterior, retorna null", () => {
    const raw = [month("2026-08-01", metrics({ leads: 20 }))];
    expect(resolveComparisonValue(raw, "2026-08-01", "yoy", val)).toBeNull();
  });

  it("mode 'movavg3': média dos 3 meses anteriores quando todos presentes", () => {
    const raw = [
      month("2026-05-01", metrics({ leads: 10 })),
      month("2026-06-01", metrics({ leads: 20 })),
      month("2026-07-01", metrics({ leads: 30 })),
      month("2026-08-01", metrics({ leads: 99 })),
    ];
    expect(resolveComparisonValue(raw, "2026-08-01", "movavg3", val)).toBe(20); // (10+20+30)/3
  });

  it("movavg3 com só 2 dos 3 meses presentes: null, não média parcial", () => {
    const raw = [
      month("2026-06-01", metrics({ leads: 20 })),
      month("2026-07-01", metrics({ leads: 30 })),
      month("2026-08-01", metrics({ leads: 99 })),
    ];
    expect(resolveComparisonValue(raw, "2026-08-01", "movavg3", val)).toBeNull();
  });
});
