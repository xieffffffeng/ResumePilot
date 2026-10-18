const assert = require("node:assert/strict");
const test = require("node:test");

const {
  formatLlmConnectionError,
  getAgentSkillList,
  getLlmProviderConfig,
  normalizeSettings,
  requiresApiKey,
} = require("../main");

test("normalizeSettings always uses direct LLM backend", () => {
  const settings = normalizeSettings({ backendMode: "legacy", provider: "deepseek", timeoutSeconds: 0 });

  assert.equal(settings.backendMode, "llm");
  assert.equal(settings.provider, "deepseek");
  assert.equal(settings.timeoutSeconds, 120);
});

test("normalizeSettings migrates old local provider ids", () => {
  assert.equal(normalizeSettings({ provider: "local" }).provider, "lmstudio");
  assert.equal(normalizeSettings({ provider: "ollama-cloud" }).provider, "ollama");
});

test("normalizeSettings fills provider defaults for direct LLM mode", () => {
  const settings = normalizeSettings({ provider: "openai", model: "" });

  assert.equal(settings.provider, "openai");
  assert.equal(settings.model, "gpt-4o-mini");
  assert.equal(settings.baseUrl, "https://api.openai.com/v1");
});

test("getLlmProviderConfig supports cloud and local model sources", () => {
  assert.deepEqual(getLlmProviderConfig(normalizeSettings({ provider: "deepseek", apiKey: "sk" })), {
    provider: "deepseek",
    model: "deepseek-chat",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "sk",
    apiStyle: "openai",
  });

  assert.equal(getLlmProviderConfig(normalizeSettings({ provider: "ollama" })).baseUrl, "http://localhost:11434");
});

test("requiresApiKey allows local model providers without keys", () => {
  assert.equal(requiresApiKey("deepseek"), true);
  assert.equal(requiresApiKey("openai"), true);
  assert.equal(requiresApiKey("ollama"), false);
  assert.equal(requiresApiKey("lmstudio"), false);
});

test("formatLlmConnectionError gives provider-specific guidance", () => {
  const message = formatLlmConnectionError(
    Object.assign(new Error("fetch failed"), { cause: new Error("ECONNREFUSED") }),
    { provider: "ollama", apiStyle: "ollama", baseUrl: "http://localhost:11434", model: "llama3.1" }
  );

  assert.match(message, /无法连接 Ollama/);
  assert.match(message, /llama3\.1/);
});

test("getAgentSkillList returns skills with agent ownership", () => {
  const skills = getAgentSkillList();

  assert.ok(skills.length >= 3);
  assert.ok(skills.every((skill) => skill.name && skill.path && skill.purpose));
  assert.ok(skills.some((skill) => skill.agents.includes("简历整理 Agent")));
});
