import { statusTransitorio } from "./cliente-visao-anthropic";

describe("statusTransitorio", () => {
  it.each([undefined, 408, 409, 429, 500, 502, 503, 529])("%s vale outra tentativa", (status) => {
    expect(statusTransitorio(status)).toBe(true);
  });

  it.each([400, 401, 403, 404, 413, 422])("%s não vale outra tentativa", (status) => {
    expect(statusTransitorio(status)).toBe(false);
  });
});
