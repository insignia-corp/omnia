import { z } from "zod";
import { respostaModeloSchema } from "./extrator-notas";
import { esquemaSaidaJson } from "./esquema-saida-json";

interface Esquema {
  type?: string;
  required?: string[];
  properties?: Record<string, Esquema>;
  items?: Esquema;
}

const semReferencias = (valor: unknown): boolean => !/"\$(ref|defs)"/.test(JSON.stringify(valor));

describe("esquemaSaidaJson", () => {
  it("o esquema do Extrator (nota ou ilegível) sai sem $defs nem $ref, que a API recusa junto de anyOf", () => {
    const { type, schema } = esquemaSaidaJson(respostaModeloSchema);
    expect(type).toBe("json_schema");
    expect(semReferencias(schema)).toBe(true);
    expect(Array.isArray(schema["anyOf"])).toBe(true);
  });

  it("mantém a forma da nota: campos obrigatórios e itens como lista de objetos", () => {
    const { schema } = esquemaSaidaJson(respostaModeloSchema);
    const nota = (schema["anyOf"] as Esquema[]).find((s) => s.properties?.["itens"]);
    expect(nota?.required).toEqual(
      expect.arrayContaining([
        "fornecedor",
        "data_emissao",
        "itens",
        "total_centavos",
        "confianca_documento",
      ]),
    );
    const item = nota?.properties?.["itens"]?.items;
    expect(item?.type).toBe("object");
    expect(item?.required).toEqual(
      expect.arrayContaining([
        "descricao",
        "quantidade",
        "unidade",
        "valor_unitario_centavos",
        "valor_total_centavos",
        "confianca",
      ]),
    );
    expect(item?.properties?.["valor_total_centavos"]?.type).toBe("integer");
  });

  it("resolve também objeto reaproveitado em dois campos", () => {
    const ponto = z.object({ x: z.number() });
    const { schema } = esquemaSaidaJson(z.object({ a: ponto, b: ponto }));
    expect(semReferencias(schema)).toBe(true);
    expect(JSON.stringify(schema)).toContain('"x"');
  });
});
