/** CNPJ numérico (14 dígitos) com dígitos verificadores. Sem dependência do resto da aplicação. */

const PESOS_12 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_13 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

export function somenteDigitos(texto: string): string {
  return texto.replace(/\D/g, "");
}

function digitoVerificador(base: number[], pesos: number[]): number {
  const soma = base.reduce((acc, d, i) => acc + d * (pesos[i] ?? 0), 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** Completa 12 dígitos de base com os dois dígitos verificadores. */
export function completarCnpj(base12: string): string {
  if (!/^\d{12}$/.test(base12)) throw new Error(`Base de CNPJ precisa ter 12 dígitos: "${base12}"`);
  const d = [...base12].map(Number);
  const d1 = digitoVerificador(d, PESOS_12);
  const d2 = digitoVerificador([...d, d1], PESOS_13);
  return `${base12}${d1}${d2}`;
}

export function cnpjValido(texto: string): boolean {
  const digitos = somenteDigitos(texto);
  if (!/^\d{14}$/.test(digitos)) return false;
  if (/^(\d)\1{13}$/.test(digitos)) return false;
  return completarCnpj(digitos.slice(0, 12)) === digitos;
}

/** "12345678000195" vira "12.345.678/0001-95". */
export function formatarCnpj(texto: string): string {
  const d = somenteDigitos(texto);
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}
