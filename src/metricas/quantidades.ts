/**
 * Quantidades vendidas têm até 3 casas (kg, litros). Somar em ponto flutuante deixa ruído
 * (0,1 + 0,2 não é 0,3) e ele poderia virar um limite de elegibilidade; arredondar a soma em
 * 3 casas remove o ruído. Este módulo não depende do resto da aplicação.
 */
export function arredondarQuantidade(valor: number): number {
  return Math.round(valor * 1000) / 1000;
}

export function somarQuantidades(valores: readonly number[]): number {
  return arredondarQuantidade(valores.reduce((soma, v) => soma + v, 0));
}
