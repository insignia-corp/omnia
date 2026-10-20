import { decidirPorSimilaridade, type CandidatoProduto } from "./vincular-produto";

const c = (nome: string, similaridade: number): CandidatoProduto => ({
  produtoId: `id-${nome}`,
  nome,
  similaridade,
});
const LIMITE = 0.45;

describe("decidirPorSimilaridade", () => {
  it("liga sozinho quando o melhor passa do limite com folga sobre o segundo", () => {
    expect(decidirPorSimilaridade([c("A", 0.8), c("B", 0.5)], LIMITE)).toEqual({
      tipo: "vinculado",
      produtoId: "id-A",
      metodo: "similaridade",
      confianca: 0.8,
    });
  });

  it("liga quando só há um candidato acima do limite", () => {
    expect(decidirPorSimilaridade([c("A", 0.46)], LIMITE)).toMatchObject({
      tipo: "vinculado",
      produtoId: "id-A",
    });
  });

  it("não liga quando o segundo é parecido demais: pergunta ao dono com os candidatos", () => {
    const r = decidirPorSimilaridade([c("A", 0.7), c("B", 0.65), c("C", 0.3), c("D", 0.25)], LIMITE);
    expect(r.tipo).toBe("sugestao");
    expect(r.tipo === "sugestao" && r.candidatos.map((x) => x.nome)).toEqual(["A", "B", "C"]);
  });

  it("não liga abaixo do limite, mas sugere o que for plausível", () => {
    const r = decidirPorSimilaridade([c("A", 0.4), c("B", 0.1)], LIMITE);
    expect(r).toEqual({ tipo: "sugestao", candidatos: [c("A", 0.4)] });
  });

  it("sem nada parecido não há candidato", () => {
    expect(decidirPorSimilaridade([c("A", 0.15)], LIMITE)).toEqual({ tipo: "sem_candidato" });
    expect(decidirPorSimilaridade([], LIMITE)).toEqual({ tipo: "sem_candidato" });
  });

  it("limite mais alto deixa de ligar o que antes ligava", () => {
    expect(decidirPorSimilaridade([c("A", 0.6)], 0.7).tipo).toBe("sugestao");
  });
});
