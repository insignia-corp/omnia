/** Gerador pseudoaleatório com semente fixa (mulberry32): mesma semente, mesma sequência. */
export class Prng {
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

  /** Inteiro em [min, max], inclusive. */
  inteiro(min: number, max: number): number {
    return min + Math.floor(this.proximo() * (max - min + 1));
  }

  /** Sorteia um índice proporcional aos pesos. */
  indicePonderado(pesos: readonly number[]): number {
    const total = pesos.reduce((a, p) => a + p, 0);
    let alvo = this.proximo() * total;
    for (let i = 0; i < pesos.length; i++) {
      alvo -= pesos[i] ?? 0;
      if (alvo < 0) return i;
    }
    return pesos.length - 1;
  }
}
