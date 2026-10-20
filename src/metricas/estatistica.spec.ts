import { medianaEDesvioAbsolutoMediano, medianaEmMeios } from "./estatistica";

describe("estatistica", () => {
  describe("medianaEmMeios", () => {
    it("número ímpar de valores: o do meio, dobrado", () => {
      expect(medianaEmMeios([5, 1, 3])).toBe(6); // mediana 3
    });

    it("número par: a média dos dois do meio, que pode ser meio centavo", () => {
      expect(medianaEmMeios([1, 2, 3, 4])).toBe(5); // mediana 2,5
      expect(medianaEmMeios([10, 20])).toBe(30); // mediana 15
    });

    it("não depende da ordem e não altera a lista recebida", () => {
      const lista = [9, 1, 5, 3, 7];
      expect(medianaEmMeios(lista)).toBe(10);
      expect(lista).toEqual([9, 1, 5, 3, 7]);
    });

    it("valor único", () => expect(medianaEmMeios([7])).toBe(14));

    it("recusa lista vazia", () => expect(() => medianaEmMeios([])).toThrow(RangeError));
  });

  describe("medianaEDesvioAbsolutoMediano", () => {
    it("desvio absoluto mediano de uma série simples", () => {
      // Valores 1 2 3 4 100: mediana 3; desvios 2 1 0 1 97; mediana dos desvios 1.
      const r = medianaEDesvioAbsolutoMediano([1, 2, 3, 4, 100]);
      expect(r.medianaEmMeios / 2).toBe(3);
      expect(r.desvioEmQuartos / 4).toBe(1);
    });

    it("série par com mediana em meio centavo e desvio em quarto de centavo", () => {
      // Valores 1 2 3 4: mediana 2,5; desvios 1,5 0,5 0,5 1,5; mediana dos desvios 1.
      const par = medianaEDesvioAbsolutoMediano([1, 2, 3, 4]);
      expect(par.medianaEmMeios).toBe(5);
      expect(par.desvioEmQuartos).toBe(4);
      // Valores 1 2 4 8: mediana 3; desvios 2 1 1 5; mediana dos desvios 1,5.
      const quarto = medianaEDesvioAbsolutoMediano([1, 2, 4, 8]);
      expect(quarto.medianaEmMeios).toBe(6);
      expect(quarto.desvioEmQuartos).toBe(6);
    });

    it("série constante tem desvio zero", () => {
      expect(medianaEDesvioAbsolutoMediano([5, 5, 5, 5]).desvioEmQuartos).toBe(0);
    });

    it("reproduz a mediana de 6093 e o desvio de 1747,5 do dia de referência do gabarito", () => {
      // O dia 19/10 tem mediana de 60,93 e desvio absoluto mediano de 17,475 (em reais) sobre 60 dias.
      // Aqui, 4 valores montados para dar o mesmo desvio em quartos de centavo: 6093 +- 1747,5.
      const r = medianaEDesvioAbsolutoMediano([6093 - 1748, 6093 - 1747, 6093 + 1747, 6093 + 1748]);
      expect(r.medianaEmMeios / 2).toBe(6093);
      expect(r.desvioEmQuartos / 4).toBe(1747.5);
    });
  });
});
