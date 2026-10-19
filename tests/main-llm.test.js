const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildAnthropicRequestBody,
  extractAnthropicText,
  formatLlmConnectionError,
  getAgentSkillList,
  getDifficultySkillList,
  getDifficultySkillPath,
  getLlmProviderConfig,
  normalizeMessages,
  normalizeSettings,
  requiresApiKey,
  runLlmBackend,
} = require("../main");

test("normalizeMessages passes multi-turn history through", () => {
  const messages = normalizeMessages([
    { role: "user", content: "第一个问题" },
    { role: "assistant", content: "第一个回答" },
    { role: "user", content: "取消刚才的要求" },
  ]);

  assert.equal(messages.length, 4);
  assert.equal(messages[0].role, "system");
  assert.equal(messages[1].content, "第一个问题");
  assert.equal(messages[2].role, "assistant");
  assert.equal(messages[3].content, "取消刚才的要求");
});

test("normalizeMessages keeps caller-provided system prompt", () => {
  const messages = normalizeMessages([
    { role: "system", content: "自定义 system" },
    { role: "user", content: "hi" },
  ]);

  assert.equal(messages.length, 2);
  assert.equal(messages[0].content, "自定义 system");
});

test("normalizeMessages rejects invalid entries and empty lists", () => {
  const cleaned = normalizeMessages([
    null,
    { role: "user", content: "ok" },
    { role: "user" },
    { role: "hacker", content: "x" },
  ]);
  assert.equal(cleaned.length, 2);
  assert.equal(cleaned[1].content, "ok");
  assert.equal(normalizeMessages([]).length, 1);
});


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

test("normalizeSettings fills context limit from provider defaults", () => {
  assert.equal(normalizeSettings({ provider: "kimi" }).contextLimit, 1048576);
  assert.equal(normalizeSettings({ provider: "deepseek" }).contextLimit, 65536);
  assert.equal(normalizeSettings({ provider: "ollama" }).contextLimit, 8192);
  assert.equal(normalizeSettings({ provider: "unknown-provider" }).contextLimit, 8000);
});

test("normalizeSettings keeps explicit context limit and clamps minimum", () => {
  assert.equal(normalizeSettings({ provider: "kimi", contextLimit: 32000 }).contextLimit, 32000);
  assert.equal(normalizeSettings({ provider: "kimi", contextLimit: 0 }).contextLimit, 1048576);
  assert.equal(normalizeSettings({ provider: "kimi", contextLimit: 100 }).contextLimit, 1000);
});

test("getAgentSkillList returns skills with agent ownership", () => {
  const skills = getAgentSkillList();

  assert.ok(skills.length >= 3);
  assert.ok(skills.every((skill) => skill.name && skill.path && skill.purpose));
  assert.ok(skills.some((skill) => skill.agents.includes("简历整理 Agent")));
  assert.ok(skills.every((skill) => skill.available));
});

test("difficulty skills resolve per selection and fall back to normal", () => {
  const easyPath = getDifficultySkillPath("easy");
  const hardPath = getDifficultySkillPath("hard");
  const fallbackPath = getDifficultySkillPath("unexpected");

  assert.ok(easyPath.includes("interview-easy"));
  assert.ok(hardPath.includes("interview-hard"));
  assert.ok(fallbackPath.includes("interview-normal"));

  const list = getDifficultySkillList();
  assert.equal(list.length, 3);
  assert.ok(list.every((skill) => skill.agents.includes("面试官 Agent")));
  assert.deepEqual(
    list.map((skill) => skill.name).sort(),
    ["interview-easy", "interview-hard", "interview-normal"]
  );
  assert.ok(list.every((skill) => skill.available));
});

test("getLlmProviderConfig supports Kimi Code anthropic provider", () => {
  const config = getLlmProviderConfig(normalizeSettings({ provider: "kimi", apiKey: "sk-kimi-x" }));

  assert.equal(config.provider, "kimi");
  assert.equal(config.apiStyle, "anthropic");
  assert.equal(config.baseUrl, "https://api.kimi.com/coding");
  assert.equal(config.model, "kimi-k2.0905-preview");
  assert.equal(requiresApiKey("kimi"), true);
});

test("buildAnthropicRequestBody lifts system messages out of the dialog", () => {
  const body = buildAnthropicRequestBody({
    model: "kimi-k2.0905-preview",
    messages: [
      { role: "system", content: "系统指令一" },
      { role: "user", content: "第一个问题" },
      { role: "assistant", content: "第一个回答" },
      { role: "system", content: "系统指令二" },
      { role: "user", content: "第二个问题" },
    ],
  });

  assert.equal(body.system, "系统指令一\n\n系统指令二");
  assert.deepEqual(
    body.messages.map((message) => message.role),
    ["user", "assistant", "user"]
  );
  assert.equal(body.max_tokens, 8192);
  assert.equal(body.model, "kimi-k2.0905-preview");
});

test("buildAnthropicRequestBody omits system field when no system message", () => {
  const body = buildAnthropicRequestBody({
    model: "m",
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal("system" in body, false);
});

test("extractAnthropicText joins text blocks and skips thinking blocks", () => {
  const text = extractAnthropicText({
    content: [
      { type: "thinking", thinking: "..." },
      { type: "text", text: "你好" },
      { type: "text", text: "世界" },
    ],
  });
  assert.equal(text, "你好世界");
  assert.equal(extractAnthropicText({}), "");
});

test("formatLlmConnectionError gives anthropic-specific guidance", () => {
  const message = formatLlmConnectionError(
    Object.assign(new Error("fetch failed"), { cause: new Error("ECONNREFUSED") }),
    { provider: "kimi", apiStyle: "anthropic", baseUrl: "https://api.kimi.com/coding", model: "kimi-k2.0905-preview" }
  );

  assert.match(message, /Anthropic 兼容服务/);
  assert.match(message, /api\.kimi\.com/);
});

test("buildAnthropicRequestBody merges consecutive roles and drops leading assistant", () => {
  const body = buildAnthropicRequestBody({
    model: "m",
    messages: [
      { role: "assistant", content: "工作流完成通知" },
      { role: "user", content: "第一问" },
      { role: "user", content: "第二问（上次失败重发）" },
      { role: "assistant", content: "回答" },
      { role: "assistant", content: "补充" },
    ],
  });

  assert.deepEqual(
    body.messages.map((m) => m.role),
    ["user", "assistant"]
  );
  assert.match(body.messages[0].content, /第一问\n\n第二问（上次失败重发）/);
  assert.match(body.messages[1].content, /回答\n\n补充/);
});

test("runLlmBackend never treats reviewer failure as an accepted result", async () => {
  let generationCalls = 0;
  const result = await runLlmBackend({
    profile: {},
    jd: {},
    settings: { provider: "ollama", model: "test", baseUrl: "http://localhost:11434", skillInjection: false },
    maxRetries: 3,
    generateWorkflow: async () => {
      generationCalls += 1;
      return { resumeMarkdown: "# 测试", evaluation: {}, interview: {} };
    },
    reviewWorkflow: async () => {
      throw new Error("review service unavailable");
    },
  });

  assert.equal(generationCalls, 1);
  assert.equal(result.review.reviewError, true);
  assert.equal(result.review.accepted, false);
  assert.equal(result.review.score, 0);
  assert.equal(result.review.circuitBroken, false);
});
