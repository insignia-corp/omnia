import { and, desc, eq, ne } from "drizzle-orm";
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
 * O mais antigo primeiro; só o comerciante da sessão. `excluirMensagemId` tira a mensagem que está
 * sendo respondida, caso o canal já a tenha gravado: ela entra no pedido, não no histórico.
 */
export async function carregarHistorico(
  db: Executor,
  comercianteId: string,
  maxTurnos: number,
  excluirMensagemId?: string,
): Promise<TurnoConversa[]> {
  if (maxTurnos <= 0) return [];
  const linhas = await db
    .select({ direcao: mensagem.direcao, texto: mensagem.texto })
    .from(mensagem)
    .where(
      and(
        eq(mensagem.comercianteId, comercianteId),
        ...(excluirMensagemId ? [ne(mensagem.id, excluirMensagemId)] : []),
      ),
    )
    .orderBy(desc(mensagem.criadoEm), desc(mensagem.id))
    .limit(maxTurnos);
  return linhas.reverse().map((l) => ({
    papel: l.direcao === "recebida" ? "dono" : "assistente",
    texto: l.texto,
  }));
}
