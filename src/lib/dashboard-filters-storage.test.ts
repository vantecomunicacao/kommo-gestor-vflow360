import { describe, it, expect } from "vitest";
import { filtersStorageKey, parseCsvParam, parseCustomFiltersParam, parseLocalDateParam } from "./dashboard-filters-storage";

describe("filtersStorageKey", () => {
  it("gera uma chave por workspace", () => {
    expect(filtersStorageKey("ws1")).toBe("dashboard:filters:ws1");
  });
});

describe("parseCsvParam", () => {
  it("null vira array vazio", () => {
    expect(parseCsvParam(null)).toEqual([]);
  });
  it("string vazia vira array vazio", () => {
    expect(parseCsvParam("")).toEqual([]);
  });
  it("separa por vírgula e filtra vazios", () => {
    expect(parseCsvParam("a,b,,c")).toEqual(["a", "b", "c"]);
  });
});

describe("parseCustomFiltersParam", () => {
  it("null vira objeto vazio", () => {
    expect(parseCustomFiltersParam(null)).toEqual({});
  });
  it("JSON inválido vira objeto vazio (não lança)", () => {
    expect(parseCustomFiltersParam("{not json")).toEqual({});
  });
  it("array no lugar de objeto vira objeto vazio", () => {
    expect(parseCustomFiltersParam(JSON.stringify(["a", "b"]))).toEqual({});
  });
  it("parseia objeto de arrays de string, filtrando entradas não-array e não-string", () => {
    const raw = JSON.stringify({ f1: ["a", "b"], f2: "não-array", f3: [1, "c", null] });
    expect(parseCustomFiltersParam(raw)).toEqual({ f1: ["a", "b"], f3: ["c"] });
  });
});

describe("parseLocalDateParam", () => {
  it("preserva o dia informado no calendário LOCAL, independente do fuso (achado 2026-08-06)", () => {
    const d = parseLocalDateParam("2026-07-31");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // julho = índice 6
    expect(d.getDate()).toBe(31);
    expect(d.getHours()).toBe(0);
  });

  it("round-trip com date-fns format('yyyy-MM-dd') devolve a mesma string (não muda de dia)", async () => {
    const { format } = await import("date-fns");
    for (const iso of ["2026-01-01", "2026-12-31", "2026-07-31"]) {
      expect(format(parseLocalDateParam(iso), "yyyy-MM-dd")).toBe(iso);
    }
  });
});
