# Dados fictícios do vídeo do pitch

Este conjunto é separado de `fixtures/mercadinho`, `fixtures/notas` e do gabarito original.
O gerador é [scripts/pitch/dados.ts](../../scripts/pitch/dados.ts). Preços, custos, quantidades,
datas e ids são determinísticos. Cada cupom fecha com a soma dos seus itens, sem ajuste artificial
de faturamento ou preço. Não há conta, extrato, transação bancária ou execução de IA pré-fabricada.

## Carregar e abrir

Requer Node 24, PostgreSQL e Redis. Pare a API e os workers antes de executar:

```bash
npm run seed:pitch
DEMO_DATA_REFERENCIA=2026-10-24 DEMO_COMERCIANTE=bom-preco npm run dev
```

`seed:pitch` **apaga os schemas public e drizzle do DATABASE_URL configurado**, reaplica as
migrações e carrega somente o Mercadinho Bom Preço. Também limpa as três filas do Omnia no
REDIS_URL configurado para liberar as chaves fixas das tomadas anteriores. Não roda em produção.
Use apenas um banco/Redis de demonstração. Não executa chamadas pagas de IA.

O comerciante é `1ffb7e15-5ba4-54c4-85af-d22d02401be3`, dono Seu João, meta de margem bruta
2500 bps (25%). O nome do dono aparece na mensagem recebida; o schema não tem campo de nome
do proprietário. `DEMO_COMERCIANTE=bom-preco` só muda o padrão de `/whatsapp/sessao`.
Um `?comerciante=<id>` explícito prevalece. Sem a variável, permanece o padrão de `seed:demo`.

O comando `npm run seed:demo` e seus fixtures continuam independentes e funcionando.

## Histórias e números

São 29 produtos, 53 dias completos de vendas (01/09 a 23/10) e 5.726 cupons.
A receita diária é da ordem de R$ 3 mil e o ticket usual fica perto de R$ 28.
Os pesos de demanda de segunda a domingo são 0,80; 0,85; 0,90; 0,95; 1,20; 1,35; 0,95.
As sextas têm os ajustes do roteiro, e a distribuição usa unidades inteiras.

| Data | Faturamento obtido | Vendas | Ticket médio |
| --- | ---: | ---: | ---: |
| 02/10 | R$ 3.756,90 | 132 | R$ 28,46 |
| 09/10 | R$ 3.747,93 | 132 | R$ 28,39 |
| 16/10 | R$ 3.747,93 | 132 | R$ 28,39 |
| 23/10 | R$ 4.189,79 | 139 | R$ 30,14 |

- Semana de 10 a 16/10: R$ 21.121,67.
- Semana de 17 a 23/10: R$ 21.989,80, alta de 4,11%.
- Líderes em unidades de 17 a 23/10: Cerveja pilsen lata 350ml, Leite integral 1L e Água mineral 1,5L.
- Maiores quedas contra 10 a 16/10: Achocolatado 400g, Sabão em pó 1,6kg e Biscoito recheado 130g,
  entre 40% e 50%, todos com pelo menos 10 unidades na base. Os demais produtos com venda na base
  variam menos de 15%.
- Vinagre de álcool 750ml: última venda em 08/10, portanto 15 dias sem vender até 23/10.
- Óleo de soja 900ml: venda R$ 7,49, custo R$ 6,20, margem de 17,22%.
- Arroz tipo 1 5kg: venda R$ 29,90, custo R$ 22,90 até 19/10 e R$ 25,40 na nota de 20/10;
  alta de custo de 10,92% e margem atual de 15,05%.
- Demais produtos: margens entre 25% e 40%. O catálogo tem códigos EAN-13 fictícios com dígito válido.

`resumo-diario.json` e `vendas.csv` contêm os valores gerados. Para conferir diretamente no banco,
execute [conferir.sql](../../scripts/pitch/conferir.sql) em um cliente PostgreSQL, por exemplo:

```bash
docker compose exec -T postgres psql -U omnia -d omnia < scripts/pitch/conferir.sql
```

## DANFE para enviar no vídeo

Envie `fixtures/pitch/danfe-video.jpg`. Ela está **fora do seed**, com hash não carregado no banco,
para passar pela extração real ao ser enviada. O JSON esperado é material de conferência e não é
uma resposta injetada no agente.

A foto representa uma DANFE simplificada fictícia da Distribuidora São Jorge, CNPJ
82.736.491/0001-06, emitida em 23/10. Não representa empresa ou documento fiscal real.
Usa `renderizarNota` do gerador existente, com perspectiva, leve rotação, sombra e fundo de mesa.

| Item | Quantidade | Custo anterior | Custo na foto |
| --- | ---: | ---: | ---: |
| Feijão carioca 1kg | 24 | R$ 6,29 | R$ 6,29 |
| Macarrão espaguete 500g | 24 | R$ 3,39 | R$ 3,39 |
| Açúcar refinado 1kg | 24 | R$ 3,09 | R$ 3,09 |
| Café torrado 500g | 12 | R$ 16,90 | R$ 18,70 |

Total: R$ 530,88. O café sobe 10,65%. Os quatro itens já têm descrições confirmadas pelo dono
para o mesmo fornecedor. As notas antigas carregam histórico de custo, origem `foto_nota` e
confiança 1, como dados fictícios já conferidos. Seus arquivos `.esperado.json` são a representação
estruturada desse histórico, não fotografias reais de compras.

Para regenerar **somente os arquivos do pitch**, incluindo a foto, use ImageMagick (`magick`)
e a fonte DejaVu Sans Mono:

```bash
npx tsx scripts/pitch/gerar.ts
```

## Refazer uma tomada

A regra de uma proativa por dia continua ativa. Para repetir o vídeo, pare a API, execute
`npm run seed:pitch` e suba novamente com as variáveis acima. Isso também remove a DANFE enviada,
suas mensagens, execuções, candidatos e jobs; não remova a restrição de idempotência do produto.

O seed inclui uma mensagem recebida do Seu João em **23/10 às 21h de São Paulo**. Na gravação de
24/10 até 21h, a janela real de atendimento está aberta. A janela usa o relógio do PostgreSQL,
não apenas `DEMO_DATA_REFERENCIA`; numa gravação em outro dia, envie uma mensagem nova do dono.
O horário de silêncio também continua valendo. A chamada real ao Analista/Extrator exige a chave
Anthropic configurada. Dados e JPEG sozinhos não substituem essa chamada.

## Testes e telas

```bash
npm test -- --runInBand scripts/pitch/dados.spec.ts
npm run test:e2e -- --testMatch '<rootDir>/scripts/pitch/*.e2e-spec.ts'
```

O e2e usa um banco temporário próprio e exige que o usuário de PostgreSQL possa criar bancos.
Ele verifica os números, rankings, quedas, vínculos, custos, hash novo e seleção do comerciante.
Não reseta o banco usado pela API. Rode também os portões completos do repositório.

Para as etapas 5 e 6, abra `/painel?comerciante=<id>` e `/bastidores?comerciante=<id>`.
Após o seed, bastidores começa com zero execuções e mostra a compra de arroz de 20/10 como última
nota; isso é esperado. Envie a foto e faça as perguntas antes de filmar a tela de execuções.
Não há registros artificiais de ferramentas ou raciocínio preenchidos pelo seed.
