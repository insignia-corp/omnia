import type { Executor } from "../infra/database/database.module";
import { chamadaFerramenta, execucaoAgente } from "../infra/database/schema";
import { CicloDoAlerta } from "./ciclo-do-alerta";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const escolha = (...ids: number[]) => ({
  alertas: ids.map((n) => ({ alerta_id: ID(n), justificativa: `porque ${n}` })),
});

/**
 * Banco falso: devolve linhas por tabela e guarda o que o UPDATE grava. Os filtros SQL (comerciante,
 * status) são provados pelo e2e com banco real; aqui só a lógica de quem é marcado e com quê.
 */
function dbFalso(opcoes: { resultado?: string | null; chamadas: unknown[] }) {
  const atualizacoes: Array<Record<string, unknown>> = [];
  const db = {
    select: () => ({
      from: (tabela: unknown) => ({
        where: () => {
          const linhas =
            tabela === execucaoAgente
              ? opcoes.resultado === null
                ? []
                : [{ resultado: opcoes.resultado ?? "aprovada" }]
              : tabela === chamadaFerramenta
                ? opcoes.chamadas.map((entrada) => ({ entrada }))
                : [];
          return Object.assign(Promise.resolve(linhas), { orderBy: () => Promise.resolve(linhas) });
        },
      }),
    }),
    update: () => ({
      set: (valores: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            atualizacoes.push(valores);
            return Promise.resolve([{ id: "linha" }]);
          },
        }),
      }),
    }),
  } as unknown as Executor;
  return { ciclo: new CicloDoAlerta(db), atualizacoes };
}

const QUANDO = new Date("2026-10-19T14:00:00Z");

describe("CicloDoAlerta.marcarEnviados", () => {
  it("marca os escolhidos com status, data, execução e justificativa", async () => {
    const { ciclo, atualizacoes } = dbFalso({ chamadas: [escolha(1, 2)] });
    expect(await ciclo.marcarEnviados("c1", "exec-1", QUANDO)).toBe(2);
    expect(atualizacoes).toEqual([
      { status: "enviado", enviadoEm: QUANDO, execucaoId: "exec-1", justificativa: "porque 1" },
      { status: "enviado", enviadoEm: QUANDO, execucaoId: "exec-1", justificativa: "porque 2" },
    ]);
  });

  it.each(["fallback_verificador", "fallback_erro", "recusa_modelo"])(
    "execução com resultado %s não marca nada",
    async (resultado) => {
      const { ciclo, atualizacoes } = dbFalso({ resultado, chamadas: [escolha(1)] });
      expect(await ciclo.marcarEnviados("c1", "exec-1", QUANDO)).toBe(0);
      expect(atualizacoes).toEqual([]);
    },
  );

  it("execução que não é do comerciante (não encontrada) não marca nada", async () => {
    const { ciclo, atualizacoes } = dbFalso({ resultado: null, chamadas: [escolha(1)] });
    expect(await ciclo.marcarEnviados("c1", "exec-1", QUANDO)).toBe(0);
    expect(atualizacoes).toEqual([]);
  });

  it("várias chamadas de select_alerts: vale só a última", async () => {
    const { ciclo, atualizacoes } = dbFalso({ chamadas: [escolha(1, 2, 3), escolha(4)] });
    expect(await ciclo.marcarEnviados("c1", "exec-1", QUANDO)).toBe(1);
    expect(atualizacoes.map((a) => a.justificativa)).toEqual(["porque 4"]);
  });

  it("entrada inválida ou sem alertas não marca nada", async () => {
    for (const chamadas of [
      [],
      [{ alertas: "x" }],
      [{ alertas: [{ alerta_id: "nao-uuid", justificativa: "x" }] }],
    ]) {
      const { ciclo, atualizacoes } = dbFalso({ chamadas });
      expect(await ciclo.marcarEnviados("c1", "exec-1", QUANDO)).toBe(0);
      expect(atualizacoes).toEqual([]);
    }
  });
});
