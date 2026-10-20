import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extracaoNotaSchema, type ExtracaoNota } from "../extracao/esquema-extracao";
import { dataDeCalendarioValida, validarNota } from "./validar-nota";

const DIR = "fixtures/notas";
const HOJE = "2026-10-20";

const notas = readdirSync(DIR)
  .filter((f) => f.endsWith(".esperado.json"))
  .sort()
  .map((f) => ({
    id: f.replace(".esperado.json", ""),
    extracao: extracaoNotaSchema.parse(JSON.parse(readFileSync(join(DIR, f), "utf8"))),
  }));
const nota = (id: string): ExtracaoNota => {
  const achada = notas.find((n) => n.id === id);
  if (!achada) throw new Error(`fixture ${id} não existe`);
  return achada.extracao;
};
// O modelo devolve confiança alta mesmo quando erra; é o código que reduz.
const comoDoModelo = (e: ExtracaoNota): ExtracaoNota => ({
  ...e,
  confianca_documento: 1,
  itens: e.itens.map((i) => ({ ...i, confianca: 1 })),
});

describe("validarNota com as notas da Etapa 1", () => {
  it("lê as 18 notas do gabarito", () => {
    expect(notas).toHaveLength(18);
  });

  it.each(
    notas.filter((n) => n.id !== "nota-10" && n.id !== "nota-11").map((n) => [n.id, n.extracao] as const),
  )("%s passa limpa", (_id, extracao) => {
    const r = validarNota(comoDoModelo(extracao), { hoje: HOJE });
    expect(r.motivos).toEqual([]);
    expect(r.itensParaRevisao).toEqual([]);
    expect(r.extracao.confianca_documento).toBe(1);
  });

  it("nota 10: soma diverge do total, confiança do documento cai e o motivo fica registrado", () => {
    const r = validarNota(comoDoModelo(nota("nota-10")), { hoje: HOJE });
    expect(r.motivos.map((m) => m.codigo)).toEqual(["soma_diverge_do_total"]);
    expect(r.somaItensCentavos).toBe(69640);
    expect(r.extracao.confianca_documento).toBeLessThan(0.8);
    expect(r.extracao.total_centavos).toBe(70880);
  });

  it("nota 11: o item pouco legível vai para revisão e o documento não é descartado", () => {
    const r = validarNota(nota("nota-11"), { hoje: HOJE });
    // O manifesto conta os itens a partir de 0, a validação a partir de 1.
    const manifesto = JSON.parse(readFileSync(join(DIR, "manifesto.json"), "utf8")) as Array<{
      id: string;
      itens_confianca_baixa: number[];
    }>;
    const esperados = manifesto.find((n) => n.id === "nota-11")?.itens_confianca_baixa.map((i) => i + 1);
    expect(esperados).toHaveLength(1);
    expect(r.itensParaRevisao).toEqual(esperados);
    expect(r.motivos).toEqual([]);
  });
});

describe("validarNota: conferências", () => {
  const base = nota("nota-01");

  it("aceita diferença de poucos centavos na soma", () => {
    const r = validarNota({ ...base, total_centavos: base.total_centavos + 5 }, { hoje: HOJE });
    expect(r.motivos).toEqual([]);
    expect(
      validarNota({ ...base, total_centavos: base.total_centavos + 6 }, { hoje: HOJE }).motivos,
    ).toHaveLength(1);
  });

  it("quantidade x unitário que não bate reduz só aquele item", () => {
    const itens = base.itens.map((i, n) =>
      n === 0 ? { ...i, valor_total_centavos: i.valor_total_centavos + 100 } : i,
    );
    const r = validarNota({ ...base, itens, total_centavos: base.total_centavos + 100 }, { hoje: HOJE });
    expect(r.motivos).toEqual([expect.objectContaining({ codigo: "item_nao_confere", item: 1 })]);
    expect(r.itensParaRevisao).toEqual([1]);
    expect(r.extracao.itens[1]?.confianca).toBe(base.itens[1]?.confianca);
  });

  it("aceita quantidade fracionária com arredondamento de 1 centavo", () => {
    const item = {
      descricao: "QUEIJO",
      quantidade: 0.333,
      unidade: "KG",
      valor_unitario_centavos: 3999,
      valor_total_centavos: 1332,
      confianca: 1,
    };
    const r = validarNota({ ...base, itens: [item], total_centavos: 1332 }, { hoje: HOJE });
    expect(r.motivos).toEqual([]);
  });

  it("CNPJ com dígito verificador errado reduz a confiança do documento", () => {
    const r = validarNota(
      { ...base, fornecedor: { ...base.fornecedor, cnpj: "11111111000100" } },
      { hoje: HOJE },
    );
    expect(r.motivos.map((m) => m.codigo)).toEqual(["cnpj_invalido"]);
    expect(r.extracao.confianca_documento).toBeLessThan(0.8);
  });

  it.each([
    ["2026-10-21", "data_futura"],
    ["2025-10-18", "data_antiga"],
    ["2026-02-31", "data_invalida"],
  ])("data %s vira %s", (data, codigo) => {
    const r = validarNota({ ...base, data_emissao: data }, { hoje: HOJE });
    expect(r.motivos.map((m) => m.codigo)).toEqual([codigo]);
    expect(r.extracao.confianca_documento).toBeLessThan(0.8);
  });

  it("aceita hoje e a data mais antiga plausível", () => {
    expect(validarNota({ ...base, data_emissao: HOJE }, { hoje: HOJE }).motivos).toEqual([]);
    expect(validarNota({ ...base, data_emissao: "2025-10-19" }, { hoje: HOJE }).motivos).toEqual([]);
  });

  it("não altera a entrada e respeita o limite configurado", () => {
    const antes = structuredClone(base);
    const r = validarNota(
      {
        ...base,
        itens: [{ ...base.itens[0]!, confianca: 0.7 }],
        total_centavos: base.itens[0]!.valor_total_centavos,
      },
      { hoje: HOJE, limiteConfiancaItem: 0.6 },
    );
    expect(r.itensParaRevisao).toEqual([]);
    expect(base).toEqual(antes);
  });
});

describe("dataDeCalendarioValida", () => {
  it("aceita datas que existem, inclusive 29 de fevereiro de ano bissexto", () => {
    expect(dataDeCalendarioValida("2026-10-15")).toBe(true);
    expect(dataDeCalendarioValida("2028-02-29")).toBe(true);
  });

  it("recusa datas bem formadas que não existem no calendário", () => {
    expect(dataDeCalendarioValida("2026-02-31")).toBe(false);
    expect(dataDeCalendarioValida("2026-02-29")).toBe(false);
    expect(dataDeCalendarioValida("2026-13-01")).toBe(false);
    expect(dataDeCalendarioValida("2026-00-10")).toBe(false);
  });
});
