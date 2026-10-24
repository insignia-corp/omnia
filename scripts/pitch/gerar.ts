import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { renderizarNota, type NotaFixture } from "../fixtures/notas";
import {
  CATALOGO_PITCH,
  csvVendasPitch,
  DATA_DEMO,
  gerarVendasPitch,
  NOTA_VIDEO,
  NOTAS_ANTERIORES,
  resumirVendasPitch,
} from "./dados";

export const PASTA_PITCH = resolve(__dirname, "../../fixtures/pitch");

/** Reutiliza o renderizador das notas, sem escrever ou alterar os fixtures antigos. */
export function gerarDanfePitch(destino = join(PASTA_PITCH, "danfe-video.jpg")): void {
  const pasta = mkdtempSync(join(tmpdir(), "omnia-pitch-danfe-"));
  try {
    const nota: NotaFixture = {
      id: "danfe-video",
      esperado: NOTA_VIDEO,
      base: { numero: 24, data: "2026-10-23", fornecedor: "AUR", itens: [], numero_documento: "000024" },
      manifesto: {
        id: "danfe-video",
        arquivo_imagem: "danfe-video.jpg",
        arquivo_xml: null,
        arquivo_esperado: "danfe-video.esperado.json",
        fornecedor_id: "sao-jorge",
        numero_documento: "000024",
        data_emissao: "2026-10-23",
        casos: ["foto_de_celular", "cafe_reajustado"],
        itens_confianca_baixa: [],
        soma_itens_centavos: NOTA_VIDEO.total_centavos,
        soma_confere: true,
        texto_injecao: null,
        vinculos_produto: ["feijao", "macarrao", "acucar", "cafe"],
        reajuste_plantado: { produto_id: "cafe", custo_anterior_centavos: 1690, custo_atual_centavos: 1870 },
      },
      linhaDoItemIlegivel: null,
    };
    const base = join(pasta, "nota.png");
    renderizarNota(nota, base);
    // As medidas de texto são as do renderizador reutilizado. Corrige somente título e destinatário.
    const papel = join(pasta, "papel.png");
    execFileSync("magick", [
      base,
      "-fill",
      "#f4f1e8",
      "-draw",
      "rectangle 24,148 710,179",
      "-draw",
      "rectangle 24,208 710,239",
      "-font",
      "DejaVu-Sans-Mono",
      "-pointsize",
      "21",
      "-fill",
      "#1c1c1c",
      "-annotate",
      "+28+169",
      "DANFE SIMPLIFICADO No 000024 - SERIE 1",
      "-annotate",
      "+28+229",
      "CLIENTE: MERCADINHO BOM PRECO",
      "-gravity",
      "South",
      "-background",
      "#f4f1e8",
      "-splice",
      "0x65",
      "-pointsize",
      "15",
      "-annotate",
      "+0+32",
      "DOCUMENTO FICTICIO PARA DEMONSTRACAO",
      "-annotate",
      "+0+10",
      "SEM VALOR FISCAL",
      papel,
    ]);
    // Perspectiva e sombra em fundo de mesa. Semente fixa, sem EXIF ou relógio na saída.
    const foto = join(pasta, "foto.png");
    execFileSync("magick", [
      papel,
      "-alpha",
      "set",
      "-virtual-pixel",
      "transparent",
      "+distort",
      "Perspective",
      "0,0 24,10 713,0 700,32 713,680 713,681 0,680 5,667",
      "-background",
      "none",
      "-rotate",
      "-1.5",
      "(",
      "+clone",
      "-background",
      "#211a12",
      "-shadow",
      "55x12+16+22",
      ")",
      "+swap",
      "-background",
      "none",
      "-layers",
      "merge",
      "+repage",
      foto,
    ]);
    execFileSync("magick", [
      "-seed",
      "24",
      "-size",
      "1000x1100",
      "gradient:#a89880-#786750",
      "-attenuate",
      "0.15",
      "+noise",
      "Gaussian",
      "(",
      foto,
      ")",
      "-gravity",
      "center",
      "-composite",
      "-strip",
      "-quality",
      "93",
      destino,
    ]);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

export function gerarArquivosPitch(): void {
  mkdirSync(PASTA_PITCH, { recursive: true });
  const json = (nome: string, valor: unknown) =>
    writeFileSync(join(PASTA_PITCH, nome), JSON.stringify(valor, null, 2) + "\n");
  const vendas = gerarVendasPitch();
  json("catalogo.json", CATALOGO_PITCH);
  json("resumo-diario.json", resumirVendasPitch(vendas));
  json("danfe-video.esperado.json", NOTA_VIDEO);
  for (const nota of NOTAS_ANTERIORES) json(`${nota.chave}.esperado.json`, nota.extracao);
  writeFileSync(join(PASTA_PITCH, "vendas.csv"), csvVendasPitch(vendas));
  gerarDanfePitch();
  console.log(`Fixtures do pitch gerados em ${PASTA_PITCH}. Data da demo: ${DATA_DEMO}.`);
}

if (require.main === module) gerarArquivosPitch();
