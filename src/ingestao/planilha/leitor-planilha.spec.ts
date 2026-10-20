import { readFileSync } from "node:fs";
import { lerCsv, lerPlanilha, lerXlsx } from "./leitor-planilha";

const csv = readFileSync("fixtures/mercadinho/vendas.csv");
const xlsx = readFileSync("fixtures/mercadinho/vendas.xlsx");

describe("leitor de planilha", () => {
  it("lê o CSV do PDV: separador ';', cabeçalho e 11.365 linhas de item", () => {
    const p = lerCsv(csv);
    expect(p.cabecalhos).toEqual([
      "Data",
      "Hora",
      "Cupom",
      "Código de barras",
      "Produto",
      "Qtd",
      "Preço unit. (R$)",
      "Total (R$)",
    ]);
    expect(p.linhas).toHaveLength(11_365);
    expect(p.linhas[0]).toEqual([
      "20/08/2026",
      "07:15",
      "100001",
      "2990000000392",
      "Biscoito recheado chocolate 120g",
      "1",
      "2,79",
      "2,79",
    ]);
  });

  it("lê o XLSX com as mesmas linhas, com data em AAAA-MM-DD e números como texto", async () => {
    const p = await lerXlsx(xlsx);
    expect(p.cabecalhos).toEqual(lerCsv(csv).cabecalhos);
    expect(p.linhas).toHaveLength(11_365);
    expect(p.linhas[0]).toEqual([
      "2026-08-20",
      "07:15",
      "100001",
      "2990000000392",
      "Biscoito recheado chocolate 120g",
      "1",
      "2.79",
      "2.79",
    ]);
  });

  it("detecta vírgula e tabulação como separador, e ignora BOM e linhas em branco", () => {
    expect(lerCsv(Buffer.from("﻿data,produto\n01/01/2026,Arroz\n\n")).linhas).toEqual([
      ["01/01/2026", "Arroz"],
    ]);
    expect(lerCsv(Buffer.from("data\tproduto\n01/01/2026\tArroz\n")).cabecalhos).toEqual(["data", "produto"]);
  });

  it("tolera linha com menos colunas que o cabeçalho", () => {
    expect(lerCsv(Buffer.from("a;b;c\n1;2\n")).linhas).toEqual([["1", "2"]]);
  });

  it("escolhe o leitor pelo tipo", async () => {
    expect((await lerPlanilha(csv, "csv")).linhas).toHaveLength(11_365);
    expect((await lerPlanilha(xlsx, "xlsx")).linhas).toHaveLength(11_365);
  });

  it("recusa XLSX corrompido com erro claro", async () => {
    await expect(lerXlsx(Buffer.from("isto não é um zip"))).rejects.toThrow(/XLSX ilegível/);
  });
});
