import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErroArmazenamento } from "./armazenamento";
import { ArmazenamentoDisco } from "./armazenamento-disco";
import { detectarTipo } from "./tipo-arquivo";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);
const XLSX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("detectarTipo", () => {
  it("reconhece pelos bytes iniciais", () => {
    expect(detectarTipo(JPEG)).toBe("jpeg");
    expect(detectarTipo(PNG)).toBe("png");
    expect(detectarTipo(XLSX)).toBe("xlsx");
    expect(detectarTipo(Buffer.from('﻿<?xml version="1.0"?><a/>'))).toBe("xml");
    expect(detectarTipo(Buffer.from("Data;Produto;Qtd\n20/08/2026;Arroz;1\n"))).toBe("csv");
  });

  it("recusa binário desconhecido, texto sem separador e vazio", () => {
    expect(detectarTipo(Buffer.from([0, 1, 2, 3, 4]))).toBeNull();
    expect(detectarTipo(Buffer.from("só um texto qualquer"))).toBeNull();
    expect(detectarTipo(Buffer.alloc(0))).toBeNull();
  });
});

describe("ArmazenamentoDisco", () => {
  let raiz: string;
  let armazenamento: ArmazenamentoDisco;

  beforeEach(async () => {
    raiz = await mkdtemp(join(tmpdir(), "omnia-armazenamento-"));
    armazenamento = new ArmazenamentoDisco({ raiz, maxBytes: 100 });
  });
  afterEach(() => rm(raiz, { recursive: true, force: true }));

  it("guarda por comerciante com o hash no nome e devolve o conteúdo", async () => {
    const salvo = await armazenamento.salvar(A, JPEG);
    expect(salvo.caminho).toBe(`${A}/${salvo.hash}.jpg`);
    expect(salvo.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(salvo.tipo).toBe("jpeg");
    expect(await armazenamento.ler(salvo.caminho)).toEqual(JPEG);
  });

  it("o mesmo arquivo enviado duas vezes dá o mesmo caminho e um só arquivo", async () => {
    const um = await armazenamento.salvar(A, JPEG);
    const dois = await armazenamento.salvar(A, JPEG);
    expect(dois.caminho).toBe(um.caminho);
    expect(await readdir(join(raiz, A))).toHaveLength(1);
  });

  it("separa o mesmo arquivo de comerciantes diferentes", async () => {
    const a = await armazenamento.salvar(A, JPEG);
    const b = await armazenamento.salvar(B, JPEG);
    expect(a.caminho).not.toBe(b.caminho);
  });

  it("recusa arquivo vazio, grande demais e de tipo não aceito", async () => {
    const motivo = async (conteudo: Buffer) =>
      armazenamento.salvar(A, conteudo).then(
        () => null,
        (e: unknown) => (e instanceof ErroArmazenamento ? e.motivo : "outro"),
      );
    expect(await motivo(Buffer.alloc(0))).toBe("vazio");
    expect(await motivo(Buffer.concat([JPEG, Buffer.alloc(200)]))).toBe("grande_demais");
    expect(await motivo(Buffer.from([0, 1, 2]))).toBe("tipo_nao_aceito");
  });

  it("respeita a lista de tipos aceitos", async () => {
    const soImagem = new ArmazenamentoDisco({ raiz, maxBytes: 100, tiposAceitos: ["jpeg", "png"] });
    await expect(soImagem.salvar(A, XLSX)).rejects.toMatchObject({ motivo: "tipo_nao_aceito" });
  });

  it("não aceita id que escape da raiz nem caminho fora dela", async () => {
    await expect(armazenamento.salvar("../fora", JPEG)).rejects.toThrow(/inválido/);
    await expect(armazenamento.ler("../../etc/passwd")).rejects.toThrow(/fora do armazenamento/);
  });
});
