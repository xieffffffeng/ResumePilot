const fs = require("node:fs/promises");
const path = require("node:path");

function sanitizeUsername(username) {
  const cleaned = String(username || "")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "default_user";
}

function cleanSurrogates(value) {
  if (typeof value === "string") {
    return value.replace(/[\uD800-\uDFFF]/g, "\uFFFD");
  }
  if (Array.isArray(value)) return value.map(cleanSurrogates);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [cleanSurrogates(key), cleanSurrogates(item)])
    );
  }
  return value;
}

function createStorage(baseDir) {
  const usersDir = path.join(baseDir, "users");
  const settingsPath = path.join(baseDir, "settings.json");

  async function ensureUserDir(username) {
    const safe = sanitizeUsername(username);
    const userDir = path.join(usersDir, safe);
    await fs.mkdir(userDir, { recursive: true });
    return { safe, userDir };
  }

  async function readJson(filePath, fallback) {
    try {
      const content = await fs.readFile(filePath, "utf8");
      return JSON.parse(content);
    } catch (error) {
      if (error.code === "ENOENT") return fallback;
      throw error;
    }
  }

  async function writeJson(filePath, data) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(cleanSurrogates(data), null, 2)}\n`, "utf8");
  }

  return {
    baseDir,
    usersDir,
    async listUsers() {
      await fs.mkdir(usersDir, { recursive: true });
      const entries = await fs.readdir(usersDir, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    },
    async loadUser(username) {
      const { userDir } = await ensureUserDir(username);
      return readJson(path.join(userDir, "profile.json"), null);
    },
    async saveUser(username, profile) {
      const { safe, userDir } = await ensureUserDir(username);
      const payload = {
        ...profile,
        updatedAt: new Date().toISOString(),
      };
      await writeJson(path.join(userDir, "profile.json"), payload);
      return { username: safe, path: path.join(userDir, "profile.json") };
    },
    async deleteUser(username) {
      const safe = sanitizeUsername(username);
      const userDir = path.resolve(usersDir, safe);
      const usersRoot = path.resolve(usersDir);
      if (!userDir.startsWith(usersRoot + path.sep)) {
        throw new Error("用户目录不在资料库范围内");
      }
      await fs.rm(userDir, { recursive: true, force: true });
      return { username: safe, path: userDir };
    },
    async listSessions(username) {
      const { userDir } = await ensureUserDir(username);
      const index = await readJson(path.join(userDir, "sessions", "_index.json"), []);
      return Array.isArray(index) ? index.filter((entry) => entry && entry.id) : [];
    },
    async loadSession(username, sessionId) {
      const { userDir } = await ensureUserDir(username);
      const safeId = sanitizeUsername(sessionId);
      return readJson(path.join(userDir, "sessions", `${safeId}.json`), null);
    },
    async saveSession(username, session) {
      if (!session || !session.id) throw new Error("会话缺少 id");
      const { userDir } = await ensureUserDir(username);
      const safeId = sanitizeUsername(session.id);
      const sessionsDir = path.join(userDir, "sessions");
      const payload = {
        ...session,
        id: safeId,
        updatedAt: new Date().toISOString(),
      };
      await writeJson(path.join(sessionsDir, `${safeId}.json`), payload);

      const indexPath = path.join(sessionsDir, "_index.json");
      const index = await readJson(indexPath, []);
      const list = Array.isArray(index) ? index : [];
      const entry = {
        id: safeId,
        title: String(payload.title || "未命名会话").slice(0, 60),
        jobTitle: String(payload.jobTitle || "").slice(0, 60),
        updatedAt: payload.updatedAt,
        summary: String(payload.summary || "").slice(0, 120),
      };
      const rest = list.filter((item) => item && item.id !== safeId);
      rest.unshift(entry);
      await writeJson(indexPath, rest);
      return { id: safeId, path: path.join(sessionsDir, `${safeId}.json`) };
    },
    async deleteSession(username, sessionId) {
      const { userDir } = await ensureUserDir(username);
      const safeId = sanitizeUsername(sessionId);
      const sessionsDir = path.join(userDir, "sessions");
      await fs.rm(path.join(sessionsDir, `${safeId}.json`), { force: true });
      const indexPath = path.join(sessionsDir, "_index.json");
      const index = await readJson(indexPath, []);
      const rest = (Array.isArray(index) ? index : []).filter((item) => item && item.id !== safeId);
      await writeJson(indexPath, rest);
      return { id: safeId };
    },
    async saveArtifact(username, kind, content, extension = "md") {
      const { userDir } = await ensureUserDir(username);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safeKind = sanitizeUsername(kind);
      const filePath = path.join(userDir, "artifacts", `${stamp}-${safeKind}.${extension}`);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, cleanSurrogates(content), "utf8");
      return filePath;
    },
    async saveArtifactBuffer(username, kind, buffer, extension = "bin") {
      const { userDir } = await ensureUserDir(username);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safeKind = sanitizeUsername(kind);
      const filePath = path.join(userDir, "artifacts", `${stamp}-${safeKind}.${extension}`);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, buffer);
      return filePath;
    },
    async loadSettings(fallback = {}) {
      return readJson(settingsPath, fallback);
    },
    async saveSettings(settings) {
      const payload = {
        ...settings,
        updatedAt: new Date().toISOString(),
      };
      await writeJson(settingsPath, payload);
      return { path: settingsPath };
    },
  };
}

module.exports = {
  createStorage,
  cleanSurrogates,
  sanitizeUsername,
};
