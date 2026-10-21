import { diasEntre, ErroData, intervaloDeDatas, somarDias } from "./datas";

describe("datas", () => {
  describe("somarDias", () => {
    it("soma e subtrai dias", () => {
      expect(somarDias("2026-10-19", 1)).toBe("2026-10-20");
      expect(somarDias("2026-10-19", -6)).toBe("2026-10-13");
      expect(somarDias("2026-10-19", 0)).toBe("2026-10-19");
    });
    it("atravessa mês e ano", () => {
      expect(somarDias("2026-10-31", 1)).toBe("2026-11-01");
      expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
      expect(somarDias("2027-01-01", -1)).toBe("2026-12-31");
    });
    it("respeita ano bissexto", () => {
      expect(somarDias("2028-02-28", 1)).toBe("2028-02-29");
      expect(somarDias("2026-02-28", 1)).toBe("2026-03-01");
    });
    it("não muda na virada do horário de verão", () => {
      // 2018-11-04: um dos dias em que o Brasil mudava o relógio.
      expect(somarDias("2018-11-03", 1)).toBe("2018-11-04");
      expect(somarDias("2018-11-04", 1)).toBe("2018-11-05");
    });
    it("recusa dias fracionários", () => expect(() => somarDias("2026-10-19", 0.5)).toThrow(ErroData));
  });

  describe("diasEntre", () => {
    it("conta dias com sinal", () => {
      expect(diasEntre("2026-10-12", "2026-10-19")).toBe(7);
      expect(diasEntre("2026-10-19", "2026-10-12")).toBe(-7);
      expect(diasEntre("2026-10-19", "2026-10-19")).toBe(0);
    });
    it("atravessa o horário de verão sem errar por uma hora", () => {
      expect(diasEntre("2018-11-03", "2018-11-05")).toBe(2);
    });
    it("bate com somarDias", () => {
      expect(diasEntre("2026-08-20", somarDias("2026-08-20", 60))).toBe(60);
    });
  });

  describe("intervaloDeDatas", () => {
    it("inclui as duas pontas", () => {
      expect(intervaloDeDatas("2026-10-17", "2026-10-19")).toEqual([
        "2026-10-17",
        "2026-10-18",
        "2026-10-19",
      ]);
    });
    it("devolve um dia quando início e fim coincidem", () => {
      expect(intervaloDeDatas("2026-10-19", "2026-10-19")).toEqual(["2026-10-19"]);
    });
    it("devolve vazio quando o fim vem antes do início", () => {
      expect(intervaloDeDatas("2026-10-19", "2026-10-18")).toEqual([]);
    });
  });

  describe("validação", () => {
    it.each(["2026-13-01", "2026-02-30", "2026-1-1", "19/10/2026", "", "2026-10-19T00:00:00Z", "0050-01-01"])(
      "recusa %p",
      (data) => {
        expect(() => somarDias(data, 1)).toThrow(ErroData);
      },
    );
  });
});
