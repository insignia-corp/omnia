import { z } from "zod";

/**
 * Formato que o modelo com visão deve devolver para uma nota (guia, "Ingestão e extração de
 * notas"). A validação de forma é aqui; somas, CNPJ e data plausível são conferidos em código
 * pelo validador da extração (issue #24), nunca pelo modelo. Regra inviolável 5.
 */
const centavosInteiros = z.number().int().nonnegative();
const confianca = z.number().min(0).max(1);

export const itemExtraidoSchema = z.object({
  descricao: z.string().min(1),
  quantidade: z.number().positive(),
  unidade: z.string().min(1),
  valor_unitario_centavos: centavosInteiros,
  valor_total_centavos: centavosInteiros,
  confianca,
});

export const extracaoNotaSchema = z.object({
  fornecedor: z.object({
    nome: z.string().min(1),
    cnpj: z.string(),
  }),
  data_emissao: z.iso.date(),
  itens: z.array(itemExtraidoSchema).min(1),
  total_centavos: centavosInteiros,
  confianca_documento: confianca,
});

export type ItemExtraido = z.infer<typeof itemExtraidoSchema>;
export type ExtracaoNota = z.infer<typeof extracaoNotaSchema>;
