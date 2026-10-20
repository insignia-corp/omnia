#!/usr/bin/env python3
"""Renderiza as notas de fixtures/notas/*.esperado.json como imagens PNG.

Cada imagem imita uma nota de compra impressa e fotografada (fundo, leve rotação e ruído, com
semente fixa). É entrada de teste da extração com modelo com visão, não foto real: se houver
tempo, troque por fotos reais anonimizadas mantendo os mesmos nomes. Uso:

    python3 scripts/renderizar-notas.py

Requer Pillow e a fonte DejaVu Sans Mono.
"""
import json
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

RAIZ = Path(__file__).resolve().parent.parent / "fixtures" / "notas"
FONTE = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FONTE_NEGRITO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
LARGURA = 760
MARGEM = 36
ALTURA_LINHA = 30


def brl(centavos: int) -> str:
    return f"{centavos // 100:,}".replace(",", ".") + f",{centavos % 100:02d}"


def quebrar(texto: str, largura: int) -> list[str]:
    linhas, atual = [], ""
    for palavra in texto.split():
        if len(atual) + len(palavra) + 1 > largura:
            linhas.append(atual)
            atual = palavra
        else:
            atual = f"{atual} {palavra}".strip()
    return linhas + ([atual] if atual else [])


def renderizar(caminho_json: Path) -> Path:
    dados = json.loads(caminho_json.read_text(encoding="utf-8"))
    ext, esp = dados["extracao"], dados["esperado"]
    if esp["formato"] != "foto":
        raise SystemExit(f"{caminho_json.name} não é foto")
    rng = random.Random(caminho_json.stem)

    normal = ImageFont.truetype(FONTE, 19)
    negrito = ImageFont.truetype(FONTE_NEGRITO, 21)
    rodape = quebrar(esp["rodape"], 52) if esp["rodape"] else []
    altura = MARGEM * 2 + ALTURA_LINHA * (9 + len(ext["itens"]) + len(rodape)) + 20

    papel = Image.new("RGB", (LARGURA, altura), (250, 249, 244))
    d = ImageDraw.Draw(papel)
    y = MARGEM
    cinza = (45, 45, 45)

    def texto(t: str, fonte=normal, centro=False):
        nonlocal y
        x = (LARGURA - d.textlength(t, font=fonte)) / 2 if centro else MARGEM
        d.text((x, y), t, fill=cinza, font=fonte)
        y += ALTURA_LINHA

    texto(ext["fornecedor"]["nome"][:44].upper(), negrito, True)
    texto(f"CNPJ {ext['fornecedor']['cnpj']}", centro=True)
    texto("DOCUMENTO AUXILIAR - PEDIDO DE VENDA", centro=True)
    texto(f"EMISSAO: {ext['data_emissao'][8:]}/{ext['data_emissao'][5:7]}/{ext['data_emissao'][:4]}")
    texto("-" * 56)
    texto(f"{'DESCRICAO':<28}{'QTD':>3} {'UN':<2}{'V.UNIT':>8}{'V.TOTAL':>10}", negrito)

    ilegivel = None
    for i, item in enumerate(ext["itens"]):
        linha = (
            f"{item['descricao']:<28}{item['quantidade']:>3} {item['unidade'][:2]:<2}"
            f"{brl(item['valor_unitario_centavos']):>8}{brl(item['valor_total_centavos']):>10}"
        )
        if i in esp["itens_confianca_baixa"]:
            ilegivel = (MARGEM, y, LARGURA - MARGEM, y + ALTURA_LINHA)
        texto(linha)

    texto("-" * 56)
    texto(f"{'TOTAL R$':<42}{brl(ext['total_centavos']):>10}", negrito)
    for parte in rodape:
        texto(parte)

    if ilegivel:
        # Mancha de tinta e desfoque sobre a linha: o item deve sair com confiança baixa.
        regiao = papel.crop(ilegivel).filter(ImageFilter.GaussianBlur(3.5))
        papel.paste(regiao, ilegivel[:2])
        d = ImageDraw.Draw(papel)
        for _ in range(3):
            x0 = rng.randint(LARGURA - MARGEM - 320, LARGURA - MARGEM - 170)
            d.line([(x0, ilegivel[1] + 4), (x0 + rng.randint(40, 120), ilegivel[3] - 4)], fill=(120, 120, 120), width=5)

    # Aparência de foto: fundo de mesa, leve rotação, ruído e desfoque.
    mesa = Image.new("RGB", (LARGURA + 80, altura + 80), (92, 84, 74))
    mesa.paste(papel.rotate(rng.uniform(-1.8, 1.8), expand=True, fillcolor=(92, 84, 74)).crop((0, 0, LARGURA, altura)), (40, 40))
    pixels = mesa.load()
    for _ in range(mesa.width * mesa.height // 25):
        x, yy = rng.randrange(mesa.width), rng.randrange(mesa.height)
        r, g, b = pixels[x, yy]
        v = rng.randint(-14, 14)
        pixels[x, yy] = (max(0, min(255, r + v)), max(0, min(255, g + v)), max(0, min(255, b + v)))
    mesa = mesa.filter(ImageFilter.GaussianBlur(0.6))

    destino = caminho_json.with_name(esp["arquivo"])
    mesa.save(destino, optimize=True)
    return destino


if __name__ == "__main__":
    for caminho in sorted(RAIZ.glob("*.esperado.json")):
        dados = json.loads(caminho.read_text(encoding="utf-8"))
        if dados["esperado"]["formato"] == "foto":
            print(renderizar(caminho))
