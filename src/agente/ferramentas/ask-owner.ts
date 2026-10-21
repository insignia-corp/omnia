import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../infra/database/database.module";
import { fornecedor, historicoCusto, perguntaDono, produto } from "../../infra/database/schema";
import { definirFerramenta } from "./ferramenta";

/** Dados que o dono pode informar ao agente. Lista fechada: campo novo exige código novo (regra 7). */
export const CAMPOS_DO_DONO = ["custo_unitario_produto"] as const;

/**
 * O que fica em `pergunta_dono.contexto` para uma pergunta do agente: só ids e o campo, escolhidos
 * em código. Nenhum texto livre de nota entra aqui (regra inviolável 6). O fornecedor faz parte da
 * pergunta porque o custo de um produto pode diferir entre fornecedores, e o histórico guarda os dois.
 */
export const contextoPerguntaSchema = z.strictObject({
  campo: z.enum(CAMPOS_DO_DONO),
  produto_id: z.uuid(),
  fornecedor_id: z.uuid(),
});

const NOME_MAXIMO = 80;

/** Nome de cadastro para dentro de um texto: sem aspas nem quebras de linha, e curto. */
function limparNome(nome: string): string {
  return nome
    .replace(/[\p{Cc}"]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NOME_MAXIMO);
}

/**
 * Texto da pergunta ao dono, montado em código. Os nomes são cadastro, não instrução. Sem exemplo de
 * valor: o resultado da ferramenta autoriza os números no verificador (regra 8), e um valor de
 * exemplo passaria por dado do comerciante.
 */
export function montarTextoPergunta(nomeProduto: string, nomeFornecedor?: string): string {
  const deQuem = nomeFornecedor ? ` comprado de "${limparNome(nomeFornecedor)}"` : "";
  return `Qual é o custo unitário atual de "${limparNome(nomeProduto)}"${deQuem}? Pode responder em reais.`;
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
      "Se o produto foi comprado de mais de um fornecedor, devolve a lista (precisa_fornecedor) e você " +
      "deve repetir a chamada com o fornecedor_id escolhido, sem adivinhar. Se o produto não tiver nota " +
      "registrada, devolve ausente e não pergunta. Depois que o dono responder, use save_owner_answer.",
    entrada: z.strictObject({
      campo: z.enum(CAMPOS_DO_DONO).describe("Qual dado perguntar."),
      produto_id: z.uuid().describe("Id do produto, como devolvido pelas ferramentas de leitura."),
      fornecedor_id: z
        .uuid()
        .optional()
        .describe("Só quando a ferramenta pedir: id do fornecedor da lista devolvida."),
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
        const fornecedores = await tx
          .select({ id: historicoCusto.fornecedorId, nome: fornecedor.nome })
          .from(historicoCusto)
          .innerJoin(
            fornecedor,
            and(
              eq(fornecedor.id, historicoCusto.fornecedorId),
              eq(fornecedor.comercianteId, historicoCusto.comercianteId),
            ),
          )
          .where(
            and(
              eq(historicoCusto.comercianteId, comercianteId),
              eq(historicoCusto.produtoId, entrada.produto_id),
            ),
          )
          .groupBy(historicoCusto.fornecedorId, fornecedor.nome)
          .orderBy(asc(fornecedor.nome), asc(historicoCusto.fornecedorId));
        if (fornecedores.length === 0) {
          return { ausente: true as const, motivo: "O produto não tem nota registrada." };
        }

        let escolhido = fornecedores.length === 1 ? fornecedores[0] : undefined;
        if (entrada.fornecedor_id) {
          escolhido = fornecedores.find((f) => f.id === entrada.fornecedor_id);
          if (!escolhido) {
            return { ausente: true as const, motivo: "O produto não tem compra desse fornecedor." };
          }
        }
        if (!escolhido) {
          // O custo é de uma compra de um fornecedor; não se escolhe um por ele (proveniência do dado).
          return {
            precisa_fornecedor: true as const,
            motivo:
              "O produto tem mais de um fornecedor. Pergunte ao dono de qual deles e repita com fornecedor_id.",
            fornecedores: fornecedores.map((f) => ({ fornecedor_id: f.id, nome: limparNome(f.nome) })),
          };
        }

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
              sql`${perguntaDono.contexto}->>'fornecedor_id' = ${escolhido.id}`,
            ),
          )
          .limit(1);
        if (aberta) return { pergunta_id: aberta.id, texto: aberta.pergunta, ja_pendente: true };

        const texto = montarTextoPergunta(prod.nome, fornecedores.length > 1 ? escolhido.nome : undefined);
        const [criada] = await tx
          .insert(perguntaDono)
          .values({
            comercianteId,
            tipo: "informar_custo",
            pergunta: texto,
            contexto: { campo: entrada.campo, produto_id: entrada.produto_id, fornecedor_id: escolhido.id },
          })
          .returning({ id: perguntaDono.id });
        return { pergunta_id: criada!.id, texto, ja_pendente: false };
      });
    },
  });
}
