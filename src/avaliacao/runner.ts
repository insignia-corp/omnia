import type { PedidoAgente, RespostaAgente } from "../agente/agente.service";
import type { ContextoSessao } from "../agente/ferramentas/ferramenta";
import type { ExecucaoRegistrada, RegistroExecucoes } from "../agente/execucao/registro-execucoes";
import type { Executor } from "../infra/database/database.module";
import { avaliarCriterios } from "./criterios";
import type { CasoAvaliacao, ModoModelo, ResultadoCaso, Rodada } from "./tipos";

/** O que o runner pede ao agente: o `AgenteService` serve, e os testes trocam por um dublê. */
export interface ExecutorAgente {
  executar(pedido: PedidoAgente): Promise<RespostaAgente>;
}

/** Guarda o que o agente registra, para o runner ler custo, latência e chamadas sem voltar ao banco. */
export class RegistroCapturador implements RegistroExecucoes {
  private readonly porId = new Map<string, ExecucaoRegistrada>();

  constructor(private readonly destino: RegistroExecucoes) {}

  async salvar(execucao: ExecucaoRegistrada, executor?: Executor): Promise<string> {
    const id = await this.destino.salvar(execucao, executor);
    this.porId.set(id, execucao);
    return id;
  }

  execucao(id: string): ExecucaoRegistrada | undefined {
    return this.porId.get(id);
  }
}

export interface OpcoesRodada {
  casos: CasoAvaliacao[];
  modo: ModoModelo;
  modelo: string;
  versaoPrompt: string;
  comercianteId: string;
  nomeComercio: string;
  /** Data de referência dos casos que não declaram a própria. */
  dataReferencia: string;
  /** Onde as execuções ficam registradas (Postgres na CLI). */
  registro: RegistroExecucoes;
  /** Monta o agente de um caso. No modo falso, o modelo e as ferramentas vêm do próprio caso. */
  criarAgente(caso: CasoAvaliacao, registro: RegistroExecucoes): ExecutorAgente;
  agora?: () => Date;
}

/** Roda os casos em sequência (a latência de um não contamina a do outro) e julga cada um. */
export async function executarRodada(opcoes: OpcoesRodada): Promise<Rodada> {
  const iniciadaEm = (opcoes.agora ?? (() => new Date()))().toISOString();
  const resultados: ResultadoCaso[] = [];
  for (const caso of opcoes.casos) {
    resultados.push(await executarCaso(caso, opcoes));
  }
  return {
    iniciadaEm,
    modo: opcoes.modo,
    modelo: opcoes.modelo,
    versaoPrompt: opcoes.versaoPrompt,
    comerciante: opcoes.nomeComercio,
    dataReferencia: opcoes.dataReferencia,
    resultados,
  };
}

async function executarCaso(caso: CasoAvaliacao, opcoes: OpcoesRodada): Promise<ResultadoCaso> {
  const base = { id: caso.id, categoria: caso.categoria, gatilho: caso.gatilho, descricao: caso.descricao };
  const contexto: ContextoSessao = {
    comercianteId: opcoes.comercianteId,
    nomeComercio: opcoes.nomeComercio,
    dataReferencia: caso.dataReferencia ?? opcoes.dataReferencia,
  };
  const registro = new RegistroCapturador(opcoes.registro);
  try {
    const agente = opcoes.criarAgente(caso, registro);
    const resposta = await agente.executar({
      contexto,
      gatilho: caso.gatilho,
      entrada: caso.entrada,
      ...(caso.historico ? { historico: caso.historico } : {}),
    });
    const execucao = registro.execucao(resposta.execucaoId);
    if (!execucao) throw new Error("O agente não registrou a execução");
    const motivos = avaliarCriterios(caso, execucao);
    return {
      ...base,
      aprovado: motivos.length === 0,
      motivos,
      resultadoAgente: execucao.resultado,
      mensagem: execucao.mensagemFinal,
      ferramentasChamadas: execucao.chamadas.map((c) => ({
        ferramenta: c.ferramenta,
        erro: c.erro,
        latenciaMs: c.latenciaMs,
      })),
      bloqueios: execucao.bloqueios.length,
      iteracoes: execucao.iteracoes,
      modelo: execucao.modelo,
      custoEstimadoMicrodolares: execucao.custoEstimadoMicrodolares,
      latenciaMs: execucao.latenciaMs,
      tokensEntrada: execucao.tokensEntrada,
      tokensSaida: execucao.tokensSaida,
      execucaoId: resposta.execucaoId,
    };
  } catch (e) {
    // Um caso que quebra não derruba a rodada: vira falha com o motivo.
    const motivo = e instanceof Error ? e.message : String(e);
    return {
      ...base,
      aprovado: false,
      motivos: [`Erro ao executar o caso: ${motivo}`],
      resultadoAgente: "sem_execucao",
      mensagem: "",
      ferramentasChamadas: [],
      bloqueios: 0,
      iteracoes: 0,
      modelo: opcoes.modelo,
      custoEstimadoMicrodolares: 0,
      latenciaMs: 0,
      tokensEntrada: 0,
      tokensSaida: 0,
      execucaoId: null,
    };
  }
}
