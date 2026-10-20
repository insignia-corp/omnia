/** Aritmética inteira usada pelos gabaritos. Nenhum ponto flutuante em dinheiro ou razão. */

/** Divisão inteira com arredondamento meio para cima (para longe do zero em empates). */
export function dividirArredondando(numerador: number, denominador: number): number {
  if (denominador === 0) throw new Error("Divisão por zero");
  const sinal = Math.sign(numerador) * Math.sign(denominador);
  const n = Math.abs(numerador);
  const d = Math.abs(denominador);
  return sinal * Math.floor((2 * n + d) / (2 * d));
}

/** Razão em pontos-base (1% = 100). */
export function razaoEmBps(numerador: number, denominador: number): number {
  return dividirArredondando(numerador * 10_000, denominador);
}

/** Pontos-base para percentual com uma casa, pronto para exibir (ex.: 3061 vira 30.6). */
export function bpsParaPercentual(bps: number): number {
  return dividirArredondando(bps, 10) / 10;
}

/** Mediana de inteiros; em quantidade par, média das duas centrais arredondada para baixo. */
export function mediana(valores: readonly number[]): number {
  if (valores.length === 0) throw new Error("Mediana de lista vazia");
  const ordenado = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenado.length / 2);
  const central = ordenado[meio] ?? 0;
  if (ordenado.length % 2 === 1) return central;
  return Math.floor(((ordenado[meio - 1] ?? 0) + central) / 2);
}
