import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import { z } from "zod";
import type { ContextoSessao, Ferramenta } from "./ferramenta";

/** Proposta de escrita guardada à espera do "sim" do dono (issue #104). */
export interface PropostaConfirmacao {
  perguntaId: string;
  /** Pergunta ao dono, montada em código. Seus números valem como fonte no verificador. */
  pergunta: string;
}

export type ResultadoExecucaoFerramenta =
  | { ok: true; saida: unknown; latenciaMs: number }
  | { ok: false; erro: string; latenciaMs: number; confirmacao?: PropostaConfirmacao };

/** Comparadas sem maiúsculas e separadores: pega comerciante_id, comercianteId e comerciante-id. */
const CHAVES_PROIBIDAS = new Set(["comercianteid"]);

/**
 * Esquema de entrada no formato que a API aceita com `strict: true`. Ela recusa com 400 limites numéricos
 * (`minimum`, `maximum`, `exclusiveMinimum`), de tamanho de texto e de lista; o transformador do próprio SDK
 * tira esses limites do esquema e os escreve na descrição do campo. Quem confere o valor é o Zod, em
 * `executar`, então nada se perde. Sem isto, uma única ferramenta com `.max()` derruba todo pedido ao modelo.
 */
export function esquemaEstrito(entrada: z.ZodObject): BetaTool["input_schema"] {
  const esquema: Record<string, unknown> = { ...z.toJSONSchema(entrada, { target: "draft-7" }) };
  delete esquema["$schema"];
  return transformJSONSchema(esquema) as BetaTool["input_schema"];
}

const normalizarChave = (chave: string) => chave.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Procura a chave proibida em qualquer profundidade do esquema JSON da entrada. */
function acharChaveProibida(esquema: unknown): string | undefined {
  if (Array.isArray(esquema)) {
    for (const item of esquema) {
      const achada = acharChaveProibida(item);
      if (achada) return achada;
    }
    return undefined;
  }
  if (!esquema || typeof esquema !== "object") return undefined;
  const { properties, ...resto } = esquema as { properties?: unknown } & Record<string, unknown>;
  if (properties && typeof properties === "object") {
    for (const [chave, sub] of Object.entries(properties)) {
      if (CHAVES_PROIBIDAS.has(normalizarChave(chave))) return chave;
      const achada = acharChaveProibida(sub);
      if (achada) return achada;
    }
  }
  return acharChaveProibida(Object.values(resto));
}

/**
 * Confirmação do dono para ferramentas que escrevem configuração (regra inviolável 7).
 * O estado vem do banco (ex.: `pergunta_dono` do tipo `confirmar_acao` respondida com "sim"),
 * nunca do texto do modelo. Devolve true uma única vez por confirmação.
 */
export interface ConfirmacoesConfig {
  consumir(contexto: ContextoSessao, ferramenta: string, entrada: unknown): Promise<boolean>;
  /**
   * Chamada quando `consumir` recusa: guarda a escrita pedida e devolve a pergunta ao dono, ou `null`
   * se não há como propor. A escrita só roda depois, por `executarConfirmada`, quando o código vê o
   * "sim" do dono: o modelo nunca dispara uma escrita sozinho (regra inviolável 7).
   */
  propor?(
    contexto: ContextoSessao,
    ferramenta: Ferramenta,
    entrada: unknown,
  ): Promise<PropostaConfirmacao | null>;
}

/** Padrão seguro: sem uma implementação ligada ao banco, nenhuma escrita é executada. */
export const SEM_CONFIRMACAO: ConfirmacoesConfig = { consumir: () => Promise.resolve(false) };

/** Ferramentas disponíveis ao agente. Valida a entrada antes de executar. */
export class RegistroFerramentas {
  private readonly ferramentas = new Map<string, Ferramenta>();

  constructor(
    ferramentas: Ferramenta[] = [],
    private readonly confirmacoes: ConfirmacoesConfig = SEM_CONFIRMACAO,
  ) {
    for (const f of ferramentas) this.registrar(f);
  }

