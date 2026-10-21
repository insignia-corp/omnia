import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../infra/database/database.module";
import { historicoCusto, perguntaDono, produto } from "../../infra/database/schema";
import { definirFerramenta } from "./ferramenta";

/** Dados que o dono pode informar ao agente. Lista fechada: campo novo exige código novo (regra 7). */
export const CAMPOS_DO_DONO = ["custo_unitario_produto"] as const;

/**
 * O que fica em `pergunta_dono.contexto` para uma pergunta do agente: só ids e o campo, escolhidos
 * em código. Nenhum texto livre de nota entra aqui (regra inviolável 6).
 */
export const contextoPerguntaSchema = z.strictObject({
  campo: z.enum(CAMPOS_DO_DONO),
  produto_id: z.uuid(),
});

const NOME_MAXIMO = 80;

/** Nome de cadastro pronto para entrar num texto montado em código: sem controle nem aspas, com teto. */
export function nomeSeguro(nomeProduto: string): string {
  return nomeProduto
    .replace(/[\p{Cc}"]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NOME_MAXIMO);
}

/** Texto da pergunta ao dono, montado em código. O nome do produto é cadastro, não instrução. */
export function montarTextoPergunta(nomeProduto: string): string {
  const nome = nomeSeguro(nomeProduto);
  return `Qual é o custo unitário atual de "${nome}"? Pode responder em reais, por exemplo 12,90.`;
}

/**
 * Registra uma pergunta ao dono (issue #53). A ferramenta só grava a `pergunta_dono` e devolve o
 * texto: quem envia é o canal, com a mensagem final do agente já aprovada pelo verificador.
 */
export function criarAskOwner(db: Db) {
  return definirFerramenta({
    nome: "ask_owner",
    descricao:
      "Registra uma pergunta ao dono quando falta um dado que só ele sabe, como o custo unitário atual " +
      "de um produto. Devolve pergunta_id e o texto da pergunta; inclua esse texto na sua mensagem final. " +
      "Depois que o dono responder, use save_owner_answer com o pergunta_id. Se o produto não tiver nota " +
      "registrada, devolve ausente e não pergunta.",
    entrada: z.strictObject({
      campo: z.enum(CAMPOS_DO_DONO).describe("Qual dado perguntar."),
      produto_id: z.uuid().describe("Id do produto, como devolvido pelas ferramentas de leitura."),
    }),
    efeito: "pergunta_dono",
    async executar(contexto, entrada) {
      const { comercianteId } = contexto;
      return db.transaction(async (tx) => {
        // Serializa chamadas iguais: o dono não recebe duas perguntas idênticas por corrida.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`ask_owner:${comercianteId}:${entrada.campo}:${entrada.produto_id}`}))`,
        );
        const [prod] = await tx
          .select({ nome: produto.nome })
          .from(produto)
          .where(and(eq(produto.id, entrada.produto_id), eq(produto.comercianteId, comercianteId)))
          .limit(1);
        if (!prod) return { ausente: true as const, motivo: "Produto não encontrado no cadastro." };

        // O custo informado entra como linha nova ligada a uma compra do produto; sem nota não há onde ligar.
        const [base] = await tx
          .select({ id: historicoCusto.id })
          .from(historicoCusto)
          .where(
            and(eq(historicoCusto.comercianteId, comercianteId), eq(historicoCusto.produtoId, entrada.produto_id)),
          )
          .limit(1);
        if (!base) return { ausente: true as const, motivo: "O produto não tem nota registrada." };

        const [aberta] = await tx
          .select({ id: perguntaDono.id, pergunta: perguntaDono.pergunta })
          .from(perguntaDono)
          .where(
            and(
              eq(perguntaDono.comercianteId, comercianteId),
              eq(perguntaDono.tipo, "informar_custo"),
              eq(perguntaDono.status, "pendente"),
              sql`${perguntaDono.contexto}->>'campo' = ${entrada.campo}`,
              sql`${perguntaDono.contexto}->>'produto_id' = ${entrada.produto_id}`,
            ),
          )
          .limit(1);
        if (aberta) return { pergunta_id: aberta.id, texto: aberta.pergunta, ja_pendente: true };

        const texto = montarTextoPergunta(prod.nome);
        const [criada] = await tx
          .insert(perguntaDono)
          .values({
            comercianteId,
            tipo: "informar_custo",
            pergunta: texto,
            contexto: { campo: entrada.campo, produto_id: entrada.produto_id },
          })
          .returning({ id: perguntaDono.id });
        return { pergunta_id: criada!.id, texto, ja_pendente: false };
      });
    },
  });
}
