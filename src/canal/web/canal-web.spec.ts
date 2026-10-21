import { CanalWeb } from "./canal-web";

describe("CanalWeb", () => {
  it("devolve id novo e custo zero a cada envio", async () => {
    const canal = new CanalWeb();
    const a = await canal.enviarTexto();
    const b = await canal.enviarTemplate("d", { nome: "x", idioma: "pt_BR", variaveis: [] });
    expect(a.idExterno).not.toBe(b.idExterno);
    expect(a.custoEstimadoMicrodolares).toBe(0);
    expect(canal.nome).toBe("web");
  });
});
