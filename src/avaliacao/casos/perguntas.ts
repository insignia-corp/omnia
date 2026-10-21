import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const esquemaPergunta = z.object({
  id: z.string().min(1),
  tipo: z.enum(["numerica", "sem_resposta", "injecao", "acao_com_confirmacao"]),
  pergunta: z.string().min(1),
  ferramentas_esperadas: z.array(z.string()),
  numeros_esperados: z.array(
    z.object({
      rotulo: z.string(),
      valor: z.number(),
      unidade: z.enum(["centavos", "cupons", "unidades", "dias", "percentual"]),
    }),
  ),
  textos_esperados: z.array(z.string()),
  comportamento_esperado: z.string(),
});

export type PerguntaAvaliacao = z.infer<typeof esquemaPergunta>;

/** Perguntas do gabarito (`fixtures/avaliacao/perguntas.json`): todo número esperado vem de lá. */
export function carregarPerguntas(raiz = process.cwd()): PerguntaAvaliacao[] {
  const bruto: unknown = JSON.parse(readFileSync(resolve(raiz, "fixtures/avaliacao/perguntas.json"), "utf8"));
  return z.array(esquemaPergunta).parse(bruto);
}

export function perguntaPorId(id: string, perguntas = carregarPerguntas()): PerguntaAvaliacao {
  const p = perguntas.find((x) => x.id === id);
  if (!p) throw new Error(`Pergunta ${id} não existe em fixtures/avaliacao/perguntas.json`);
  return p;
}
