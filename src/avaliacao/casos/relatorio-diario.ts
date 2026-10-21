import { z } from "zod";
import { definirFerramenta, type Ferramenta } from "../../agente/ferramentas/ferramenta";
import { centavos, formatarBRL } from "../../lib/dinheiro/dinheiro";
import { chamar, texto } from "../modelo-roteirizado";
import type { CasoAvaliacao } from "../tipos";

/**
 * Relatório diário para medir custo e tempo (#74). É o gatilho que mais pesa no custo mensal e o único
 * que o eval ainda não exercia, porque `list_alert_candidates` (#52) é do plano A e ainda não existe.
 * Até lá, dois dublês entregam candidatos do gabarito (`fixtures/gabarito/metricas.json`, alertas
 * esperados) e o modelo, real ou roteirizado, escolhe e escreve como no fluxo de produção. O caso
 * não julga a escolha (falta o top 3 aceitável no gabarito): só exige uma mensagem aprovada pelo verificador.
 * Trocar os dublês pela ferramenta real é só apagar `ferramentasFalsas` e `dubleNoModoReal`.
 */

interface Candidato {
  alerta_id: string;
  tipo: string;
  prioridade: number;
  produto: string | null;
  metricas: Record<string, number>;
}

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

/** Valores de `alertas_esperados` do gabarito: reajuste do arroz e do óleo, gasto fora do padrão de 19/10. */
const CANDIDATOS: Candidato[] = [
  {
    alerta_id: id(1),
    tipo: "reajuste_de_custo",
    prioridade: 1,
    produto: "Arroz branco tipo 1 5kg",
    metricas: {
      custo_anterior_centavos: 2490,
      custo_atual_centavos: 2790,
      variacao_percentual: 12.05,
      menor_confianca: 1,
    },
  },
  {
    alerta_id: id(2),
    tipo: "reajuste_de_custo",
    prioridade: 2,
    produto: "Óleo de soja 900ml",
    metricas: {
      custo_anterior_centavos: 520,
      custo_atual_centavos: 560,
      variacao_percentual: 7.69,
      menor_confianca: 1,
    },
  },
  {
    alerta_id: id(3),
    tipo: "gasto_fora_do_padrao",
    prioridade: 3,
    produto: null,
    metricas: { valor_centavos: 101534, mediana_centavos: 6093, menor_confianca: 1 },
  },
  {
    alerta_id: id(4),
    tipo: "margem_abaixo_da_meta",
    prioridade: 4,
    produto: "Arroz branco tipo 1 5kg",
    metricas: { margem_percentual: 20.26, meta_percentual: 25, menor_confianca: 1 },
  },
];

function listAlertCandidates(): Ferramenta {
  return definirFerramenta({
    nome: "list_alert_candidates",
    descricao:
      "Candidatos a alerta do dia, do mais ao menos prioritário, com as métricas de apoio de cada um. " +
      "Use os ids com select_alerts. Sem candidato, diga que hoje não há nada que exija atenção.",
    entrada: z.strictObject({}),
    efeito: "nenhum",
    executar: () => Promise.resolve({ candidatos: CANDIDATOS, menor_confianca: 1 }),
  });
}

function selectAlerts(): Ferramenta {
  return definirFerramenta({
    nome: "select_alerts",
    descricao:
      "Escolhe, entre os candidatos de list_alert_candidates, até 3 alertas para a mensagem do dia, do mais " +
      "importante ao menos importante, com uma justificativa curta. Chame antes de escrever o relatório. " +
      "Devolve os dados de cada alerta escolhido; use só esses números na mensagem.",
    entrada: z.strictObject({
      alertas: z
        .array(
          z.strictObject({
            alerta_id: z.uuid().describe("Id do candidato, como veio em list_alert_candidates"),
            justificativa: z.string().trim().min(1).max(240),
          }),
        )
        .min(1)
        .max(3),
    }),
    efeito: "nenhum",
    executar: (_contexto, entrada) => {
      const porId = new Map(CANDIDATOS.map((c) => [c.alerta_id, c]));
      const desconhecidos = entrada.alertas.filter((a) => !porId.has(a.alerta_id));
      if (desconhecidos.length > 0) {
        return Promise.reject(
          new Error(`Não são candidatos de hoje: ${desconhecidos.map((a) => a.alerta_id).join(", ")}.`),
        );
      }
      return Promise.resolve({
        selecionados: entrada.alertas.map((a, i) => ({ ordem: i + 1, ...porId.get(a.alerta_id)! })),
        menor_confianca: 1,
      });
    },
  });
}

const reais = (c: number) => formatarBRL(centavos(c));

export function casosDeMedicao(): CasoAvaliacao[] {
  return [
    {
      id: "d01",
      categoria: "medicao",
      descricao:
        "Relatório diário (mede custo e tempo; list_alert_candidates e select_alerts são dublês com dados do gabarito até a #52)",
      gatilho: "relatorio_diario",
      entrada: "Relatório diário do comércio.",
      ferramentasEsperadas: ["list_alert_candidates", "select_alerts"],
      criterio: { tipo: "medicao" },
      ferramentasFalsas: [listAlertCandidates(), selectAlerts()],
      dubleNoModoReal: true,
      roteiro: [
        chamar("list_alert_candidates", {}, "t1"),
        chamar(
          "select_alerts",
          {
            alertas: [
              { alerta_id: id(1), justificativa: "Maior reajuste do período, em produto de giro alto." },
              { alerta_id: id(2), justificativa: "Segundo reajuste do mesmo fornecedor." },
              { alerta_id: id(3), justificativa: "Gasto muito acima do padrão do dia." },
            ],
          },
          "t2",
        ),
        texto(
          `Reajuste do Arroz branco tipo 1 5kg: o custo subiu de ${reais(2490)} para ${reais(2790)}, alta de 12,05%. ` +
            `Reajuste do Óleo de soja 900ml: de ${reais(520)} para ${reais(560)}, alta de 7,69%. ` +
            `Gasto fora do padrão: ${reais(101534)} no dia, contra a mediana de ${reais(6093)}. ` +
            "Vale rever o preço de venda desses produtos.",
        ),
      ],
    },
  ];
}
