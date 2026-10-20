/**
 * Dinheiro sempre em centavos como inteiro (regra inviolável 2).
 * Este módulo não depende do resto da aplicação.
 */

declare const marca: unique symbol;
export type Centavos = number & { readonly [marca]: "Centavos" };

export class ErroDinheiro extends Error {}

export function centavos(valor: number): Centavos {
  if (!Number.isSafeInteger(valor)) {
    throw new ErroDinheiro(`Centavos precisam ser inteiros seguros, recebido: ${valor}`);
  }
  return valor as Centavos;
}

export const ZERO = centavos(0);

export function somar(...valores: Centavos[]): Centavos {
  return centavos(valores.reduce<number>((acc, v) => acc + v, 0));
}

export function subtrair(a: Centavos, b: Centavos): Centavos {
  return centavos(a - b);
}

/**
 * Multiplica um valor unitário por uma quantidade, que pode ser fracionária (ex.: 1,5 kg).
 * O arredondamento é meio para cima, em centavos.
 */
export function multiplicar(unitario: Centavos, quantidade: number): Centavos {
  if (!Number.isFinite(quantidade)) throw new ErroDinheiro(`Quantidade inválida: ${quantidade}`);
  return centavos(arredondarMeioParaCima(unitario * quantidade));
}

/** Razão entre dois valores (ex.: margem). Devolve null quando o divisor é zero. */
export function razao(numerador: Centavos, denominador: Centavos): number | null {
  if (denominador === 0) return null;
  return numerador / denominador;
}

function arredondarMeioParaCima(v: number): number {
  // Corrige ruído de ponto flutuante antes de arredondar (ex.: 1.005 * 100).
  const corrigido = Math.round(v * 1e6) / 1e6;
  return Math.sign(corrigido) * Math.floor(Math.abs(corrigido) + 0.5);
}

/**
 * Converte texto de nota, planilha ou mensagem para centavos.
 * Aceita "12,90", "R$ 1.234,50", "1234.5", "-3,00" e "1.234" (milhar).
 */
export function parseCentavos(texto: string): Centavos {
  const limpo = texto.replace(/\s|R\$/g, "");
  if (!/^-?[\d.,]+$/.test(limpo)) throw new ErroDinheiro(`Valor monetário inválido: "${texto}"`);

  const negativo = limpo.startsWith("-");
  const corpo = negativo ? limpo.slice(1) : limpo;
  let inteiro: string;
  let fracao = "";

  const ultimaVirgula = corpo.lastIndexOf(",");
  const ultimoPonto = corpo.lastIndexOf(".");
  if (ultimaVirgula >= 0) {
    // Formato brasileiro: vírgula decimal, ponto de milhar.
    inteiro = corpo.slice(0, ultimaVirgula).replace(/\./g, "");
    fracao = corpo.slice(ultimaVirgula + 1);
  } else if (ultimoPonto >= 0 && corpo.length - ultimoPonto - 1 !== 3) {
    // Ponto decimal (ex.: exportação de planilha "1234.5").
    inteiro = corpo.slice(0, ultimoPonto).replace(/\./g, "");
    fracao = corpo.slice(ultimoPonto + 1);
  } else {
    inteiro = corpo.replace(/\./g, "");
  }

  if (!/^\d*$/.test(inteiro) || !/^\d*$/.test(fracao) || fracao.length > 2 || inteiro + fracao === "") {
    throw new ErroDinheiro(`Valor monetário inválido: "${texto}"`);
  }
  const valor = Number(inteiro || "0") * 100 + Number(fracao.padEnd(2, "0") || "0");
  return centavos(negativo ? -valor : valor);
}

const formatador = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Formata para exibição ao dono, ex.: "R$ 1.234,50". */
export function formatarBRL(valor: Centavos): string {
  // Divisão só na borda de exibição; o valor guardado continua inteiro.
  return formatador.format(valor / 100).replace(/\u00a0/g, " ");
}
