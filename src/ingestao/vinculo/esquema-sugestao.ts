import { z } from "zod";

/**
 * O que o modelo devolve. Ele só vê e cita referências locais (`i1`, `p1`...), nunca ids do banco:
 * quem traduz a referência para o produto é o código, e referência que não foi enviada é descartada.
 */
export const sugestaoModeloSchema = z.object({
  sugestoes: z
    .array(
      z.object({
        item: z.string().regex(/^i\d{1,3}$/),
        /** Nulo quando nenhum produto do catálogo é claramente o mesmo. */
        produto: z
          .string()
          .regex(/^p\d{1,4}$/)
          .nullable(),
        confianca: z.number().min(0).max(1),
      }),
    )
    .max(100),
});

export type SugestaoModeloBruta = z.infer<typeof sugestaoModeloSchema>;
