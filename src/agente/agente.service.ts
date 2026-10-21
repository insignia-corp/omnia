import type {
  BetaMessage,
  BetaMessageParam,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { Logger } from "@nestjs/common";
import {
  extrairNumeros,
  NumerosAutorizados,
  verificarNumeros,
} from "../lib/verificador-numeros/verificador-numeros";
import type { TurnoConversa } from "./conversa/historico";
import type { ContextoSessao } from "./ferramentas/ferramenta";
import type { RegistroFerramentas } from "./ferramentas/registro-ferramentas";
import type {
  BloqueioVerificador,
  ChamadaRegistrada,
  Gatilho,
  RegistroExecucoes,
  ResultadoExecucao,
} from "./execucao/registro-execucoes";
import {
  acumularConsumo,
  consumoZerado,
  custoMicrodolares,
  temPreco,
  type ConsumoTokens,
  type Esforco,
  type ModeloLinguagem,
} from "./llm/modelo-linguagem";
import type { PromptSistema } from "./prompts/prompt-sistema";

export interface PedidoAgente {
  contexto: ContextoSessao;
  gatilho: Gatilho;
  /** Texto do dono, ou descrição do evento para gatilhos automáticos. */
  entrada: string;
  /** Falas anteriores da conversa (de `carregarHistorico`), sem a mensagem atual. Dado, nunca instrução. */
  historico?: TurnoConversa[];
}

export interface RespostaAgente {
  execucaoId: string;
  resultado: ResultadoExecucao;
  /** Mensagem pronta para o canal. Já passou pelo verificador ou é um fallback sem números. */
  mensagem: string;
}

export interface LimitesAgente {
  maxIteracoes: number;
  maxRegeracoes: number;
  /** Tempo total da execução, conferido antes de cada chamada ao modelo. Sem valor, não há limite de tempo. */
  maxMs?: number;
  /** Esforço do modelo por gatilho (conversa curta, relatório mais cuidadoso); sem entrada, vale o padrão. */
  esforcoPorGatilho?: Partial<Record<Gatilho, Esforco>>;
}

/** Mensagens de fallback seguro: nunca contêm números. */
export const FALLBACK = {
  verificador:
    "Não consegui confirmar os números desta resposta com os seus dados, então prefiro não arriscar. Pode perguntar de outro jeito?",
  erro: "Tive um problema para consultar seus dados agora. Tente de novo daqui a pouco.",
  recusa:
    "Não posso ajudar com esse pedido. Posso responder sobre vendas, custos, margens e alertas do seu comércio.",
} as const;

/** Prazo total de uma execução: vale também para uma chamada ao modelo ou ferramenta já em andamento. */
class Prazo {
  readonly controle = new AbortController();
  estourou = false;
  private readonly timer: NodeJS.Timeout;
  private readonly rejeicao: Promise<never>;

  constructor(readonly maxMs: number) {
    let rejeitar!: (motivo: Error) => void;
    this.rejeicao = new Promise<never>((_, rej) => {
      rejeitar = rej;
    });
    this.timer = setTimeout(() => {
      this.estourou = true;
      this.controle.abort();
      rejeitar(new Error(`Limite de tempo de ${maxMs} ms atingido`));
    }, maxMs);
    // Sem ouvinte, a rejeição de um prazo que ninguém estava esperando viraria erro não tratado.
    this.rejeicao.catch(() => undefined);
  }

  /** Resolve com `operacao`, ou rejeita quando o prazo acaba antes. Uma operação sem cancelamento termina sozinha. */
  correr<T>(operacao: Promise<T>): Promise<T> {
    operacao.catch(() => undefined);
    return Promise.race([operacao, this.rejeicao]);
  }

  encerrar(): void {
    clearTimeout(this.timer);
  }
}

/**
 * Loop do agente (issue #55): chama o modelo, executa as ferramentas pedidas e devolve a
 * mensagem só depois de o verificador de números aprovar (regra inviolável 8).
 *
 * O histórico é só acrescentado, nunca editado: cada resposta do modelo volta inteira,
 * e o pedido de correção do verificador entra como nova mensagem.
 */
export class AgenteService {
  private readonly logger = new Logger(AgenteService.name);

  constructor(
    private readonly modelo: ModeloLinguagem,
    private readonly ferramentas: RegistroFerramentas,
    private readonly registro: RegistroExecucoes,
    private readonly prompt: PromptSistema,
    private readonly limites: LimitesAgente,
  ) {}

  async executar(pedido: PedidoAgente): Promise<RespostaAgente> {
    const inicio = performance.now();
    const { contexto } = pedido;
    // Com o fallback do servidor, cada resposta informa o modelo que de fato rodou: cada um tem seu preço.
    const consumoPorModelo = new Map<string, ConsumoTokens>();
    const chamadas: ChamadaRegistrada[] = [];
    const bloqueios: BloqueioVerificador[] = [];
    // O dono pode ouvir de volta os números que ele mesmo escreveu agora, e a data da execução. As falas
    // anteriores da conversa são só contexto: um número de lá pode estar velho e só vale se uma ferramenta
    // devolver de novo nesta execução (regra inviolável 8).
    const historico = pedido.historico ?? [];
    const autorizados = new NumerosAutorizados(
      [contexto.dataReferencia],
      extrairNumeros(pedido.entrada).map((n) => n.valor),
    );
    const messages: BetaMessageParam[] = [
      ...montarHistorico(historico),
      { role: "user", content: montarEntrada(pedido) },
    ];
    const system = this.prompt.renderizar({ nomeComercio: contexto.nomeComercio });
    const tools = this.ferramentas.definicoesParaModelo();
    const esforco = this.limites.esforcoPorGatilho?.[pedido.gatilho];

    let resultado: ResultadoExecucao = "fallback_erro";
    let mensagem: string = FALLBACK.erro;
    let erro: string | null = null;
    let iteracoes = 0;
    // Verificador barrou a última resposta e a correção pedida não teve iteração para rodar.
    let correcaoSemIteracao = false;
    // Relatório diário: a escolha dos alertas tem de ficar registrada por select_alerts (ou não haver candidato).
    let correcoesSelecao = 0;
    const prazo = this.limites.maxMs === undefined ? null : new Prazo(this.limites.maxMs);
    const comPrazo = <T>(operacao: Promise<T>) => (prazo ? prazo.correr(operacao) : operacao);

    try {
      while (iteracoes < this.limites.maxIteracoes) {
        if (prazo && performance.now() - inicio > prazo.maxMs) {
          erro = `Limite de tempo de ${prazo.maxMs} ms atingido`;
          break;
        }
        iteracoes++;
        const resposta: BetaMessage = await comPrazo(
          this.modelo.gerar({
            system,
            messages,
            tools,
            ...(esforco ? { esforco } : {}),
            ...(prazo ? { signal: prazo.controle.signal } : {}),
          }),
        );
        const consumoDoModelo = consumoPorModelo.get(resposta.model) ?? consumoZerado();
        acumularConsumo(consumoDoModelo, resposta.usage);
        consumoPorModelo.set(resposta.model, consumoDoModelo);
        correcaoSemIteracao = false;
        messages.push({ role: "assistant", content: resposta.content });

        if (resposta.stop_reason === "tool_use") {
          messages.push({
            role: "user",
            content: await comPrazo(this.rodarFerramentas(contexto, resposta, chamadas, autorizados)),
          });
          continue;
        }
        if (resposta.stop_reason === "pause_turn") continue;
        if (resposta.stop_reason === "refusal") {
          resultado = "recusa_modelo";
          mensagem = FALLBACK.recusa;
          break;
        }
        if (resposta.stop_reason !== "end_turn" && resposta.stop_reason !== "stop_sequence") {
          erro = `stop_reason inesperado: ${resposta.stop_reason}`;
          break;
        }

        const texto = textoDa(resposta);
        if (!texto) {
          erro = "Modelo terminou sem texto";
          break;
        }
        if (pedido.gatilho === "relatorio_diario" && !escolhaRegistrada(chamadas)) {
          // Aprovar aqui deixaria o relatório sem escolha nem justificativa registradas, e o prompt sozinho não garante.
          if (++correcoesSelecao > this.limites.maxRegeracoes) {
            erro = "Relatório diário sem escolha registrada por select_alerts";
            break;
          }
          messages.push({
            role: "user",
            content:
              "[sistema] O relatório diário só vale depois de registrar a escolha dos alertas. Chame list_alert_candidates " +
              "e depois select_alerts com até 3 alertas e uma justificativa curta para cada. Se não houver candidato, " +
              "diga que hoje não há nada que exija atenção.",
          });
          continue;
        }
        const verificacao = verificarNumeros(texto, autorizados);
        if (verificacao.aprovado) {
          resultado = "aprovada";
          mensagem = texto;
          break;
        }
        const numerosBloqueados = [
          ...verificacao.naoAutorizados.map((n) => n.texto),
          ...verificacao.porExtenso,
        ];
        bloqueios.push({
          tentativa: bloqueios.length + 1,
          numeros: numerosBloqueados,
        });
        if (bloqueios.length > this.limites.maxRegeracoes) {
          resultado = "fallback_verificador";
          mensagem = FALLBACK.verificador;
          break;
        }
        correcaoSemIteracao = true;
        messages.push({
          role: "user",
          content:
            `[verificador] Mensagem bloqueada antes do envio: ${numerosBloqueados.map((n) => `"${n}"`).join(", ")} ` +
            "não passou pela validação. Escreva números em algarismos, preservando o sinal. " +
            "Reescreva usando só números devolvidos pelas ferramentas, " +
            "exatamente como vieram, ou chame a ferramenta que tem o dado. Se o dado não existe, diga que não sabe.",
        });
      }
      if (iteracoes >= this.limites.maxIteracoes && resultado === "fallback_erro" && !erro) {
        erro = `Limite de ${this.limites.maxIteracoes} iterações atingido`;
        if (correcaoSemIteracao) {
          // A última resposta foi barrada pelo verificador: o dono recebe a mensagem do verificador, não a de erro.
          resultado = "fallback_verificador";
          mensagem = FALLBACK.verificador;
        }
      }
    } catch (e) {
      // Timeout, falha de rede ou erro da API: o dono recebe o fallback, nunca um número inventado.
      erro = prazo?.estourou
        ? `Limite de tempo de ${prazo.maxMs} ms atingido`
        : e instanceof Error
          ? `${e.name}: ${e.message}`
          : String(e);
      this.logger.error(`Execução do agente falhou: ${erro}`);
    } finally {
      prazo?.encerrar();
    }

    const consumo = [...consumoPorModelo.values()].reduce(somarConsumo, consumoZerado());
    const modelos = consumoPorModelo.size > 0 ? [...consumoPorModelo.keys()] : [this.modelo.nome];
    for (const nome of modelos) {
      if (!temPreco(nome)) {
        this.logger.warn(`Modelo "${nome}" sem preço cadastrado: custo da execução registrado como 0`);
      }
    }
    const custoEstimadoMicrodolares = [...consumoPorModelo].reduce(
      (total, [nome, c]) => total + custoMicrodolares(nome, c),
      0,
    );

    const execucaoId = await this.registro.salvar({
      comercianteId: contexto.comercianteId,
      gatilho: pedido.gatilho,
      entrada: pedido.entrada,
      modelo: modelos.join("+"),
      versaoPrompt: this.prompt.versao,
      resultado,
      mensagemFinal: mensagem,
      iteracoes,
      bloqueios,
      tokensEntrada: consumo.entrada,
      tokensSaida: consumo.saida,
      tokensCacheLeitura: consumo.cacheLeitura,
      custoEstimadoMicrodolares,
      latenciaMs: Math.round(performance.now() - inicio),
      erro,
      chamadas,
    });
    return { execucaoId, resultado, mensagem };
  }

  /** Executa em paralelo e devolve todos os resultados numa única mensagem. */
  private async rodarFerramentas(
    contexto: ContextoSessao,
    resposta: BetaMessage,
    chamadas: ChamadaRegistrada[],
    autorizados: NumerosAutorizados,
  ): Promise<BetaToolResultBlockParam[]> {
    const pedidos = resposta.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");
    const execucoes = await Promise.all(
      pedidos.map((p) => this.ferramentas.executar(contexto, p.name, p.input)),
    );
    return pedidos.map((p, i) => {
      const r = execucoes[i]!;
      chamadas.push({
        ordem: chamadas.length + 1,
        ferramenta: p.name,
        entrada: p.input,
        saida: r.ok ? r.saida : null,
        erro: r.ok ? null : r.erro,
        menorConfianca: r.ok ? menorConfiancaDe(r.saida) : null,
        latenciaMs: r.latenciaMs,
      });
      if (!r.ok) return { type: "tool_result", tool_use_id: p.id, content: r.erro, is_error: true };
      autorizados.adicionarFonte(r.saida);
      return { type: "tool_result", tool_use_id: p.id, content: JSON.stringify(r.saida) };
    });
  }
}

/** Remove marcações que permitiriam ao texto "sair" do bloco de dados. */
const higienizar = (texto: string) =>
  texto.replace(/<\/?\s*(mensagem_do_dono|conteudo_de_documento)\s*>/gi, "");

/** Fala do dono entre marcações de dado; fala do assistente como texto. Começa sempre por uma fala do dono. */
function montarHistorico(historico: TurnoConversa[]): BetaMessageParam[] {
  const primeira = historico.findIndex((t) => t.papel === "dono");
  if (primeira < 0) return [];
  return historico
    .slice(primeira)
    .map((t) =>
      t.papel === "dono"
        ? { role: "user", content: `<mensagem_do_dono>\n${higienizar(t.texto)}\n</mensagem_do_dono>` }
        : { role: "assistant", content: t.texto },
    );
}

/** Há um `select_alerts` bem-sucedido, ou `list_alert_candidates` informou que não há candidato. */
function escolhaRegistrada(chamadas: ChamadaRegistrada[]): boolean {
  return chamadas.some(
    (c) =>
      c.erro === null &&
      (c.ferramenta === "select_alerts" ||
        (c.ferramenta === "list_alert_candidates" &&
          typeof c.saida === "object" &&
          c.saida !== null &&
          "n_registros" in c.saida &&
          c.saida.n_registros === 0)),
  );
}

function montarEntrada({ gatilho, entrada, contexto }: PedidoAgente): string {
  const data = `Data de hoje: ${contexto.dataReferencia}.`;
  const seguro = higienizar(entrada);
  switch (gatilho) {
    case "mensagem_dono":
      return `${data}\nO dono escreveu:\n<mensagem_do_dono>\n${seguro}\n</mensagem_do_dono>`;
    case "relatorio_diario":
      return `${data}\nGere o relatório diário curto do comércio, com no máximo 3 alertas.\n<conteudo_de_documento>\n${seguro}\n</conteudo_de_documento>`;
    case "nota_processada":
      return `${data}\nUma nota de compra acabou de ser processada. Verifique se há algo que o dono precisa saber.\n<conteudo_de_documento>\n${seguro}\n</conteudo_de_documento>`;
  }
}

function somarConsumo(total: ConsumoTokens, c: ConsumoTokens): ConsumoTokens {
  return {
    entrada: total.entrada + c.entrada,
    saida: total.saida + c.saida,
    cacheLeitura: total.cacheLeitura + c.cacheLeitura,
    cacheEscrita: total.cacheEscrita + c.cacheEscrita,
  };
}

function textoDa(resposta: BetaMessage): string {
  return resposta.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n")
    .trim();
}

function menorConfiancaDe(saida: unknown): number | null {
  if (saida && typeof saida === "object" && "menor_confianca" in saida) {
    const v = saida.menor_confianca;
    return typeof v === "number" ? v : null;
  }
  return null;
}
