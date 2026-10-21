/**
 * Prioridade e ordem dos candidatos (issue #44). Critério completo em src/alertas/README.md:
 * o impacto estimado em reais define o nível, a baixa confiança rebaixa um nível, e o mesmo
 * critério ordena dentro do nível.
 */
import type { LimitesDeAlerta } from "./limites";
import type { CandidatoDeAlerta } from "./regra";
import type { AlertaGravado } from "./repositorio-alertas";
import type { Prioridade } from "./tipos";

export function prioridadeDe(
  candidato: Pick<CandidatoDeAlerta, "impactoCentavos" | "confianca">,
  limites: LimitesDeAlerta,
): Prioridade {
  const { impactoCentavos, confianca } = candidato;
  // Sem impacto medido o candidato não vale mais que o nível mais baixo: sem número, sem urgência.
  let nivel: Prioridade = 3;
  if (impactoCentavos !== null) {
    if (impactoCentavos >= limites.prioridade1MinCentavos) nivel = 1;
    else if (impactoCentavos >= limites.prioridade2MinCentavos) nivel = 2;
  }
  // Confiança desconhecida vale como baixa (regra 4: todo dado carrega confiança).
  if ((confianca === null || confianca < limites.confiancaMinima) && nivel < 3) {
    nivel = (nivel + 1) as Prioridade;
  }
  return nivel;
}

/** Ordena as linhas lidas do banco pelo mesmo critério; impacto e confiança (`menor_confianca`, o campo que `select_alerts` lê) vêm de `metricas_apoio`. */
export function ordenarGravados<T extends AlertaGravado>(linhas: readonly T[]): T[] {
  const numero = (valor: unknown): number | null => (typeof valor === "number" ? valor : null);
  return linhas
    .map((l) => ({
      ...l,
      impactoCentavos: numero(l.metricasApoio.impacto_centavos),
      confianca: numero(l.metricasApoio.menor_confianca),
    }))
    .sort(compararCandidatos)
    .map(({ impactoCentavos: _i, confianca: _c, ...l }) => l as unknown as T);
}

/** Do mais ao menos importante: prioridade, maior impacto, maior confiança, depois tipo e chave (ordem estável). */
export function compararCandidatos(
  a: Pick<CandidatoDeAlerta, "tipo" | "chave" | "impactoCentavos" | "confianca"> & { prioridade: Prioridade },
  b: Pick<CandidatoDeAlerta, "tipo" | "chave" | "impactoCentavos" | "confianca"> & { prioridade: Prioridade },
): number {
  return (
    a.prioridade - b.prioridade ||
    (b.impactoCentavos ?? -1) - (a.impactoCentavos ?? -1) ||
    (b.confianca ?? -1) - (a.confianca ?? -1) ||
    (a.tipo < b.tipo ? -1 : a.tipo > b.tipo ? 1 : 0) ||
    (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0)
  );
}
