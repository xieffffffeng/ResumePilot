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
