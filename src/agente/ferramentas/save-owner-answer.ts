import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db, Tx } from "../../infra/database/database.module";
import { historicoCusto, perguntaDono, produto } from "../../infra/database/schema";
import { centavos, formatarBRL } from "../../lib/dinheiro/dinheiro";
import { CAMPOS_DO_DONO, contextoPerguntaSchema, nomeSeguro } from "./ask-owner";
import { definirFerramenta } from "./ferramenta";

/**
 * Grava o custo unitário que o dono informou como linha NOVA em `historico_custo`, com origem
 * `dono` e confiança 1. Ancora na compra mais recente do produto (mesmo fornecedor, item e data):
 * o que veio da nota continua no histórico, nada é sobrescrito (regra inviolável 10).
 */
async function gravarCustoUnitario(tx: Tx, comercianteId: string, produtoId: string, valorCentavos: number) {
  const [base] = await tx
    .select()
    .from(historicoCusto)
    .where(and(eq(historicoCusto.comercianteId, comercianteId), eq(historicoCusto.produtoId, produtoId)))
    .orderBy(desc(historicoCusto.data), desc(historicoCusto.criadoEm))
    .limit(1);
  if (!base) throw new Error("O produto não tem nota registrada para ligar o custo informado");
  const [linha] = await tx
    .insert(historicoCusto)
    .values({
      comercianteId,
      produtoId,
      fornecedorId: base.fornecedorId,
      data: base.data,
      custoUnitarioCentavos: centavos(valorCentavos),
      itemDeCompraId: base.itemDeCompraId,
      origem: "dono",
      confianca: 1,
    })
    .returning({ id: historicoCusto.id });
  return linha!.id;
}

/**
 * Grava a resposta do dono a uma pergunta do `ask_owner` (issue #53). Efeito `escreve_config`: o
 * `RegistroFerramentas` só executa depois da confirmação do dono (regra inviolável 7). O produto e
 * o campo vêm da pergunta gravada em código, não do modelo; o modelo só informa o valor.
 */
export function criarSaveOwnerAnswer(db: Db) {
  return definirFerramenta({
    nome: "save_owner_answer",
    descricao:
      "Grava o dado que o dono informou em resposta a uma pergunta feita com ask_owner. Use o pergunta_id " +
      "devolvido por ask_owner e o valor exatamente como o dono disse, em centavos (R$ 12,90 vira 1290). " +
      "Só executa depois que o dono confirmar o valor; sem confirmação devolve erro e você deve pedi-la. " +
      "Não altera notas: o custo entra no histórico como informado pelo dono.",
    entrada: z.strictObject({
      pergunta_id: z.uuid().describe("Id devolvido por ask_owner."),
      campo: z.enum(CAMPOS_DO_DONO).describe("Dado que o dono informou."),
      valor_centavos: z.number().int().nonnegative().describe("Valor em centavos, inteiro."),
    }),
    efeito: "escreve_config",
    async descreverConfirmacao(contexto, entrada) {
      // Produto e campo vêm da pergunta gravada em código; o dono vê o valor que o modelo entendeu.
      const [pergunta] = await db
        .select({ contexto: perguntaDono.contexto })
        .from(perguntaDono)
        .where(
          and(
            eq(perguntaDono.id, entrada.pergunta_id),
            eq(perguntaDono.comercianteId, contexto.comercianteId),
          ),
        )
        .limit(1);
      const alvo = contextoPerguntaSchema.safeParse(pergunta?.contexto);
      if (!alvo.success) throw new Error("Pergunta não encontrada ou sem dado que o agente possa gravar");
      const [prod] = await db
        .select({ nome: produto.nome })
        .from(produto)
        .where(and(eq(produto.id, alvo.data.produto_id), eq(produto.comercianteId, contexto.comercianteId)))
        .limit(1);
      if (!prod) throw new Error("Produto não encontrado no cadastro");
      const valor = formatarBRL(centavos(entrada.valor_centavos));
      const nome = nomeSeguro(prod.nome);
      return {
        pergunta: `Confirma que o custo unitário atual de "${nome}" é ${valor}? Responda sim ou não.`,
        resumo: `Anotei ${valor} como custo unitário atual de "${nome}".`,
      };
    },
    async executar(contexto, entrada) {
      const { comercianteId } = contexto;
      return (contexto.executor ?? db).transaction(async (tx) => {
        const [pergunta] = await tx
          .select()
          .from(perguntaDono)
          .where(and(eq(perguntaDono.id, entrada.pergunta_id), eq(perguntaDono.comercianteId, comercianteId)))
          .for("update")
          .limit(1);
        if (!pergunta) throw new Error("Pergunta não encontrada");
        if (pergunta.status !== "pendente") throw new Error("Esta pergunta já foi respondida");
        const alvo = contextoPerguntaSchema.safeParse(pergunta.contexto);
        if (!alvo.success) throw new Error("Esta pergunta não pede um dado que o agente possa gravar");
        if (alvo.data.campo !== entrada.campo) {
          throw new Error("O campo informado não é o da pergunta");
        }

        // Um único campo hoje; o `switch` obriga a tratar o campo novo quando entrar na lista.
        switch (alvo.data.campo) {
          case "custo_unitario_produto":
            await gravarCustoUnitario(tx, comercianteId, alvo.data.produto_id, entrada.valor_centavos);
        }

        await tx
          .update(perguntaDono)
          .set({
            status: "respondida",
            resposta: JSON.stringify({ campo: entrada.campo, valor_centavos: entrada.valor_centavos }),
            respondidaEm: new Date(),
          })
          .where(and(eq(perguntaDono.id, pergunta.id), eq(perguntaDono.comercianteId, comercianteId)));
        const [prod] = await tx
          .select({ nome: produto.nome })
          .from(produto)
          .where(and(eq(produto.id, alvo.data.produto_id), eq(produto.comercianteId, comercianteId)))
          .limit(1);
        return {
          pergunta_id: pergunta.id,
          campo: entrada.campo,
          produto_id: alvo.data.produto_id,
          // O nome pode ter número ("Arroz 5kg"): ele precisa estar na saída para o aviso passar no verificador.
          produto_nome: prod ? nomeSeguro(prod.nome) : null,
          valor_centavos: entrada.valor_centavos,
          gravado: true as const,
        };
      });
    },
  });
}
