import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const RAIZ = resolve(__dirname, "../../..");
export const DIR_MERCADINHO = resolve(RAIZ, "fixtures/mercadinho");
export const DIR_NOTAS = resolve(RAIZ, "fixtures/notas");
export const DIR_GABARITO = resolve(RAIZ, "fixtures/gabarito");
export const DIR_AVALIACAO = resolve(RAIZ, "fixtures/avaliacao");

/** Gerador pseudoaleatório com semente (mulberry32): mesma semente, mesma sequência. */
export class Aleatorio {
  private estado: number;

  constructor(semente: number) {
    this.estado = semente >>> 0;
  }

  /** Número em [0, 1). */
  proximo(): number {
    this.estado = (this.estado + 0x6d2b79f5) >>> 0;
    let t = this.estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Inteiro em [minimo, maximo], extremos incluídos. */
  inteiro(minimo: number, maximo: number): number {
    return minimo + Math.floor(this.proximo() * (maximo - minimo + 1));
  }

  normal(): number {
    const u = 1 - this.proximo();
    const v = this.proximo();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda >= 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * this.normal()));
    const limite = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k += 1;
      p *= this.proximo();
    } while (p > limite);
    return k - 1;
  }

  /** Índice sorteado com probabilidade proporcional ao peso. */
  ponderado(pesos: readonly number[], total: number): number {
    let alvo = this.proximo() * total;
    for (let i = 0; i < pesos.length; i++) {
      alvo -= pesos[i] ?? 0;
      if (alvo < 0) return i;
    }
    return pesos.length - 1;
  }
}

// Datas ISO ("2026-10-19") em UTC, sem fuso nem horário de verão.

export function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Dias de `a` até `b` (positivo quando b é depois de a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** 0 = domingo ... 6 = sábado. */
export function diaDaSemana(data: string): number {
  return new Date(`${data}T00:00:00Z`).getUTCDay();
}

export function intervaloDeDatas(inicio: string, fim: string): string[] {
  const datas: string[] = [];
  for (let d = inicio; d <= fim; d = somarDias(d, 1)) datas.push(d);
  return datas;
}

export function dataBr(data: string): string {
  const [a, m, d] = data.split("-");
  return `${d}/${m}/${a}`;
}

/** Centavos inteiros para texto decimal brasileiro, ex.: 129900 -> "1299,00". Só para saída de arquivo. */
export function decimalBr(valorCentavos: number): string {
  const negativo = valorCentavos < 0;
  const absoluto = Math.abs(valorCentavos);
  const texto = `${Math.trunc(absoluto / 100)},${String(absoluto % 100).padStart(2, "0")}`;
  return negativo ? `-${texto}` : texto;
}

/** Com separador de milhar, para as notas impressas, ex.: 129900 -> "1.299,00". */
export function decimalBrMilhar(valorCentavos: number): string {
  const [inteiro = "", centavos = ""] = decimalBr(valorCentavos).split(",");
  return `${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${centavos}`;
}

// Mesma implementação usada pela validação de notas em produção.
export { cnpjValido, formatarCnpj } from "../../../src/lib/cnpj/cnpj";
export { completarCnpj as digitosCnpj } from "../../../src/lib/cnpj/cnpj";

export function ean13(base12: string): string {
  const soma = base12.split("").reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return `${base12}${(10 - (soma % 10)) % 10}`;
}

export function ean13Valido(codigo: string): boolean {
  return /^\d{13}$/.test(codigo) && ean13(codigo.slice(0, 12)) === codigo;
}

export function mediana(valores: readonly number[]): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  const central =
    ordenados.length % 2 === 1 ? ordenados[meio] : ((ordenados[meio - 1] ?? 0) + (ordenados[meio] ?? 0)) / 2;
  return central ?? 0;
}

export function lerJson<T>(caminho: string): T {
  return JSON.parse(readFileSync(caminho, "utf8")) as T;
}

/** Escrita estável: JSON com 2 espaços e quebra de linha final. */
export function escreverJson(caminho: string, conteudo: unknown): void {
  escreverTexto(caminho, `${JSON.stringify(conteudo, null, 2)}\n`);
}

export function escreverTexto(caminho: string, conteudo: string): void {
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, conteudo, "utf8");
}
