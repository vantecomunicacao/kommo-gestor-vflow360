import { describe, it, expect } from "vitest";
import { calcTrend, invertTrend, winRate, ticketAverage } from "./dashboard-metrics";

describe("calcTrend", () => {
  it("sobe para 100% quando prev=0 e cur>0", () => {
    expect(calcTrend(5, 0)).toEqual({ value: 100, isPositive: true });
  });

  it("sem tendência quando prev=0 e cur=0", () => {
    expect(calcTrend(0, 0)).toBeUndefined();
  });

  it("trata variação menor que 0.1% como ruído (undefined)", () => {
    // 1000 → 1000.9 = +0.09% < 0.1
    expect(calcTrend(1000.9, 1000)).toBeUndefined();
  });

  it("marca alta como positiva com valor arredondado a 1 casa", () => {
    // 100 → 112.34 = +12.34% → 12.3
    expect(calcTrend(112.34, 100)).toEqual({ value: 12.3, isPositive: true });
  });

  it("marca queda como negativa com valor absoluto", () => {
    // 200 → 150 = -25%
    expect(calcTrend(150, 200)).toEqual({ value: 25, isPositive: false });
  });

  it("dobrar o valor = +100%", () => {
    expect(calcTrend(20, 10)).toEqual({ value: 100, isPositive: true });
  });
});

describe("invertTrend", () => {
  it("mantém undefined", () => {
    expect(invertTrend(undefined)).toBeUndefined();
  });

  it("queda vira leitura positiva (bom perder menos)", () => {
    expect(invertTrend({ value: 30, isPositive: false })).toEqual({ value: 30, isPositive: true });
  });

  it("alta vira leitura negativa (ruim perder mais)", () => {
    expect(invertTrend({ value: 30, isPositive: true })).toEqual({ value: 30, isPositive: false });
  });
});

describe("winRate", () => {
  it("0 quando não houve fechamentos", () => {
    expect(winRate(0, 0)).toBe(0);
  });

  it("100% quando só houve ganhos", () => {
    expect(winRate(10, 0)).toBe(100);
  });

  it("proporção correta de ganhos sobre o total fechado", () => {
    expect(winRate(3, 1)).toBe(75);
  });
});

describe("ticketAverage", () => {
  it("0 quando não houve vendas", () => {
    expect(ticketAverage(0, 0)).toBe(0);
    expect(ticketAverage(1000, 0)).toBe(0);
  });

  it("divide receita pela quantidade de vendas", () => {
    expect(ticketAverage(1000, 4)).toBe(250);
  });
});
