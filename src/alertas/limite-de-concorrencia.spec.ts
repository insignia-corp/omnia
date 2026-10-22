import { LimiteDeConcorrencia } from "./repositorio-alertas";

describe("LimiteDeConcorrencia", () => {
  it("nunca roda mais que o máximo ao mesmo tempo e atende a fila em ordem", async () => {
    const limite = new LimiteDeConcorrencia(2);
    let ativas = 0;
    let pico = 0;
    const ordem: number[] = [];
    const tarefa = (n: number) =>
      limite.executar(async () => {
        ativas++;
        pico = Math.max(pico, ativas);
        ordem.push(n);
        await new Promise((r) => setTimeout(r, 10));
        ativas--;
        return n;
      });
    const resultados = await Promise.all([1, 2, 3, 4, 5].map(tarefa));
    expect(resultados).toEqual([1, 2, 3, 4, 5]);
    expect(pico).toBe(2);
    expect(ordem).toEqual([1, 2, 3, 4, 5]);
  });

  it("uma tarefa que falha libera o lugar", async () => {
    const limite = new LimiteDeConcorrencia(1);
    await expect(limite.executar(() => Promise.reject(new Error("falhou")))).rejects.toThrow("falhou");
    await expect(limite.executar(() => Promise.resolve("ok"))).resolves.toBe("ok");
  });
});
