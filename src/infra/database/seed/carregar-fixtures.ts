import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCentavos } from "../../../lib/dinheiro/dinheiro";
import { extracaoNotaSchema, type ExtracaoNota } from "../../../ingestao/extracao/esquema-extracao";

/** Arquivos de `fixtures/` (Etapa 1) lidos e tipados. Só leitura de disco, sem banco. */

export interface PerfilFixture {
  nome: string;
  tipo_comercio: string;
  margem_meta_bps: number;
  telefone_whatsapp: string;
  saldo_inicial_conta_centavos: number;
}

export interface FornecedorFixture {
  id: string;
  nome: string;
  cnpj: string;
}

export interface ProdutoFixture {
  id: string;
  nome: string;
  codigo_barras: string;
  unidade: string;
  categoria: string;
  preco_venda_centavos: number;
  fornecedor_principal_id: string;
}

export interface ItemCupomFixture {
  codigoBarras: string;
  quantidade: number;
  precoUnitarioCentavos: number;
  totalCentavos: number;
}

export interface CupomFixture {
  data: string;
  hora: string;
  numero: string;
  itens: ItemCupomFixture[];
}

export interface TransacaoFixture {
  id: string;
  data: string;
  descricao: string;
  valorCentavos: number;
  tipo: "entrada" | "saida";
  categoria: string;
}

interface ManifestoNota {
  id: string;
  arquivo_imagem: string | null;
  arquivo_xml: string | null;
  fornecedor_id: string;
  numero_documento: string;
  data_emissao: string;
  itens_confianca_baixa: number[];
  soma_itens_centavos: number;
  soma_confere: boolean;
  vinculos_produto: string[];
}

export interface NotaFixture {
  id: string;
  /** Caminho do arquivo da nota, relativo à raiz do repositório. */
  arquivo: string;
  formato: "foto_nota" | "nfe";
  hashArquivo: string;
  fornecedorId: string;
  numeroDocumento: string;
  dataEmissao: string;
  somaItensCentavos: number;
  somaConfere: boolean;
  itensConfiancaBaixa: number[];
  /** Produto (id do catálogo) de cada item, na ordem dos itens. */
  produtoPorItem: string[];
  extracao: ExtracaoNota;
}

export interface Fixtures {
  perfil: PerfilFixture;
  fornecedores: FornecedorFixture[];
  produtos: ProdutoFixture[];
  cupons: CupomFixture[];
  arquivoVendas: { caminho: string; hash: string };
  notas: NotaFixture[];
  transacoes: TransacaoFixture[];
}

const lerJson = <T>(caminho: string): T => JSON.parse(readFileSync(caminho, "utf8")) as T;
const sha256 = (conteudo: Buffer): string => createHash("sha256").update(conteudo).digest("hex");

/** "20/08/2026" vira "2026-08-20". */
const dataIso = (dataBr: string): string => dataBr.split("/").reverse().join("-");

function linhasCsv(caminho: string): string[][] {
  const [, ...linhas] = readFileSync(caminho, "utf8").split("\n");
  return linhas.filter((l) => l.trim() !== "").map((l) => l.split(";"));
}

function lerCupons(caminho: string): CupomFixture[] {
  const porCupom = new Map<string, CupomFixture>();
  for (const [
    data = "",
    hora = "",
    numero = "",
    codigo = "",
    ,
    qtd = "",
    preco = "",
    total = "",
  ] of linhasCsv(caminho)) {
    const chave = `${data}|${numero}`;
    const cupom = porCupom.get(chave) ?? { data: dataIso(data), hora, numero, itens: [] };
    cupom.itens.push({
      codigoBarras: codigo,
      quantidade: Number(qtd),
      precoUnitarioCentavos: parseCentavos(preco),
      totalCentavos: parseCentavos(total),
    });
    porCupom.set(chave, cupom);
  }
  return [...porCupom.values()];
}

function lerTransacoes(caminho: string): TransacaoFixture[] {
  return linhasCsv(caminho).map(
    ([id = "", data = "", descricao = "", valor = "", tipo = "", categoria = ""]) => ({
      id,
      data,
      descricao,
      valorCentavos: Number(valor),
      tipo: tipo === "entrada" ? "entrada" : "saida",
      categoria,
    }),
  );
}

export function carregarFixtures(raiz = process.cwd()): Fixtures {
  const dir = resolve(raiz, "fixtures");
  const vendasCsv = resolve(dir, "mercadinho/vendas.csv");
  const manifesto = lerJson<ManifestoNota[]>(resolve(dir, "notas/manifesto.json"));
  const notas = manifesto.map((m): NotaFixture => {
    const arquivo = m.arquivo_xml ?? m.arquivo_imagem;
    if (!arquivo) throw new Error(`${m.id}: nota sem imagem nem XML`);
    return {
      id: m.id,
      arquivo: `fixtures/notas/${arquivo}`,
      formato: m.arquivo_xml ? "nfe" : "foto_nota",
      hashArquivo: sha256(readFileSync(resolve(dir, "notas", arquivo))),
      fornecedorId: m.fornecedor_id,
      numeroDocumento: m.numero_documento,
      dataEmissao: m.data_emissao,
      somaItensCentavos: m.soma_itens_centavos,
      somaConfere: m.soma_confere,
      itensConfiancaBaixa: m.itens_confianca_baixa,
      produtoPorItem: m.vinculos_produto,
      extracao: extracaoNotaSchema.parse(lerJson(resolve(dir, "notas", `${m.id}.esperado.json`))),
    };
  });
  return {
    perfil: lerJson<PerfilFixture>(resolve(dir, "mercadinho/perfil.json")),
    fornecedores: lerJson<FornecedorFixture[]>(resolve(dir, "mercadinho/fornecedores.json")),
    produtos: lerJson<ProdutoFixture[]>(resolve(dir, "mercadinho/catalogo.json")),
    cupons: lerCupons(vendasCsv),
    arquivoVendas: { caminho: "fixtures/mercadinho/vendas.csv", hash: sha256(readFileSync(vendasCsv)) },
    notas,
    transacoes: lerTransacoes(resolve(dir, "mercadinho/extrato.csv")),
  };
}
