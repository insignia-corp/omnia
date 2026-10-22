# WhatsApp simulado (issues #179 e #182)

Tela de conversa com o Omnia que imita o WhatsApp Web, para o pitch. Não usa a API da Meta, mas segue as regras dela: o que aparece aqui é o que o canal real (#61 a #63) consegue enviar. Só a conversa: sem lista de chats, status ou configurações.

## Rodar

Com o backend (dados reais do banco): o Nest serve a pasta em `/whatsapp`, sem build, no `npm run dev`, no `npm run build` e na imagem Docker (o Dockerfile copia a pasta).

```bash
npm run seed:demo
```

```bash
npm run dev
```

Abra `http://localhost:3000/whatsapp`. Para os dados de teste, que terminam em 2026-10-19, ponha `DEMO_DATA_REFERENCIA=2026-10-20` no `.env` (ver `src/canal/README.md`). Sem o backend, qualquer servidor estático serve a pasta e a tela cai sozinha no modo demonstração:

```bash
python3 -m http.server 5180 --bind 127.0.0.1 --directory web/whatsapp
```

Parâmetros de URL: `?modo=api` ou `?modo=demo` (sem o parâmetro, tenta o backend e cai na demonstração se ele não responder), `?comerciante=<id>` (dono no modo api; sem ele, o comerciante do seed da demo), `?painel=<url>` (botão "Abrir painel" do modo demonstração; no api o link vem do backend), `?escala=1.4` (tamanho da letra), `?tema=claro`.

No menu de três pontos: receber o resumo das 7h (no máximo 1 proativa por dia; no api é o mesmo serviço do job diário), aumentar e diminuir a letra, trocar o tema e limpar a conversa (no api limpa só a tela: o histórico nunca é apagado e volta ao recarregar). Arrastar uma foto para a conversa também envia.

Testes sem navegador: `npm run test:web` (regras da Meta, formatação de centavos e bps, se toda resposta e todo botão do modo demonstração respeitam as regras, e o transporte do backend com `fetch` falso). As rotas do backend têm e2e em `tests/canal/whatsapp.e2e-spec.ts`.

## Arquivos

| Arquivo | Papel |
| --- | --- |
| `index.html`, `estilo.css` | Estrutura e visual (tema escuro de 2025 do WhatsApp Web, claro como alternativa). Tamanhos em `em` a partir de `--escala`. |
| `app.js` | Liga composição, anexos, lista, menu e o transporte. |
| `render.js` | Desenha as bolhas por tipo de mensagem. Só nós DOM, nunca `innerHTML`. |
| `formato.js` | `*negrito*`, `_itálico_`, `~riscado~`, `` `código` `` e ` ```mono``` `. |
| `regras-meta.js` | Limites da Cloud API conferidos antes de mostrar uma mensagem do agente. |
| `modelos.js` | Modelos (templates) como seriam aprovados na Meta. Cópia para desenhar a bolha: o dono do `resumo_diario` é `src/canal/whatsapp/modelos.ts`, e um teste confere que as duas não divergem. |
| `transporte-api.js` | Backend: rotas `/chat/*` do Nest, identidade por `X-Comerciante-Id`, atualização por polling a cada 1,5 s. |
| `transporte-demo.js` | Agente simulado com os números do gabarito (data de referência 2026-10-19). |
| `tipos.js` | Contrato entre a tela e o transporte (JSDoc). |

## Contrato do transporte

A tela só conhece a interface `Transporte` (`tipos.js`): `historico()`, `enviar(mensagem, arquivo?)`, `aoEvento(ouvinte)` e, opcional, `reiniciar()` e `simularProativa()`. A demonstração e o backend são dois transportes com a mesma interface.

No modo api (`transporte-api.js`), o comerciante vem de `GET /whatsapp/sessao` (o `?comerciante=` ou o do seed), nunca do texto, e vai em `X-Comerciante-Id` (provisório, `src/comerciante/sessao.ts`). Texto, botão e linha de lista vão no formato do webhook para `POST /chat/mensagens`; foto e XML da NF-e vão para `POST /chat/notas` com o id da mensagem e a legenda; o histórico, os tiques e o "digitando" vêm de `GET /chat/mensagens?formato=whatsapp`; a foto de uma mensagem antiga é baixada de `GET /chat/notas/:documento/arquivo`; o resumo das 7h é `POST /chat/proativa`. Detalhe das rotas em `src/canal/README.md`.

Mensagens no formato da Cloud API, para o canal real reaproveitar o desenho:

- Do agente (`direcao: "saida"`): o corpo de `POST /{phone-number-id}/messages`. Tipos `text`, `image`, `document`, `interactive` (`button`, `list`, `cta_url`) e `template`.
- Do dono (`direcao: "entrada"`): o objeto `messages[]` do webhook. Tipos `text`, `image`, `document`, `interactive` (`button_reply`, `list_reply`) e `button` (toque em botão de modelo). Resposta a uma mensagem leva `context.id`.

Eventos que o transporte emite: `{ tipo: "mensagem", mensagem }`, `{ tipo: "status", id, status }` (`sent`, `delivered`, `read`, `failed`; só avança) e `{ tipo: "digitando", ativo }`. Na Cloud API, "lida" e "digitando" saem na mesma chamada de marcar como lida.

## Regras da Meta conferidas

`regras-meta.js` é o dono dos números (o backend confere os mesmos em `src/canal/whatsapp/regras-meta.ts` antes de gravar): texto até 4096 caracteres, legenda até 1024, corpo interativo até 1024, cabeçalho e rodapé até 60, de 1 a 3 botões de resposta com título até 20, lista com até 10 linhas no total (título até 24, descrição até 72, texto do botão até 20), botão de link com texto até 20, foto JPEG ou PNG até 5 MB, documento até 100 MB, e janela de 24 h: sem mensagem do dono nas últimas 24 h, o agente só pode mandar modelo. Mensagem do agente que viola uma regra aparece como aviso tracejado em vermelho no lugar da bolha (o canal real receberia erro da Meta).
