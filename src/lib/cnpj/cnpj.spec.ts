import {
  cnpjValido,
  completarCnpj,
  cpfValido,
  formatarCnpj,
  identificadorDoFornecedor,
  identificadorValido,
  somenteDigitos,
} from "./cnpj";

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

describe("CNPJ alfanumérico", () => {
  it("valida o exemplo oficial da Receita, com e sem máscara e em minúsculas", () => {
    expect(cnpjValido("12ABC34501DE35")).toBe(true);
    expect(cnpjValido("12.ABC.345/01DE-35")).toBe(true);
    expect(cnpjValido("12.abc.345/01de-35")).toBe(true);
  });

  it("recusa dígito verificador errado e letra no lugar do dígito verificador", () => {
    expect(cnpjValido("12ABC34501DE36")).toBe(false);
    expect(cnpjValido("12ABC34501DEAB")).toBe(false);
  });

  it("completa uma base alfanumérica", () => {
    expect(completarCnpj("12ABC34501DE")).toBe("12ABC34501DE35");
  });
});

describe("CPF e identificador do fornecedor", () => {
  it("valida CPF com dígitos verificadores", () => {
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("52998224725")).toBe(true);
    expect(cpfValido("52998224726")).toBe(false);
    expect(cpfValido("11111111111")).toBe(false);
  });

  it("aceita CNPJ ou CPF válido como identificador", () => {
    expect(identificadorValido("11.222.333/0001-81")).toBe(true);
    expect(identificadorValido("12ABC34501DE35")).toBe(true);
    expect(identificadorValido("529.982.247-25")).toBe(true);
    expect(identificadorValido("123")).toBe(false);
  });

  it("guarda CNPJ numérico pelo tamanho, alfanumérico e CPF só se válidos, e o resto vira nulo", () => {
    expect(identificadorDoFornecedor("11.222.333/0001-81")).toBe("11222333000181");
    // Leitura de foto com dígito verificador errado continua sendo guardada (só vale o tamanho).
    expect(identificadorDoFornecedor("11.222.333/0001-82")).toBe("11222333000182");
    expect(identificadorDoFornecedor("12.ABC.345/01DE-35")).toBe("12ABC34501DE35");
    expect(identificadorDoFornecedor("12.ABC.345/01DE-36")).toBeNull();
    expect(identificadorDoFornecedor("529.982.247-25")).toBe("52998224725");
    expect(identificadorDoFornecedor("N/A")).toBeNull();
    expect(identificadorDoFornecedor("12.345.678/OOO1-95")).toBeNull();
  });
});
