import { Logger } from "@nestjs/common";
import type { CicloDoAlerta } from "../../alertas/ciclo-do-alerta";
import type { MotorDeAlertas } from "../../alertas/motor-de-alertas";
import type { Env } from "../../config/env";
import type { Db } from "../../infra/database/database.module";
import type { MetricasService } from "../../metricas/metricas.service";
import { dadoAusente } from "../../metricas/resultado-metrica";
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
  janelaAberta?: boolean;
  resumo?: unknown;
  candidatos?: number;
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
    janelaAberta: () => Promise.resolve(opcoes.janelaAberta ?? true),
    enviarProativa,
  } as unknown as CaixaMensagens;
  const resumoDiario = jest.fn(() =>
    Promise.resolve(opcoes.resumo ?? dadoAusente("dia_sem_dados", "sem vendas")),
  );
  const metricas = { resumoDiario } as unknown as MetricasService;
  const motor = {
    executar: () => Promise.resolve({ candidatos: Array.from({ length: opcoes.candidatos ?? 0 }) }),
  } as unknown as MotorDeAlertas;
  const servico = new RelatorioDiarioService(
    db,
    env,
    relogio,
    agente,
    fonte,
    caixa,
    { marcarEnviados, reconciliar } as unknown as CicloDoAlerta,
    metricas,
    motor,
  );
  return { servico, marcarEnviados, enviarProativa, reconciliar, agente, resumoDiario };
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

describe("RelatorioDiarioService: janela de 24 h (#182)", () => {
  const resumo = {
    valor: {
      data: "2026-10-19",
      faturamento_centavos: 122151,
      cupons: 78,
      comparacao_faturamento: {
        media_7_dias_anteriores: {
          data: null,
          base_centavos: 175072,
          variacao_bps: -3023,
          variacao_percentual: -30.23,
        },
      },
    },
    periodo: { inicio: "2026-10-12", fim: "2026-10-19" },
    n_registros: 1,
    menor_confianca: 1,
    origens: ["planilha"],
  };

  it("dentro da janela, o texto verificado do agente sai com os botões dos próximos passos", async () => {
    const { servico, enviarProativa } = criar({});
    await servico.processar(JOB);
    const [envio] = enviarProativa.mock.calls[0] as unknown as [
      { saida: { type: string; interactive?: { body: { text: string } } } },
    ];
    expect(envio.saida.type).toBe("interactive");
    expect(envio.saida.interactive?.body.text).toBe("Bom dia");
  });

  it("fora da janela, sai o modelo resumo_diario do dia anterior, sem chamar o agente", async () => {
    const { servico, enviarProativa, agente, resumoDiario } = criar({
      janelaAberta: false,
      resumo,
      candidatos: 5,
    });
    await expect(servico.processar(JOB)).resolves.toBe("enviada");
    expect(agente.executar).not.toHaveBeenCalled();
    expect(resumoDiario).toHaveBeenCalledWith(
      expect.objectContaining({ comercianteId: "c-1" }),
      "2026-10-19",
    );
    const [envio] = enviarProativa.mock.calls[0] as unknown as [
      {
        chave: string;
        saida: {
          type: string;
          template: { name: string; components: { parameters: { text?: string }[] }[] };
        };
      },
    ];
    expect(envio.chave).toBe("relatorio_c-1_2026-10-20");
    expect(envio.saida.template.name).toBe("resumo_diario");
    expect(envio.saida.template.components[0]!.parameters.map((p) => p.text)).toEqual([
      "segunda, 19/10",
      "Mercadinho",
      "R$ 1.221,51",
      "78",
      "30,23% abaixo",
      "3",
    ]);
  });

  it("fora da janela e sem dado para o modelo, nada sai", async () => {
    const aviso = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const { servico, enviarProativa } = criar({ janelaAberta: false });
    await expect(servico.processar(JOB)).resolves.toBe("sem_dados");
    expect(enviarProativa).not.toHaveBeenCalled();
    aviso.mockRestore();
  });
});
