import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import type { ContextoSessao, Ferramenta } from "./ferramenta";

export type ResultadoExecucaoFerramenta =
  { ok: true; saida: unknown; latenciaMs: number } | { ok: false; erro: string; latenciaMs: number };

/** Comparadas sem maiúsculas e separadores: pega comerciante_id, comercianteId e comerciante-id. */
const CHAVES_PROIBIDAS = new Set(["comercianteid"]);

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
        input_schema: z.toJSONSchema(f.entrada, { target: "draft-7" }) as BetaTool["input_schema"],
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
}
