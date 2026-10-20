import { readFileSync } from "node:fs";
import type { Armazenamento } from "../infra/armazenamento/armazenamento";
import type { Db } from "../infra/database/database.module";
import { RegistroExecucoesMemoria } from "../agente/execucao/registro-execucoes";
import type { ExtratorNotas } from "./extracao/extrator-notas";
import type { ExtracaoNota } from "./extracao/esquema-extracao";
import { ProcessadorExtracao } from "./processador-extracao";

const extracao = JSON.parse(readFileSync("fixtures/notas/nota-01.esperado.json", "utf8")) as ExtracaoNota;
const entrada = {
  documentoId: "11111111-1111-4111-8111-111111111111",
  comercianteId: "22222222-2222-4222-8222-222222222222",
};

/** Banco falso: o documento existe e a transação da gravação sempre cai, como num erro de conexão. */
function montar() {
  const atualizacoes: Array<Record<string, unknown>> = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ statusExtracao: "pendente", arquivoCaminho: "x/y.jpg" }]),
        }),
      }),
    }),
    update: () => ({
      set: (valores: Record<string, unknown>) => {
        atualizacoes.push(valores);
        return { where: () => Promise.resolve() };
      },
    }),
    transaction: () => Promise.reject(new Error("conexão perdida")),
  } as unknown as Db;
  const extrator = {
    extrair: () =>
      Promise.resolve({
        ok: true,
        extracao,
        consumo: { entrada: 1, saida: 1, cacheLeitura: 0, cacheEscrita: 0 },
        tentativas: 1,
        latenciaMs: 1,
        modelo: "claude-sonnet-5-5",
        versaoPrompt: "extrator-v1",
      }),
  } as unknown as ExtratorNotas;
  const armazenamento = { ler: () => Promise.resolve(Buffer.from("foto")) } as unknown as Armazenamento;
  const registro = new RegistroExecucoesMemoria();
  const processador = new ProcessadorExtracao({
    db,
    armazenamento,
    extrator,
    registro,
    limiteConfiancaItem: 0.8,
    limiteSimilaridade: 0.5,
    modeloConfigurado: "claude-sonnet-5-5",
    hoje: () => "2026-10-20",
  });
  return { processador, atualizacoes };
}

describe("ProcessadorExtracao: falha depois da chamada ao modelo", () => {
  it("antes da última tentativa, a exceção sobe para o BullMQ repetir", async () => {
    const { processador, atualizacoes } = montar();
    await expect(processador.processar(entrada, false)).rejects.toThrow("conexão perdida");
    expect(atualizacoes.map((a) => a.statusExtracao)).toEqual(["processando"]);
  });

  it("na última tentativa, o documento vira falha em vez de ficar em processando", async () => {
    const { processador, atualizacoes } = montar();
    await expect(processador.processar(entrada, true)).resolves.toEqual({ status: "falha" });
    expect(atualizacoes.at(-1)).toMatchObject({
      statusExtracao: "falha",
      erro: "erro_gravacao: conexão perdida",
    });
  });
});
