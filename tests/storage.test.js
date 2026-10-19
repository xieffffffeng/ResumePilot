const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  cleanSurrogates,
  createStorage,
  sanitizeUsername,
} = require("../src/services/storage");

test("sanitizeUsername creates stable folder-safe names", () => {
  assert.equal(sanitizeUsername(" Alice Zhang "), "Alice_Zhang");
  assert.equal(sanitizeUsername("../bad:name"), "bad_name");
});

test("cleanSurrogates replaces invalid unicode surrogate characters", () => {
  assert.deepEqual(cleanSurrogates({ text: "bad\udc80value" }), { text: "bad�value" });
});

test("storage isolates profiles by username", async () => {
  const baseDir = path.join(os.tmpdir(), `resume-agent-test-${Date.now()}`);
  const storage = createStorage(baseDir);

  await storage.saveUser("alice", { basic: { name: "Alice" } });
  await storage.saveUser("bob", { basic: { name: "Bob" } });

  const alice = await storage.loadUser("alice");
  const bob = await storage.loadUser("bob");
  const users = await storage.listUsers();

  assert.equal(alice.basic.name, "Alice");
  assert.equal(bob.basic.name, "Bob");
  assert.deepEqual(users.sort(), ["alice", "bob"]);
});

test("storage persists global agent settings outside user folders", async () => {
  const baseDir = path.join(os.tmpdir(), `resume-agent-settings-test-${Date.now()}`);
  const storage = createStorage(baseDir);

  const fallback = { backendMode: "llm" };
  assert.deepEqual(await storage.loadSettings(fallback), fallback);

  await storage.saveSettings({
    backendMode: "llm",
    provider: "ollama",
    model: "llama3.1",
    skillInjection: true,
  });

  const settings = await storage.loadSettings();
  assert.equal(settings.backendMode, "llm");
  assert.equal(settings.provider, "ollama");
  assert.equal(settings.model, "llama3.1");
  assert.equal(settings.skillInjection, true);
  assert.ok(settings.updatedAt);
});

test("storage saves binary artifacts for PDF export", async () => {
  const baseDir = path.join(os.tmpdir(), `resume-agent-pdf-test-${Date.now()}`);
  const storage = createStorage(baseDir);

  const filePath = await storage.saveArtifactBuffer("alice", "resume", Buffer.from("%PDF-1.4"), "pdf");

  assert.match(filePath, /\.pdf$/);
  assert.equal(require("node:fs").readFileSync(filePath, "utf8"), "%PDF-1.4");
});

test("storage deletes a user folder", async () => {
  const baseDir = path.join(os.tmpdir(), `resume-agent-delete-test-${Date.now()}`);
  const storage = createStorage(baseDir);

  await storage.saveUser("alice", { basic: { name: "Alice" } });
  assert.deepEqual(await storage.listUsers(), ["alice"]);

  const result = await storage.deleteUser("alice");
  assert.equal(result.username, "alice");
  assert.deepEqual(await storage.listUsers(), []);
});

test("storage saves, lists, loads and deletes chat sessions", async () => {
  const baseDir = path.join(os.tmpdir(), `resume-agent-sessions-test-${Date.now()}`);
  const storage = createStorage(baseDir);

  await storage.saveSession("alice", {
    id: "2026-01-01T10-00-00-abcd",
    title: "字节前端岗简历调整",
    jobTitle: "前端开发工程师",
    summary: "用户要求把项目经历改得更突出量化结果。",
    messages: [{ role: "user", content: "hi" }],
    transcript: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "你好" },
    ],
    archivedMessages: [
      { role: "user", content: "旧问题", id: "m1", archivedAt: "2026-01-01T10:05:00Z" },
    ],
    resumeVersions: [{ at: "2026-01-01T10:00:00Z", source: "workflow" }],
  });
  await storage.saveSession("alice", {
    id: "2026-01-02T10-00-00-efgh",
    title: "阿里后端岗",
  });

  const list = await storage.listSessions("alice");
  assert.equal(list.length, 2);
  // 最新保存的排在最前
  assert.equal(list[0].id, "2026-01-02T10-00-00-efgh");
  assert.equal(list[1].title, "字节前端岗简历调整");
  assert.equal(list[1].summary, "用户要求把项目经历改得更突出量化结果。");

  const session = await storage.loadSession("alice", "2026-01-01T10-00-00-abcd");
  assert.equal(session.transcript.length, 2);
  assert.equal(session.resumeVersions.length, 1);
  assert.equal(session.archivedMessages.length, 1);
  assert.equal(session.archivedMessages[0].archivedAt, "2026-01-01T10:05:00Z");
  assert.ok(session.updatedAt);

  // 用户之间隔离
  assert.deepEqual(await storage.listSessions("bob"), []);

  // 保存同 id 会覆盖并提升索引位置，不产生重复
  await storage.saveSession("alice", { id: "2026-01-01T10-00-00-abcd", title: "字节前端岗（已更新）" });
  const updatedList = await storage.listSessions("alice");
  assert.equal(updatedList.length, 2);
  assert.equal(updatedList[0].id, "2026-01-01T10-00-00-abcd");
  assert.equal(updatedList[0].title, "字节前端岗（已更新）");

  await storage.deleteSession("alice", "2026-01-01T10-00-00-abcd");
  const afterDelete = await storage.listSessions("alice");
  assert.equal(afterDelete.length, 1);
  assert.equal(afterDelete[0].id, "2026-01-02T10-00-00-efgh");
  assert.equal(await storage.loadSession("alice", "2026-01-01T10-00-00-abcd"), null);

  await storage.deleteUser("alice");
  await storage.deleteUser("bob");
});
