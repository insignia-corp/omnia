import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, Tx } from "../../infra/database/database.module";
import { historicoCusto, perguntaDono } from "../../infra/database/schema";
import { formatarBRL, parseCentavos } from "../../lib/dinheiro/dinheiro";
import { CAMPOS_DO_DONO, contextoPerguntaSchema } from "./ask-owner";
import { definirFerramenta } from "./ferramenta";

/** O texto do dono vira centavos em código, nunca pela conta do modelo (regras 1 e 2). */
function valorValido(texto: string): boolean {
  try {
    parseCentavos(texto);
    return true;
  } catch {
    return false;
  }
}

/**
 * Grava o custo unitário que o dono informou como linha NOVA em `historico_custo`, com origem
 * `dono` e confiança 1. O histórico exige fornecedor, item e data: eles vêm da compra mais recente
 * DAQUELE fornecedor, que a pergunta fixou. Servem de âncora; o que veio da nota continua intacto
 * e nada é sobrescrito (regra inviolável 10).
 */
async function gravarCustoUnitario(
  tx: Tx,
  comercianteId: string,
  produtoId: string,
  fornecedorId: string,
  valorCentavos: number,
) {
  const [base] = await tx
    .select()
    .from(historicoCusto)
    .where(
      and(
        eq(historicoCusto.comercianteId, comercianteId),
        eq(historicoCusto.produtoId, produtoId),
        eq(historicoCusto.fornecedorId, fornecedorId),
      ),
    )
    .orderBy(desc(historicoCusto.data), desc(historicoCusto.criadoEm))
    .limit(1);
  if (!base) throw new Error("O produto não tem compra desse fornecedor para ligar o custo informado");
  const [linha] = await tx
    .insert(historicoCusto)
    .values({
      comercianteId,
      produtoId,
      fornecedorId,
      data: base.data,
      custoUnitarioCentavos: valorCentavos,
      itemDeCompraId: base.itemDeCompraId,
      origem: "dono",
      confianca: 1,
    })
    .returning({ id: historicoCusto.id });
  return linha!.id;
}

/**
 * Pergunta que esta resposta fecha. Com `pergunta_id`, é a indicada. Sem ele (o dono responde numa
 * conversa nova, em que o modelo não tem o id), é a única pergunta pendente do dado; havendo mais de
 * uma, devolve a lista para o agente perguntar de qual se trata.
 */
async function acharPergunta(tx: Tx, comercianteId: string, campo: string, perguntaId: string | undefined) {
  if (perguntaId) {
    const [pergunta] = await tx
      .select()
      .from(perguntaDono)
      .where(and(eq(perguntaDono.id, perguntaId), eq(perguntaDono.comercianteId, comercianteId)))
      .for("update")
      .limit(1);
    if (!pergunta) throw new Error("Pergunta não encontrada");
    return pergunta;
  }
  const pendentes = await tx
    .select()
    .from(perguntaDono)
    .where(
      and(
        eq(perguntaDono.comercianteId, comercianteId),
        eq(perguntaDono.tipo, "informar_custo"),
        eq(perguntaDono.status, "pendente"),
        sql`${perguntaDono.contexto}->>'campo' = ${campo}`,
      ),
    )
    .orderBy(asc(perguntaDono.criadoEm))
    .for("update");
  if (pendentes.length === 0) {
    throw new Error("Não há pergunta pendente para este dado. Use ask_owner antes de gravar.");
  }
  if (pendentes.length > 1) {
    const lista = pendentes.map((p) => `${p.id}: ${p.pergunta}`).join(" | ");
    throw new Error(`Há ${pendentes.length} perguntas pendentes. Repita com pergunta_id. ${lista}`);
  }
  return pendentes[0]!;
}

/**
 * Grava a resposta do dono a uma pergunta do `ask_owner` (issue #53). Efeito `escreve_config`: o
 * `RegistroFerramentas` só executa depois da confirmação do dono (regra inviolável 7). Produto e
 * fornecedor vêm da pergunta gravada em código; o modelo só repassa o que o dono escreveu.
 */
export function criarSaveOwnerAnswer(db: Db) {
  return definirFerramenta({
    nome: "save_owner_answer",
    descricao:
      "Grava o dado que o dono informou em resposta a uma pergunta feita com ask_owner. Passe em " +
      "valor_informado o valor exatamente como o dono escreveu (por exemplo, o texto da resposta dele), " +
      "sem converter nem calcular: o código lê o valor. A pergunta é a pendente do dado; só informe " +
      "pergunta_id se a ferramenta pedir. Só executa depois que o dono confirmar o valor; sem " +
      "confirmação devolve erro e você deve pedi-la. Não altera notas: o custo entra no histórico " +
      "como informado pelo dono.",
    entrada: z.strictObject({
      pergunta_id: z
        .uuid()
        .optional()
        .describe("Id de ask_owner. Só quando houver mais de uma pergunta pendente."),
      campo: z.enum(CAMPOS_DO_DONO).describe("Dado que o dono informou."),
      valor_informado: z
        .string()
        .trim()
        .min(1)
        .max(30)
        .refine(valorValido, "Não consegui ler o valor. Passe só o valor em reais, como o dono escreveu.")
        .describe("Valor em reais como o dono escreveu, por exemplo o número da resposta dele."),
    }),
    efeito: "escreve_config",
    async executar(contexto, entrada) {
      const { comercianteId } = contexto;
      const valorCentavos = parseCentavos(entrada.valor_informado);
      return db.transaction(async (tx) => {
        const pergunta = await acharPergunta(tx, comercianteId, entrada.campo, entrada.pergunta_id);
        if (pergunta.status !== "pendente") throw new Error("Esta pergunta já foi respondida");
        const alvo = contextoPerguntaSchema.safeParse(pergunta.contexto);
        if (!alvo.success) throw new Error("Esta pergunta não pede um dado que o agente possa gravar");
        if (alvo.data.campo !== entrada.campo) {
          throw new Error("O campo informado não é o da pergunta");
        }

        // Um único campo hoje; o `switch` obriga a tratar o campo novo quando entrar na lista.
        switch (alvo.data.campo) {
          case "custo_unitario_produto":
            await gravarCustoUnitario(
              tx,
              comercianteId,
              alvo.data.produto_id,
              alvo.data.fornecedor_id,
              valorCentavos,
            );
        }

        await tx
          .update(perguntaDono)
          .set({
            status: "respondida",
            resposta: JSON.stringify({ campo: entrada.campo, valor_centavos: valorCentavos }),
            respondidaEm: new Date(),
          })
          .where(and(eq(perguntaDono.id, pergunta.id), eq(perguntaDono.comercianteId, comercianteId)));
        return {
          pergunta_id: pergunta.id,
          campo: entrada.campo,
          produto_id: alvo.data.produto_id,
          fornecedor_id: alvo.data.fornecedor_id,
          valor_centavos: valorCentavos,
          valor: formatarBRL(valorCentavos),
          gravado: true as const,
        };
      });
    },
  });
}
