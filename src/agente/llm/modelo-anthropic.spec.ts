import { ModeloAnthropic } from "./modelo-anthropic";

const env = {
  ANTHROPIC_API_KEY: "chave-de-teste",
  LLM_MODELO: "claude-sonnet-5-5",
  LLM_ESFORCO: "medium" as const,
  LLM_TIMEOUT_MS: 5_000,
  LLM_MAX_RETRIES: 2,
};

const pedido = { system: "s", messages: [{ role: "user" as const, content: "oi" }], tools: [] };

const mensagemOk = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5-5",
  stop_reason: "end_turn",
  content: [{ type: "text", text: "olá" }],
  usage: { input_tokens: 10, output_tokens: 2 },
};

const json = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), {
    status,
    // O SDK usa retry-after-ms: a espera do teste fica em 1 ms.
    headers: { "content-type": "application/json", "retry-after-ms": "1" },
  });

/** `fetch` falso: devolve as respostas em ordem e guarda o corpo de cada chamada. */
function fetchRoteirizado(respostas: (Response | Error)[]) {
  const corpos: Record<string, unknown>[] = [];
  const fn = ((_url: unknown, init?: RequestInit) => {
    corpos.push(JSON.parse(init?.body as string) as Record<string, unknown>);
    const r = respostas.shift();
    if (!r) return Promise.reject(new Error("Roteiro do fetch acabou"));
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  }) as typeof fetch;
  return { fn, corpos };
}

describe("ModeloAnthropic: falhas da API", () => {
  it("repete erro 5xx e 429 e devolve a resposta quando uma tentativa passa", async () => {
    const f = fetchRoteirizado([
      json(529, { type: "error" }),
      json(429, { type: "error" }),
      json(200, mensagemOk),
    ]);
    const r = await new ModeloAnthropic(env, f.fn).gerar(pedido);
    expect(r.content).toEqual(mensagemOk.content);
    expect(f.corpos).toHaveLength(3);
  });

  it("depois de esgotar as tentativas o erro sobe (o loop vira fallback)", async () => {
    const f = fetchRoteirizado([json(500, {}), json(500, {}), json(500, {})]);
    await expect(new ModeloAnthropic(env, f.fn).gerar(pedido)).rejects.toThrow();
    expect(f.corpos).toHaveLength(3);
  });

  it("LLM_MAX_RETRIES=0 não repete", async () => {
    const f = fetchRoteirizado([json(500, {}), json(200, mensagemOk)]);
    await expect(new ModeloAnthropic({ ...env, LLM_MAX_RETRIES: 0 }, f.fn).gerar(pedido)).rejects.toThrow();
    expect(f.corpos).toHaveLength(1);
  });

  it("pedido inválido (400) não é repetido", async () => {
    const f = fetchRoteirizado([json(400, { type: "error" }), json(200, mensagemOk)]);
    await expect(new ModeloAnthropic(env, f.fn).gerar(pedido)).rejects.toThrow();
    expect(f.corpos).toHaveLength(1);
  });

  it("erro de conexão é repetido", async () => {
    const f = fetchRoteirizado([new TypeError("fetch failed"), json(200, mensagemOk)]);
    await new ModeloAnthropic(env, f.fn).gerar(pedido);
    expect(f.corpos).toHaveLength(2);
  });

  it("o esforço do pedido vence o padrão do .env", async () => {
    const f = fetchRoteirizado([json(200, mensagemOk), json(200, mensagemOk)]);
    const modelo = new ModeloAnthropic(env, f.fn);
    await modelo.gerar({ ...pedido, esforco: "low" });
    await modelo.gerar(pedido);
    expect(f.corpos.map((c) => (c.output_config as { effort: string }).effort)).toEqual(["low", "medium"]);
  });

  it("cache em dois pontos: no fim do prompt de sistema e no fim da conversa", async () => {
    const f = fetchRoteirizado([json(200, mensagemOk)]);
    await new ModeloAnthropic(env, f.fn).gerar(pedido);
    expect(f.corpos[0]!.system).toEqual([{ type: "text", text: "s", cache_control: { type: "ephemeral" } }]);
    expect(f.corpos[0]!.cache_control).toEqual({ type: "ephemeral" });
  });
});
