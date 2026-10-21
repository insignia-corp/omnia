/**
 * Mediana e desvio absoluto mediano de valores inteiros (centavos) sem sair dos inteiros. A
 * mediana de um número par de valores é a média dos dois do meio e pode cair em meio centavo, e o
 * desvio absoluto mediano em um quarto; por isso os resultados vêm em meios e em quartos, e
 * quem exibe arredonda uma vez, no fim. Este módulo não depende do resto da aplicação.
 */

/** O dobro da mediana: inteiro mesmo quando a mediana cai entre dois valores. */
export function medianaEmMeios(valores: readonly number[]): number {
  if (valores.length === 0) throw new RangeError("Mediana de lista vazia");
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  const central = ordenados[meio] ?? 0;
  return ordenados.length % 2 === 1 ? 2 * central : (ordenados[meio - 1] ?? 0) + central;
}

export interface MedianaEDesvio {
  /** O dobro da mediana. */
  medianaEmMeios: number;
  /** O quádruplo do desvio absoluto mediano (mediana dos |valor - mediana|). */
  desvioEmQuartos: number;
}

export function medianaEDesvioAbsolutoMediano(valores: readonly number[]): MedianaEDesvio {
  const emMeios = medianaEmMeios(valores);
  // |valor - mediana| = |2 * valor - emMeios| / 2, então o dobro da mediana desses módulos
  // (que ainda estão em meios) é o quádruplo do desvio.
  const desvioEmQuartos = medianaEmMeios(valores.map((v) => Math.abs(2 * v - emMeios)));
  return { medianaEmMeios: emMeios, desvioEmQuartos };
}
