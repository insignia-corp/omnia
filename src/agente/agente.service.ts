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
  type ModeloLinguagem,
} from "./llm/modelo-linguagem";
import type { PromptSistema } from "./prompts/prompt-sistema";

export interface PedidoAgente {
  contexto: ContextoSessao;
  gatilho: Gatilho;
  /** Texto do dono, ou descrição do evento para gatilhos automáticos. */
  entrada: string;
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
}

/** Mensagens de fallback seguro: nunca contêm números. */
export const FALLBACK = {
  verificador:
    "Não consegui confirmar os números desta resposta com os seus dados, então prefiro não arriscar. Pode perguntar de outro jeito?",
  erro: "Tive um problema para consultar seus dados agora. Tente de novo daqui a pouco.",
  recusa:
    "Não posso ajudar com esse pedido. Posso responder sobre vendas, custos, margens e alertas do seu comércio.",
} as const;

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
    const consumo = consumoZerado();
    const chamadas: ChamadaRegistrada[] = [];
    const bloqueios: BloqueioVerificador[] = [];
    // O dono pode ouvir de volta os números que ele mesmo escreveu, e a data da execução.
    const autorizados = new NumerosAutorizados(
      [contexto.dataReferencia],
      extrairNumeros(pedido.entrada).map((n) => n.valor),
    );
    const messages: BetaMessageParam[] = [{ role: "user", content: montarEntrada(pedido) }];
    const system = this.prompt.renderizar({ nomeComercio: contexto.nomeComercio });
    const tools = this.ferramentas.definicoesParaModelo();

    let resultado: ResultadoExecucao = "fallback_erro";
    let mensagem: string = FALLBACK.erro;
    let erro: string | null = null;
    let iteracoes = 0;

    try {
      while (iteracoes < this.limites.maxIteracoes) {
        iteracoes++;
        const resposta: BetaMessage = await this.modelo.gerar({ system, messages, tools });
        acumularConsumo(consumo, resposta.usage);
        messages.push({ role: "assistant", content: resposta.content });

        if (resposta.stop_reason === "tool_use") {
          messages.push({
            role: "user",
            content: await this.rodarFerramentas(contexto, resposta, chamadas, autorizados),
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
        const verificacao = verificarNumeros(texto, autorizados);
        if (verificacao.aprovado) {
          resultado = "aprovada";
          mensagem = texto;
          break;
        }
        bloqueios.push({
          tentativa: bloqueios.length + 1,
          numeros: verificacao.naoAutorizados.map((n) => n.texto),
        });
        if (bloqueios.length > this.limites.maxRegeracoes) {
          resultado = "fallback_verificador";
          mensagem = FALLBACK.verificador;
          break;
        }
        messages.push({
          role: "user",
          content:
            `[verificador] Mensagem bloqueada antes do envio: ${verificacao.naoAutorizados.map((n) => `"${n.texto}"`).join(", ")} ` +
            "não aparece nos resultados das ferramentas. Reescreva usando só números devolvidos pelas ferramentas, " +
            "exatamente como vieram, ou chame a ferramenta que tem o dado. Se o dado não existe, diga que não sabe.",
        });
      }
      if (iteracoes >= this.limites.maxIteracoes && resultado === "fallback_erro" && !erro) {
        erro = `Limite de ${this.limites.maxIteracoes} iterações atingido`;
      }
    } catch (e) {
      // Timeout, falha de rede ou erro da API: o dono recebe o fallback, nunca um número inventado.
      erro = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      this.logger.error(`Execução do agente falhou: ${erro}`);
    }

    const execucaoId = await this.registro.salvar({
      comercianteId: contexto.comercianteId,
      gatilho: pedido.gatilho,
      entrada: pedido.entrada,
      modelo: this.modelo.nome,
      versaoPrompt: this.prompt.versao,
      resultado,
      mensagemFinal: mensagem,
      iteracoes,
      bloqueios,
      tokensEntrada: consumo.entrada,
      tokensSaida: consumo.saida,
      tokensCacheLeitura: consumo.cacheLeitura,
      custoEstimadoMicrodolares: custoMicrodolares(this.modelo.nome, consumo),
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

function montarEntrada({ gatilho, entrada, contexto }: PedidoAgente): string {
  const data = `Data de hoje: ${contexto.dataReferencia}.`;
  // Remove marcações que permitiriam ao texto "sair" do bloco de dados.
  const seguro = entrada.replace(/<\/?\s*(mensagem_do_dono|conteudo_de_documento)\s*>/gi, "");
  switch (gatilho) {
    case "mensagem_dono":
      return `${data}\nO dono escreveu:\n<mensagem_do_dono>\n${seguro}\n</mensagem_do_dono>`;
    case "relatorio_diario":
      return `${data}\nGere o relatório diário curto do comércio, com no máximo 3 alertas.\n${seguro}`;
    case "nota_processada":
      return `${data}\nUma nota de compra acabou de ser processada. Verifique se há algo que o dono precisa saber.\n<conteudo_de_documento>\n${seguro}\n</conteudo_de_documento>`;
  }
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
