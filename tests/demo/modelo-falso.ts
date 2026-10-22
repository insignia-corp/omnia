import type { BetaContentBlock, BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ModeloLinguagem, PedidoModelo } from "../../src/agente/llm/modelo-linguagem";

/** Modelo falso para os e2e do canal: responde sempre com o mesmo texto (sem números) e conta as chamadas. */
export class ModeloFalso implements ModeloLinguagem {
  readonly nome = "claude-opus-5-5";
  chamadas = 0;
  /** Simula um modelo lento (ms); o teste pode ligar e desligar. */
  atrasoMs = 0;
  /** Roda no meio de cada chamada, por exemplo para mover um relógio falso. */
  aoGerar: (() => void) | undefined;

  constructor(private readonly texto = "Tudo certo por aqui. Sigo de olho no seu negócio.") {}

  async gerar(): Promise<BetaMessage> {
    this.chamadas++;
    if (this.atrasoMs > 0) await new Promise((r) => setTimeout(r, this.atrasoMs));
    this.aoGerar?.();
    return {
      id: `msg_falsa_${this.chamadas}`,
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: this.texto }] as BetaContentBlock[],
      usage: {
        input_tokens: 1000,
        output_tokens: 100,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    } as unknown as BetaMessage;
  }
}

const brl = (centavos: number): string =>
  `R$ ${(centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Resposta do modelo falso: texto ou chamada de ferramenta, no formato da API. */
const resposta = (n: number, content: BetaContentBlock[], stop: "end_turn" | "tool_use"): BetaMessage =>
  ({
    id: `msg_falsa_${n}`,
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    stop_reason: stop,
    content,
    usage: {
      input_tokens: 1000,
      output_tokens: 100,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  }) as unknown as BetaMessage;

/** Último resultado de ferramenta da conversa, já lido como JSON. */
function ultimoResultado(messages: PedidoModelo["messages"]): unknown {
  const ultima = messages[messages.length - 1];
  const blocos = Array.isArray(ultima?.content) ? ultima.content : [];
  const r = blocos.find((b) => b.type === "tool_result");
  if (!r || r.type !== "tool_result") throw new Error("Sem tool_result na última mensagem");
  const texto =
    typeof r.content === "string"
      ? r.content
      : (r.content ?? []).flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
  return JSON.parse(texto);
}

interface Candidato {
  alerta_id: string;
  tipo: string;
  produto_id: string | null;
}
interface Selecionado {
  tipo: string;
  metricas_apoio: {
    variacao_percentual: number;
    custo_anterior_centavos: number;
    custo_atual_centavos: number;
  };
}

/**
 * Modelo falso do relatório diário com o motor de alertas real: chama list_alert_candidates, escolhe
 * o reajuste do produto alvo em select_alerts e escreve a mensagem só com os números devolvidos.
 * Fora do relatório diário (sem o marcador na primeira mensagem) responde como o `ModeloFalso`.
 */
export class ModeloRelatorioFalso implements ModeloLinguagem {
  readonly nome = "claude-opus-5-5";
  chamadas = 0;
  chamadasRelatorio = 0;

  constructor(
    private readonly produtoAlvo: string,
    private readonly textoPadrao = "Tudo certo por aqui. Sigo de olho no seu negócio.",
  ) {}

  gerar({ messages }: PedidoModelo): Promise<BetaMessage> {
    this.chamadas++;
    const n = this.chamadas;
    const primeira = messages[0]?.content;
    const textoInicial = typeof primeira === "string" ? primeira : JSON.stringify(primeira);
    if (!textoInicial.includes("Gere o relatório diário")) {
      return Promise.resolve(
        resposta(n, [{ type: "text", text: this.textoPadrao }] as BetaContentBlock[], "end_turn"),
      );
    }
    this.chamadasRelatorio++;
    const ultima = messages[messages.length - 1];
    const temResultado =
      Array.isArray(ultima?.content) && ultima.content.some((b) => b.type === "tool_result");
    if (!temResultado) {
      const bloco = { type: "tool_use", id: "toolu_lista", name: "list_alert_candidates", input: {} };
      return Promise.resolve(resposta(n, [bloco] as BetaContentBlock[], "tool_use"));
    }
    const resultado = ultimoResultado(messages) as { candidatos?: Candidato[]; selecionados?: Selecionado[] };
    if (resultado.candidatos) {
      const escolhido = resultado.candidatos.find(
        (c) => c.tipo === "reajuste_de_custo" && c.produto_id === this.produtoAlvo,
      );
      if (!escolhido) throw new Error("Sem candidato de reajuste do produto alvo");
      const input = {
        alertas: [
          { alerta_id: escolhido.alerta_id, justificativa: "Reajuste do fornecedor acima do limite." },
        ],
      };
      const bloco = { type: "tool_use", id: "toolu_escolha", name: "select_alerts", input };
      return Promise.resolve(resposta(n, [bloco] as BetaContentBlock[], "tool_use"));
    }
    const m = resultado.selecionados?.[0]?.metricas_apoio;
    if (!m) throw new Error("select_alerts sem selecionados");
    const pct = m.variacao_percentual.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const texto = `O arroz da Aurora subiu ${pct}%: o custo passou de ${brl(m.custo_anterior_centavos)} para ${brl(m.custo_atual_centavos)}.`;
    return Promise.resolve(resposta(n, [{ type: "text", text: texto }] as BetaContentBlock[], "end_turn"));
  }
}
