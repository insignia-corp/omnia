/**
 * CNPJ (numérico ou alfanumérico, em vigor desde julho de 2026) e CPF, com dígitos verificadores.
 * Sem dependência do resto da aplicação.
 */

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

/** Completa 12 caracteres de base com os dois dígitos verificadores. */
export function completarCnpj(base12: string): string {
  if (!/^[0-9A-Z]{12}$/.test(base12)) throw new Error(`Base de CNPJ precisa ter 12 caracteres: "${base12}"`);
  const d = [...base12].map(valorDoCaractere);
  const d1 = digitoVerificador(d, PESOS_12);
  const d2 = digitoVerificador([...d, d1], PESOS_13);
  return `${base12}${d1}${d2}`;
}

/** Valor de cada caractere do CNPJ alfanumérico: o código ASCII menos 48 (0 a 9 valem 0 a 9, A vale 17). */
const valorDoCaractere = (c: string) => c.charCodeAt(0) - 48;

/** Tira máscara e espaços e põe em maiúsculas: "12.abc.345/01de-35" vira "12ABC34501DE35". */
export function normalizarCnpj(texto: string): string {
  return texto.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

export function cnpjValido(texto: string): boolean {
  const c = normalizarCnpj(texto);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(c)) return false;
  if (/^(.)\1{13}$/.test(c)) return false;
  const base = [...c.slice(0, 12)].map(valorDoCaractere);
  const d1 = digitoVerificador(base, PESOS_12);
  const d2 = digitoVerificador([...base, d1], PESOS_13);
  return c.slice(12) === `${d1}${d2}`;
}

export function cpfValido(texto: string): boolean {
  const d = somenteDigitos(texto);
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const calcular = (n: number) => {
    const soma = [...d.slice(0, n)].reduce((acc, x, i) => acc + Number(x) * (n + 1 - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return calcular(9) === Number(d[9]) && calcular(10) === Number(d[10]);
}

/** Verdadeiro para CNPJ (numérico ou alfanumérico) ou CPF com dígito verificador correto. */
export function identificadorValido(texto: string): boolean {
  return cnpjValido(texto) || cpfValido(texto);
}

/**
 * Identificador do fornecedor para guardar: CNPJ numérico de 14 dígitos (a leitura de foto pode errar o
 * dígito verificador, por isso só o tamanho vale), CNPJ alfanumérico ou CPF, estes dois só com dígito
 * verificador correto. Devolve `null` para o que não identifica ninguém ("N/A", leitura incompleta).
 */
export function identificadorDoFornecedor(texto: string): string | null {
  const digitos = somenteDigitos(texto);
  if (digitos.length === 14) return digitos;
  const alfa = normalizarCnpj(texto);
  if (/[A-Z]/.test(alfa) && cnpjValido(alfa)) return alfa;
  if (cpfValido(texto)) return digitos;
  return null;
}

/** "12345678000195" vira "12.345.678/0001-95". */
export function formatarCnpj(texto: string): string {
  const d = somenteDigitos(texto);
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}
