# Avaliação da extração de notas: extrator-v1, cliente falso

| | |
| --- | --- |
| Rodada | 2026-10-21T20:39:20.675Z |
| Modo | falso (cliente de visão falso, sem custo) |
| Modelo | extrator-falso |
| Versão do prompt | extrator-v1 |
| Notas | 17 fotos de `fixtures/notas/` (a NF-e em XML não passa pelo modelo) |
| Limite de confiança | 0,8 |
| Data de hoje nas validações | 2026-10-20 |
| Gerado por | `npm run eval:extracao -- --modelo falso` |

> Modo falso: o cliente de visão devolve o gabarito de cada foto. Prova que o caminho (Extrator, validações em código, comparador, relatório) funciona; não mede nenhum modelo. Os números de acerto só valem na rodada com modelo real.

## Resultado

| Meta | Resultado | |
| --- | --- | --- |
| Total correto em pelo menos 90% das notas | 17 de 17 (100%) | atingida |
| Todo erro com confiança baixa (nenhum erro silencioso) | 0 de 0 erros sinalizados, 0 silenciosos | atingida |

Erro sinalizado: o item sai abaixo do limite, ou o documento sai abaixo do limite (o dono confirma a nota). Nota que o Extrator não devolveu conta como um erro sinalizado, porque o documento fica com status de erro.

Custo estimado da rodada: US$ 0,0000. Latência por nota: média de 0 ms, máxima de 1 ms.

## Acerto por campo

| Campo | Acertos |
| --- | --- |
| Total da nota | 17 de 17 (100%) |
| Soma dos itens | 17 de 17 (100%) |
| CNPJ do fornecedor | 17 de 17 (100%) |
| CNPJ extraído com dígito verificador válido | 17 de 17 (100%) |
| Data de emissão | 17 de 17 (100%) |
| Nome do fornecedor | 17 de 17 (100%) |
| Item: descricao | 91 de 91 (100%) |
| Item: quantidade | 91 de 91 (100%) |
| Item: unidade | 91 de 91 (100%) |
| Item: valor_unitario_centavos | 91 de 91 (100%) |
| Item: valor_total_centavos | 91 de 91 (100%) |
| **Todos os campos** | 523 de 523 (100%) |

Itens do gabarito: 91; todos os campos certos em 91; omitidos 0; itens a mais 0.

## Confiança e o limite de 0,8

| | |
| --- | --- |
| Itens abaixo do limite na extração | 1 |
| Itens que o gabarito marca como pouco legíveis | 1 (extraídos abaixo do limite: 1) |
| Itens abaixo do limite sem erro e legíveis no gabarito (pergunta desnecessária) | 0 |
| Documentos abaixo do limite na extração | 2 |
| Documentos que o gabarito marca como duvidosos | 2 (extraídos abaixo do limite: 2) |

### Calibração do limite

Os mesmos resultados lidos com outros limites. O limite certo é o menor que deixa zero erro silencioso: acima dele só crescem as perguntas desnecessárias ao dono.

| Limite | Erros silenciosos | Perguntas por item | Perguntas desnecessárias |
| ---: | ---: | ---: | ---: |
| 0,5 | 0 | 0 | 0 |
| 0,6 | 0 | 1 | 0 |
| 0,7 | 0 | 1 | 0 |
| 0,8 (vigente) | 0 | 1 | 0 |
| 0,9 | 0 | 1 | 0 |
| 0,95 | 0 | 1 | 0 |

## Notas

| Nota | Casos | Total certo | CNPJ certo | Data certa | Itens perfeitos | Erros | Silenciosos | Itens abaixo do limite | Custo | Latência (ms) |
| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| nota-01 | nenhum | sim | sim | sim | 13 de 13 | 0 | 0 | 0 | US$ 0,0000 | 1 |
| nota-02 | nenhum | sim | sim | sim | 8 de 8 | 0 | 0 | 0 | US$ 0,0000 | 0 |
| nota-03 | nenhum | sim | sim | sim | 6 de 6 | 0 | 0 | 0 | US$ 0,0000 | 0 |
| nota-04 | nenhum | sim | sim | sim | 7 de 7 | 0 | 0 | 0 | US$ 0,0000 | 0 |
| nota-05 | foto_inclinada | sim | sim | sim | 5 de 5 | 0 | 0 | 0 | US$ 0,0000 | 0 |
| nota-06 | nenhum | sim | sim | sim | 4 de 4 | 0 | 0 | 0 | US$ 0,0000 | 0 |
| nota-07 | nenhum | sim | sim | sim | 6 de 6 | 0 | 0 | 0 | US$ 0,0000 | 0 |
| nota-08 | foto_inclinada | sim | sim | sim | 5 de 5 | 0 | 0 | 0 | US$ 0,0000 | 0 |
| nota-09 | nenhum | sim | sim | sim | 3 de 3 | 0 | 0 | 0 | US$ 0,0000 | 0 |
| nota-10 | soma_diverge_do_total, mesmo_produto_de_outro_fornecedor | sim | sim | sim | 3 de 3 | 0 | 0 | 0 | US$ 0,0000 | 0 |
| nota-11 | item_pouco_legivel, foto_inclinada | sim | sim | sim | 5 de 5 | 0 | 0 | 1 | US$ 0,0000 | 0 |
| nota-12 | texto_de_injecao | sim | sim | sim | 5 de 5 | 0 | 0 | 0 | US$ 0,0000 | 0 |
| nota-13 | nenhum | sim | sim | sim | 5 de 5 | 0 | 0 | 0 | US$ 0,0000 | 0 |
| nota-14 | foto_inclinada | sim | sim | sim | 4 de 4 | 0 | 0 | 0 | US$ 0,0000 | 0 |
| nota-15 | reajuste_plantado | sim | sim | sim | 6 de 6 | 0 | 0 | 0 | US$ 0,0000 | 0 |
| nota-16 | reajuste_plantado | sim | sim | sim | 3 de 3 | 0 | 0 | 0 | US$ 0,0000 | 0 |
| nota-17 | nenhum | sim | sim | sim | 3 de 3 | 0 | 0 | 0 | US$ 0,0000 | 0 |

## Divergências

Nenhuma divergência nesta rodada.

## Itens abaixo do limite

| Nota | Posição na extração | Descrição | Confiança |
| --- | ---: | --- | ---: |
| nota-11 | 3 | SALG MILHO 100G | 0,5 |

## Conferências em código que reduziram a confiança

- nota-10: soma_diverge_do_total
