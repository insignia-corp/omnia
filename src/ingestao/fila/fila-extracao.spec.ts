import type { ResultadoProcessamento } from "../processador-extracao";
import { ehUltimaTentativa, tratarJobExtracao } from "./fila-extracao";

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

  it.each(["extraido", "revisao", "ignorado"] as const)("status %s não avisa", async (status) => {
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
