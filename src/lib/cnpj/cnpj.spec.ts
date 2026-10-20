import { cnpjValido, completarCnpj, formatarCnpj, somenteDigitos } from "./cnpj";

describe("cnpj", () => {
  it("valida CNPJs conhecidos, com e sem máscara", () => {
    expect(cnpjValido("11.222.333/0001-81")).toBe(true);
    expect(cnpjValido("11222333000181")).toBe(true);
    expect(cnpjValido("00.000.000/0001-91")).toBe(true);
  });

  it("recusa dígito verificador errado, tamanho errado e repetidos", () => {
    expect(cnpjValido("11.222.333/0001-82")).toBe(false);
    expect(cnpjValido("1122233300018")).toBe(false);
    expect(cnpjValido("11111111111111")).toBe(false);
    expect(cnpjValido("")).toBe(false);
  });

  it("completa a base com os dígitos verificadores", () => {
    expect(completarCnpj("112223330001")).toBe("11222333000181");
    expect(() => completarCnpj("123")).toThrow();
  });

  it("formata e extrai dígitos", () => {
    expect(formatarCnpj("11222333000181")).toBe("11.222.333/0001-81");
    expect(somenteDigitos("11.222.333/0001-81")).toBe("11222333000181");
  });
});
