import { z } from "zod";

/** Limite de confiança abaixo do qual um item vai para revisão e gera pergunta ao dono. */
export const LIMITE_CONFIANCA_ITEM = 0.8;

const confianca = z.number().min(0).max(1);
const centavosInteiros = z.number().int().nonnegative();

export const itemExtraidoSchema = z.object({
  descricao: z.string().min(1),
  quantidade: z.number().positive(),
  unidade: z.string().min(1),
  valor_unitario_centavos: centavosInteiros,
  valor_total_centavos: centavosInteiros,
  confianca,
});

/**
 * Formato que o modelo com visão deve devolver para uma nota de compra (guia, "Ingestão e
 * extração de notas"). Soma, quantidade x valor, CNPJ e data são conferidos em código depois
 * deste esquema (issue #25); aqui só se garante a forma.
 */
export const extracaoNotaSchema = z.object({
  fornecedor: z.object({
    nome: z.string().min(1),
    /** Como impresso ou só dígitos; a comparação normaliza antes. */
    cnpj: z.string().min(1),
  }),
  /** Data ISO, ex.: "2026-10-15". */
  data_emissao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  itens: z.array(itemExtraidoSchema).min(1),
  total_centavos: centavosInteiros,
  confianca_documento: confianca,
});

export type ItemExtraido = z.infer<typeof itemExtraidoSchema>;
export type ExtracaoNota = z.infer<typeof extracaoNotaSchema>;