  registrar(ferramenta: Ferramenta): void {
    if (this.ferramentas.has(ferramenta.nome)) throw new Error(`Ferramenta duplicada: ${ferramenta.nome}`);
    const proibida = acharChaveProibida(
      z.toJSONSchema(ferramenta.entrada, { target: "draft-7", io: "input" }),
    );
    if (proibida) {
      throw new Error(
        `A ferramenta ${ferramenta.nome} recebe "${proibida}" do modelo. O comerciante vem da sessão (regra 3).`,
      );
    }
    this.ferramentas.set(ferramenta.nome, ferramenta);
  }

  get nomes(): string[] {
    return [...this.ferramentas.keys()];
  }

  /** Definições no formato da API, em ordem estável (mantém o cache de prompt). */
  definicoesParaModelo(): BetaTool[] {
    return [...this.ferramentas.values()]
      .sort((a, b) => a.nome.localeCompare(b.nome))
      .map((f) => ({
        name: f.nome,
        description: f.descricao,
        input_schema: esquemaEstrito(f.entrada),
        strict: true,
      }));
  }

  async executar(
    contexto: ContextoSessao,
    nome: string,
    entrada: unknown,
  ): Promise<ResultadoExecucaoFerramenta> {
    const inicio = performance.now();
    const latencia = () => Math.round(performance.now() - inicio);
    const ferramenta = this.ferramentas.get(nome);
    if (!ferramenta) return { ok: false, erro: `Ferramenta desconhecida: ${nome}`, latenciaMs: latencia() };

    const validada = ferramenta.entrada.safeParse(entrada);
    if (!validada.success) {
      return {
        ok: false,
        erro: `Entrada inválida: ${z.prettifyError(validada.error)}`,
        latenciaMs: latencia(),
      };
    }
    try {
      if (
        ferramenta.efeito === "escreve_config" &&
        !(await this.confirmacoes.consumir(contexto, nome, validada.data))
      ) {
        const proposta = await this.confirmacoes.propor?.(contexto, ferramenta, validada.data);
        if (proposta) {
          return {
            ok: false,
            erro:
              `Nada foi alterado: a ação espera o "sim" do dono. Pergunte ao dono com estas palavras: "${proposta.pergunta}" ` +
              "Quando ele responder sim, o sistema registra por conta própria; não chame a ferramenta de novo.",
            latenciaMs: latencia(),
            confirmacao: proposta,
          };
        }
        return {
          ok: false,
          erro: `Ação sem confirmação do dono. Peça a confirmação antes de executar ${nome}.`,
          latenciaMs: latencia(),
        };
      }
      const saida = await ferramenta.executar(contexto, validada.data);
      return { ok: true, saida, latenciaMs: latencia() };
    } catch (e) {
      // Erro de ferramenta não derruba o fluxo: volta ao modelo como tool_result com is_error.
      const mensagem = e instanceof Error ? e.message : String(e);
      return { ok: false, erro: `Falha ao executar ${nome}: ${mensagem}`, latenciaMs: latencia() };
    }
  }

  /**
   * Executa uma escrita que o dono já confirmou. Só o código chama isto, ao ver o "sim" (issue #104);
   * a entrada guardada na proposta é validada de novo pelo esquema da ferramenta.
   */
  async executarConfirmada(
    contexto: ContextoSessao,
    nome: string,
    entrada: unknown,
  ): Promise<ResultadoExecucaoFerramenta> {
    const inicio = performance.now();
    const latencia = () => Math.round(performance.now() - inicio);
    const ferramenta = this.ferramentas.get(nome);
    if (ferramenta?.efeito !== "escreve_config") {
      return { ok: false, erro: `Ação não confirmável: ${nome}`, latenciaMs: latencia() };
    }
    const validada = ferramenta.entrada.safeParse(entrada);
    if (!validada.success) {
      return {
        ok: false,
        erro: `Entrada inválida: ${z.prettifyError(validada.error)}`,
        latenciaMs: latencia(),
      };
    }
    try {
      return { ok: true, saida: await ferramenta.executar(contexto, validada.data), latenciaMs: latencia() };
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : String(e);
      return { ok: false, erro: `Falha ao executar ${nome}: ${mensagem}`, latenciaMs: latencia() };
    }
  }
}
