import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import type { ContextoSessao, Ferramenta } from "./ferramenta";

export type ResultadoExecucaoFerramenta =
  { ok: true; saida: unknown; latenciaMs: number } | { ok: false; erro: string; latenciaMs: number };

const CHAVES_PROIBIDAS = ["comerciante_id", "comercianteId"];

/** Ferramentas disponíveis ao agente. Valida a entrada antes de executar. */
export class RegistroFerramentas {
  private readonly ferramentas = new Map<string, Ferramenta>();

  constructor(ferramentas: Ferramenta[] = []) {
    for (const f of ferramentas) this.registrar(f);
  }

  registrar(ferramenta: Ferramenta): void {
    if (this.ferramentas.has(ferramenta.nome)) throw new Error(`Ferramenta duplicada: ${ferramenta.nome}`);
    const chaves = Object.keys(ferramenta.entrada.shape);
    const proibida = chaves.find((c) => CHAVES_PROIBIDAS.includes(c));
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
      const saida = await ferramenta.executar(contexto, validada.data);
      return { ok: true, saida, latenciaMs: latencia() };
    } catch (e) {
      // Erro de ferramenta não derruba o fluxo: volta ao modelo como tool_result com is_error.
      const mensagem = e instanceof Error ? e.message : String(e);
      return { ok: false, erro: `Falha ao executar ${nome}: ${mensagem}`, latenciaMs: latencia() };
    }
  }
}
