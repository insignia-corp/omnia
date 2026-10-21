import { Logger } from "@nestjs/common";
import type Redis from "ioredis";
import type { Job } from "bullmq";
import { FilaExtracao, type AposExtracao, type JobExtracao } from "./fila-extracao";
import type { ProcessadorExtracao, ResultadoProcessamento } from "../processador-extracao";

// A fila e o worker reais precisam de Redis: aqui só importa o que `tratar` faz com o resultado.
jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), close: jest.fn() })),
  Worker: jest.fn(),
}));

const job = (data: JobExtracao): Job<JobExtracao> =>
  ({ data, attemptsStarted: 1, opts: { attempts: 3 } }) as unknown as Job<JobExtracao>;

function criar(resultado: ResultadoProcessamento, gancho?: AposExtracao) {
  const processar = jest.fn().mockResolvedValue(resultado);
  const fila = new FilaExtracao({} as Redis, { processar } as unknown as ProcessadorExtracao, gancho);
  return { fila, processar };
}

const tratar = (fila: FilaExtracao, j: Job<JobExtracao>): Promise<ResultadoProcessamento> =>
  (fila as unknown as { tratar(j: Job<JobExtracao>): Promise<ResultadoProcessamento> }).tratar(j);

const DADOS: JobExtracao = { documentoId: "doc-1", comercianteId: "c-1" };

describe("FilaExtracao: gancho após a extração", () => {
  it.each(["extraido", "revisao"] as const)(
    "chama o gancho com o comerciante do job quando a nota fica %s",
    async (status) => {
      const gancho = jest.fn().mockResolvedValue(undefined);
      const { fila } = criar({ status, compraId: "compra-1" }, gancho);
      await tratar(fila, job(DADOS));
      expect(gancho).toHaveBeenCalledTimes(1);
      expect(gancho).toHaveBeenCalledWith({
        documentoId: "doc-1",
        comercianteId: "c-1",
        compraId: "compra-1",
      });
    },
  );

  it.each([
    { status: "falha" as const },
    { status: "ignorado" as const },
    { status: "extraido" as const },
    { status: "falha" as const, compraId: "compra-x" },
    { status: "ignorado" as const, compraId: "compra-x" },
  ])("não chama o gancho sem compra gravada ou com status $status", async (resultado) => {
    const gancho = jest.fn();
    const { fila } = criar(resultado, gancho);
    await tratar(fila, job(DADOS));
    expect(gancho).not.toHaveBeenCalled();
  });

  it("falha do gancho é registrada com o documento e não falha nem repete a extração", async () => {
    const erro = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const gancho = jest.fn().mockRejectedValue(new Error("redis fora"));
    const { fila, processar } = criar({ status: "extraido", compraId: "compra-1" }, gancho);
    await expect(tratar(fila, job(DADOS))).resolves.toEqual({ status: "extraido", compraId: "compra-1" });
    expect(processar).toHaveBeenCalledTimes(1);
    expect(erro).toHaveBeenCalledWith(expect.stringContaining("doc-1"));
    expect(erro).toHaveBeenCalledWith(expect.stringContaining("redis fora"));
    erro.mockRestore();
  });

  it("sem o gancho, devolve o resultado da extração como antes", async () => {
    const { fila, processar } = criar({ status: "extraido", compraId: "compra-1" });
    await expect(tratar(fila, job(DADOS))).resolves.toEqual({ status: "extraido", compraId: "compra-1" });
    expect(processar).toHaveBeenCalledWith(DADOS, false);
  });
});
