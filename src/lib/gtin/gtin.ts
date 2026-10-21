/** Tamanhos de GTIN: EAN-8, UPC-A (12), EAN-13 e GTIN-14. */
const TAMANHOS = [8, 12, 13, 14];

/**
 * Normaliza um código de barras de nota: só dígitos, com tamanho de GTIN e dígito verificador
 * correto. Devolve `null` para "SEM GTIN", vazio ou código com dígito errado, que não identifica
 * produto nenhum e não pode ligar item a produto.
 */
export function normalizarGtin(bruto: string | null | undefined): string | null {
  const digitos = (bruto ?? "").replace(/\D/g, "");
  if (!TAMANHOS.includes(digitos.length) || digitos !== (bruto ?? "").trim()) return null;
  const corpo = digitos.slice(0, -1);
  // Pesos 3 e 1, alternando a partir do dígito mais à direita do corpo.
  let soma = 0;
  for (let i = 0; i < corpo.length; i++) {
    const peso = (corpo.length - i) % 2 === 1 ? 3 : 1;
    soma += Number(corpo[i]) * peso;
  }
  const verificador = (10 - (soma % 10)) % 10;
  return verificador === Number(digitos.at(-1)) ? digitos : null;
}
