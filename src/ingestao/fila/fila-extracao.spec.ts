import { Logger } from "@nestjs/common";
import type Redis from "ioredis";
import type { PinoLogger } from "nestjs-pino";
import type { Job } from "bullmq";
import type { ProcessadorExtracao, ResultadoProcessamento } from "../processador-extracao";
import {
  FilaExtracao,
  type AposExtracao,
  type JobExtracao,
  ehUltimaTentativa,
  tratarJobExtracao,
} from "./fila-extracao";

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), close: jest.fn() })),
  Worker: jest.fn(),
}));

const entrada = { documentoId: "doc-1", comercianteId: "com-1" };

function montar(attemptsStarted: number) {
  const processar = jest.fn<Promise<ResultadoProcessamento>, [typeof entrada, boolean]>();
  const avisoFalha = jest.fn<Promise<void>, [typeof entrada]>().mockResolvedValue();
  const logger = { log: jest.fn(), warn: jest.fn() };
  const job = { data: entrada, attemptsStarted, opts: { attempts: 3 } };
  const tratar = () => tratarJobExtracao(job, { processador: { processar }, avisoFalha, logger });
  return { processar, avisoFalha, logger, tratar };
}

describe("ehUltimaTentativa", () => {
  it("só é a última quando a tentativa em curso é a de número igual ao limite", () => {
    expect(ehUltimaTentativa({ attemptsStarted: 1, opts: { attempts: 3 } })).toBe(false);
    expect(ehUltimaTentativa({ attemptsStarted: 3, opts: { attempts: 3 } })).toBe(true);
  });

  it("sem limite configurado, a primeira já é a última", () => {
    expect(ehUltimaTentativa({ attemptsStarted: 1, opts: {} })).toBe(true);
  });
});

describe("tratarJobExtracao", () => {
  it("falha de vez na última tentativa avisa o dono uma vez", async () => {
    const t = montar(3);
    t.processar.mockResolvedValue({ status: "falha" });
    await expect(t.tratar()).resolves.toEqual({ status: "falha" });
    expect(t.processar).toHaveBeenCalledWith(entrada, true);
    expect(t.avisoFalha).toHaveBeenCalledTimes(1);
    expect(t.avisoFalha).toHaveBeenCalledWith(entrada);
  });

  it("tentativa pendente (erro que sobe) não avisa e repassa o erro", async () => {
    const t = montar(1);
    const erro = new Error("timeout");
    t.processar.mockRejectedValue(erro);
    await expect(t.tratar()).rejects.toBe(erro);
    expect(t.processar).toHaveBeenCalledWith(entrada, false);
    expect(t.avisoFalha).not.toHaveBeenCalled();
  });

  it("falha imediata na primeira tentativa avisa na hora", async () => {
    const t = montar(1);
    t.processar.mockResolvedValue({ status: "falha" });
    await t.tratar();
    expect(t.avisoFalha).toHaveBeenCalledTimes(1);
  });

  it("job repetido de documento já resolvido (ignorado) chama o aviso, que confere o documento no banco", async () => {
    const t = montar(1);
    t.processar.mockResolvedValue({ status: "ignorado" });
    await t.tratar();
    expect(t.avisoFalha).toHaveBeenCalledTimes(1);
    expect(t.avisoFalha).toHaveBeenCalledWith(entrada);
  });

  it.each(["extraido", "revisao"] as const)("status %s não avisa", async (status) => {
    const t = montar(1);
    t.processar.mockResolvedValue({ status });
    await t.tratar();
    expect(t.avisoFalha).not.toHaveBeenCalled();
  });

  it("aviso que falha não derruba o job", async () => {
    const t = montar(3);
    t.processar.mockResolvedValue({ status: "falha" });
    t.avisoFalha.mockRejectedValue(new Error("canal fora"));
    await expect(t.tratar()).resolves.toEqual({ status: "falha" });
    expect(t.logger.warn).toHaveBeenCalledTimes(1);
  });
});

const jobDe = (data: JobExtracao): Job<JobExtracao> =>
  ({ data, attemptsStarted: 1, opts: { attempts: 3 } }) as unknown as Job<JobExtracao>;

function criar(resultado: ResultadoProcessamento, gancho?: AposExtracao) {
  const processar = jest.fn().mockResolvedValue(resultado);
  const fila = new FilaExtracao(
    {} as Redis,
    { processar } as unknown as ProcessadorExtracao,
    {} as PinoLogger,
    gancho,
  );
  return { fila, processar };
}

const tratarNaFila = (fila: FilaExtracao, j: Job<JobExtracao>): Promise<ResultadoProcessamento> =>
  (fila as unknown as { tratar(j: Job<JobExtracao>): Promise<ResultadoProcessamento> }).tratar(j);

const DADOS: JobExtracao = { documentoId: "doc-1", comercianteId: "c-1" };

describe("FilaExtracao: gancho após a extração", () => {
  it.each(["extraido", "revisao"] as const)(
    "chama o gancho com o comerciante do job quando a nota fica %s",
    async (status) => {
      const gancho = jest.fn().mockResolvedValue(undefined);
      const { fila } = criar({ status, compraId: "compra-1" }, gancho);
      await tratarNaFila(fila, jobDe(DADOS));
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
    await tratarNaFila(fila, jobDe(DADOS));
    expect(gancho).not.toHaveBeenCalled();
  });

  it("falha do gancho é registrada com o documento e não falha nem repete a extração", async () => {
    const erro = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const gancho = jest.fn().mockRejectedValue(new Error("redis fora"));
    const { fila, processar } = criar({ status: "extraido", compraId: "compra-1" }, gancho);
    await expect(tratarNaFila(fila, jobDe(DADOS))).resolves.toEqual({
      status: "extraido",
      compraId: "compra-1",
    });
    expect(processar).toHaveBeenCalledTimes(1);
    expect(erro).toHaveBeenCalledWith(expect.stringContaining("doc-1"));
    expect(erro).toHaveBeenCalledWith(expect.stringContaining("redis fora"));
    erro.mockRestore();
  });

  it("sem o gancho, devolve o resultado da extração como antes", async () => {
    const { fila, processar } = criar({ status: "extraido", compraId: "compra-1" });
    await expect(tratarNaFila(fila, jobDe(DADOS))).resolves.toEqual({
      status: "extraido",
      compraId: "compra-1",
    });
    expect(processar).toHaveBeenCalledWith(DADOS, false);
  });
});
