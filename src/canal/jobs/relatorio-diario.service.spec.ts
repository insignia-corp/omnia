import { Logger } from "@nestjs/common";
import type { CicloDoAlerta } from "../../alertas/ciclo-do-alerta";
import type { Env } from "../../config/env";
import type { Db } from "../../infra/database/database.module";
import type { CaixaMensagens } from "../caixa-mensagens";
import type { PortaAgente } from "../porta-agente";
import type { Relogio } from "../relogio";
import type { FonteRelatorio } from "./fonte-relatorio";
import { RelatorioDiarioService } from "./relatorio-diario.service";

const JOB = { comercianteId: "c-1", data: "2026-10-20" };
const env = { FUSO_HORARIO: "America/Sao_Paulo", SILENCIO_INICIO: "22:00", SILENCIO_FIM: "07:00" } as Env;
// 2026-10-20 11:00 em São Paulo: fora do silêncio.
const relogio: Relogio = { agora: () => new Date("2026-10-20T14:00:00Z") };
const db = {
  select: () => ({
    from: () => ({ where: () => ({ limit: () => Promise.resolve([{ nome: "Mercadinho" }]) }) }),
  }),
} as unknown as Db;
const fonte: FonteRelatorio = { entrada: () => Promise.resolve("Relatório diário") };

function criar(opcoes: {
  envio?: "enviada" | "duplicada" | Error;
  marcar?: () => Promise<number>;
  execucaoId?: string | null;
  jaEnviadaHoje?: boolean;
  reconciliar?: () => Promise<number>;
}) {
  const marcarEnviados = jest.fn(opcoes.marcar ?? (() => Promise.resolve(1)));
  const reconciliar = jest.fn(opcoes.reconciliar ?? (() => Promise.resolve(0)));
  const enviarProativa = jest.fn(() =>
    opcoes.envio instanceof Error ? Promise.reject(opcoes.envio) : Promise.resolve(opcoes.envio ?? "enviada"),
  );
  const agente = {
    executar: jest.fn().mockResolvedValue({
      mensagem: "Bom dia",
      execucaoId: opcoes.execucaoId === undefined ? "exec-1" : opcoes.execucaoId,
    }),
  } as unknown as PortaAgente;
  const caixa = {
    jaTemProativa: () => Promise.resolve(opcoes.jaEnviadaHoje ?? false),
    enviarProativa,
  } as unknown as CaixaMensagens;
  const servico = new RelatorioDiarioService(db, env, relogio, agente, fonte, caixa, {
    marcarEnviados,
    reconciliar,
  } as unknown as CicloDoAlerta);
  return { servico, marcarEnviados, enviarProativa, reconciliar };
}

describe("RelatorioDiarioService: alertas enviados (#155)", () => {
  it("depois de entregar a mensagem, marca os alertas escolhidos com o comerciante e a execução", async () => {
    const { servico, marcarEnviados } = criar({});
    await expect(servico.processar(JOB)).resolves.toBe("enviada");
    expect(marcarEnviados).toHaveBeenCalledTimes(1);
    expect(marcarEnviados).toHaveBeenCalledWith("c-1", "exec-1", relogio.agora());
  });

  it("mensagem duplicada (não saiu) não marca nada", async () => {
    const { servico, marcarEnviados } = criar({ envio: "duplicada" });
    await expect(servico.processar(JOB)).resolves.toBe("duplicada");
    expect(marcarEnviados).not.toHaveBeenCalled();
  });

  it("falha no envio não marca nada e propaga o erro", async () => {
    const { servico, marcarEnviados } = criar({ envio: new Error("canal fora") });
    await expect(servico.processar(JOB)).rejects.toThrow("canal fora");
    expect(marcarEnviados).not.toHaveBeenCalled();
  });

  it("sem id de execução não marca nada", async () => {
    const { servico, marcarEnviados } = criar({ execucaoId: null });
    await expect(servico.processar(JOB)).resolves.toBe("enviada");
    expect(marcarEnviados).not.toHaveBeenCalled();
  });

  it("falha ao marcar é registrada com a execução e nunca desfaz o envio", async () => {
    const erro = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const { servico, enviarProativa } = criar({ marcar: () => Promise.reject(new Error("banco fora")) });
    await expect(servico.processar(JOB)).resolves.toBe("enviada");
    expect(enviarProativa).toHaveBeenCalledTimes(1);
    expect(erro).toHaveBeenCalledWith(expect.stringContaining("exec-1"));
    expect(erro).toHaveBeenCalledWith(expect.stringContaining("banco fora"));
    erro.mockRestore();
  });

  it("job reentregue com a mensagem do dia já enviada reconcilia os alertas, sem enviar de novo", async () => {
    const { servico, reconciliar, enviarProativa, marcarEnviados } = criar({ jaEnviadaHoje: true });
    await expect(servico.processar(JOB)).resolves.toBe("ja_enviada_hoje");
    expect(reconciliar).toHaveBeenCalledWith("c-1", "2026-10-20", relogio.agora());
    expect(enviarProativa).not.toHaveBeenCalled();
    expect(marcarEnviados).not.toHaveBeenCalled();
  });

  it("falha ao reconciliar é registrada e não impede o resultado", async () => {
    const erro = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const { servico } = criar({
      jaEnviadaHoje: true,
      reconciliar: () => Promise.reject(new Error("banco fora")),
    });
    await expect(servico.processar(JOB)).resolves.toBe("ja_enviada_hoje");
    expect(erro).toHaveBeenCalledWith(expect.stringContaining("banco fora"));
    erro.mockRestore();
  });
});
