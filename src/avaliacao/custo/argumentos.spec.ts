import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ErroDeCusto } from "./amostras";
import {
  inteiroPositivo,
  maisRecente,
  microdolaresDe,
  PADRAO_AGENTE_REAL,
  PADRAO_EXTRACAO_REAL,
} from "./argumentos";

describe("microdolaresDe", () => {
  it.each([
    ["0.0068", 6_800],
    ["0,0068", 6_800],
    ["460", 460_000_000],
    ["1.5", 1_500_000],
    ["0.000001", 1],
  ])("%s dólares valem %d micro-dólares, sem ponto flutuante", (texto, esperado) => {
    expect(microdolaresDe(texto, "--x")).toBe(esperado);
  });

  it.each(["", "abc", "-1", "1.2345678", "1e3"])("recusa %j", (texto) => {
    expect(() => microdolaresDe(texto, "--x")).toThrow(ErroDeCusto);
  });
});

describe("inteiroPositivo", () => {
  it("aceita inteiro maior que zero e recusa o resto", () => {
    expect(inteiroPositivo("14", "--notas")).toBe(14);
    for (const t of ["0", "-3", "1.5", "x"]) expect(() => inteiroPositivo(t, "--notas")).toThrow(ErroDeCusto);
  });
});

describe("maisRecente", () => {
  it("pega a saída real mais nova de cada tipo e ignora a falsa e a de outro tipo", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "custo-"));
    try {
      for (const n of [
        "2026-10-21-eval-falso-100.json",
        "2026-10-21-eval-real-100.json",
        "2026-10-21-eval-real-2100.json",
        "2026-10-20-eval-real-999.json",
        "2026-10-21-eval-extracao-real-100.json",
        "2026-10-21-eval-extracao-falso-300.json",
      ]) {
        writeFileSync(path.join(dir, n), "{}");
      }
      expect(path.basename(maisRecente(dir, PADRAO_AGENTE_REAL) ?? "")).toBe(
        "2026-10-21-eval-real-2100.json",
      );
      expect(path.basename(maisRecente(dir, PADRAO_EXTRACAO_REAL) ?? "")).toBe(
        "2026-10-21-eval-extracao-real-100.json",
      );
      expect(maisRecente(path.join(dir, "nao-existe"), PADRAO_AGENTE_REAL)).toBeNull();
      mkdirSync(path.join(dir, "vazio"));
      expect(maisRecente(path.join(dir, "vazio"), PADRAO_AGENTE_REAL)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
