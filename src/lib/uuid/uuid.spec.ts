import { ehUuid } from "./uuid";

describe("ehUuid", () => {
  it("aceita UUID em maiúsculas e minúsculas", () => {
    expect(ehUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(ehUuid("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA")).toBe(true);
  });

  it("recusa o que não é UUID, inclusive tentativa de sair de uma pasta", () => {
    for (const texto of [
      "",
      "nao-e-uuid",
      "../fora",
      "11111111-1111-4111-8111-11111111111",
      "11111111-1111-4111-8111-1111111111111",
    ]) {
      expect(ehUuid(texto)).toBe(false);
    }
  });
});
