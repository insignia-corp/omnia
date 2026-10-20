/**
 * Razões em pontos-base inteiros (2500 = 25,00%). Margem, variação e giro são comparados com
 * limites em bps, então a conta não passa por percentuais em ponto flutuante.
 * Este módulo não depende do resto da aplicação.
 */

/**
 * `numerador / denominador` em pontos-base, arredondado meio para cima (afastando do zero, como
 * `multiplicar` em src/lib/dinheiro). Devolve null quando o divisor é zero.
 */
export function razaoEmBps(numerador: number, denominador: number): number | null {
  if (!Number.isFinite(numerador) || !Number.isFinite(denominador)) {
    throw new RangeError(`Razão exige números finitos, recebido: ${numerador} / ${denominador}`);
  }
  if (denominador === 0) return null;
  const sinal = Math.sign(numerador) * Math.sign(denominador);
  const bps = Math.floor((Math.abs(numerador) * 10_000) / Math.abs(denominador) + 0.5);
  return sinal * bps || 0;
}

/**
 * Pontos-base como percentual para exibição (2026 vira 20,26). É o valor das chaves
 * `*_percentual`, que o verificador de números lê como "já pronto para exibir".
 */
export function percentualDeBps(bps: number): number {
  return bps / 100;
}
