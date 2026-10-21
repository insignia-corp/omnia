import { and, desc, eq, lt, or } from "drizzle-orm";
import type { Executor } from "../../infra/database/database.module";
import { mensagem } from "../../infra/database/schema";

/** Uma fala da conversa entre o dono e o assistente, como o agente recebe. */
export interface TurnoConversa {
  papel: "dono" | "assistente";
  texto: string;
}

/**
 * Histórico curto da conversa, lido do banco a cada execução (regra inviolável 11: o processo não
 * guarda estado). As mensagens do assistente já passaram pelo verificador ou são fallback sem número.
 * O mais antigo primeiro; só o comerciante da sessão. `mensagemAtualId` é a mensagem que está sendo
 * respondida, caso o canal já a tenha gravado: ela e as posteriores ficam de fora, e ela entra no pedido.
 *
 * Quem chama é o canal (modo conversa, plano C): grava a mensagem recebida, carrega o histórico com
 * `AGENTE_HISTORICO_TURNOS` e passa o resultado em `PedidoAgente.historico`.
 */
export async function carregarHistorico(
  db: Executor,
  comercianteId: string,
  maxTurnos: number,
  mensagemAtualId?: string,
): Promise<TurnoConversa[]> {
  if (maxTurnos <= 0) return [];
  // Só o que veio antes da mensagem atual (data de criação e id como desempate): se duas mensagens do
  // dono chegarem antes de a primeira ser respondida, a mais nova não vira "histórico" da mais antiga.
  let anteriores;
  if (mensagemAtualId) {
    const [atual] = await db
      .select({ criadoEm: mensagem.criadoEm, id: mensagem.id })
      .from(mensagem)
      .where(and(eq(mensagem.id, mensagemAtualId), eq(mensagem.comercianteId, comercianteId)))
      .limit(1);
    if (atual) {
      anteriores = or(
        lt(mensagem.criadoEm, atual.criadoEm),
        and(eq(mensagem.criadoEm, atual.criadoEm), lt(mensagem.id, atual.id)),
      );
    }
  }
  const linhas = await db
    .select({ direcao: mensagem.direcao, texto: mensagem.texto })
    .from(mensagem)
    .where(and(eq(mensagem.comercianteId, comercianteId), anteriores))
    .orderBy(desc(mensagem.criadoEm), desc(mensagem.id))
    .limit(maxTurnos);
  return linhas.reverse().map((l) => ({
    papel: l.direcao === "recebida" ? "dono" : "assistente",
    texto: l.texto,
  }));
}
