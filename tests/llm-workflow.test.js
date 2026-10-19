const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildJsonRepairPrompt,
  buildWorkflowPrompt,
  compactProfile,
  normalizeInterviewQuestions,
  normalizeWorkflowResult,
  parseJsonObject,
} = require("../src/services/llm-workflow");

test("parseJsonObject extracts JSON from model text", () => {
  const parsed = parseJsonObject(`
    好的，结果如下：
    {"evaluation":{"score":88},"resumeMarkdown":"OK"}
  `);

  assert.equal(parsed.evaluation.score, 88);
  assert.equal(parsed.resumeMarkdown, "OK");
});

test("parseJsonObject marks malformed model JSON for repair", () => {
  assert.throws(
    () => parseJsonObject('{"interview":{"questions":["a" "b"]}}'),
    (error) => {
      assert.equal(error.code, "LLM_INVALID_JSON");
      assert.match(error.message, /不是合法 JSON/);
      assert.match(error.rawText, /questions/);
      return true;
    }
  );
});

test("normalizeWorkflowResult returns interview answers", () => {
  const result = normalizeWorkflowResult({
    resumeMarkdown: "# 简历",
    evaluation: { score: "90" },
    interview: {
      questions: [{ question: "请介绍项目", referenceAnswer: "用 STAR 回答。" }],
      tips: ["保持结构化"],
    },
  });

  assert.equal(result.evaluation.score, 90);
  assert.deepEqual(result.interview.questions, [{ question: "请介绍项目", referenceAnswer: "用 STAR 回答。" }]);
});

test("normalizeInterviewQuestions upgrades legacy string questions", () => {
  const questions = normalizeInterviewQuestions(["请介绍项目"]);

  assert.equal(questions[0].question, "请介绍项目");
  assert.match(questions[0].referenceAnswer, /STAR/);
});

test("buildWorkflowPrompt includes reference answer schema", () => {
  const prompt = buildWorkflowPrompt({
    profile: {
      experiences: [{ title: "实习", role: "前端实习生", description: "React 开发" }],
    },
    jd: { jobTitle: "前端开发", jdText: "React" },
    skillPaths: [],
  });

  assert.match(prompt, /referenceAnswer/);
  assert.match(prompt, /“岗位”字段/);
});

test("buildJsonRepairPrompt preserves interview answer fields", () => {
  const prompt = buildJsonRepairPrompt({
    rawText: '{"resumeMarkdown":"# 简历","interview":{"questions":[{"question":"a" "referenceAnswer":"b"}]}}',
  });

  assert.match(prompt, /referenceAnswer/);
  assert.match(prompt, /只修复 JSON 语法错误/);
});

test("compactProfile keeps education but removes photo base64", () => {
  const compact = compactProfile({
    basic: { name: "Alice", photoDataUrl: "data:image/png;base64,abc" },
    education: [{ schoolName: "Example University", degree: "本科" }],
  });

  assert.equal(compact.basic.name, "Alice");
  assert.equal(compact.basic.hasPhoto, true);
  assert.equal(compact.basic.photoDataUrl, undefined);
  assert.deepEqual(compact.education, [{ schoolName: "Example University", degree: "本科" }]);
});

test("buildWorkflowPrompt references the injected difficulty skill", () => {
  const { buildWorkflowPrompt, normalizeDifficulty, getDifficultySkillName } = require("../src/services/llm-workflow");

  assert.equal(normalizeDifficulty("easy"), "easy");
  assert.equal(normalizeDifficulty("hard"), "hard");
  assert.equal(normalizeDifficulty("nonsense"), "normal");
  assert.equal(normalizeDifficulty(undefined), "normal");
  assert.equal(getDifficultySkillName("easy"), "interview-easy");
  assert.equal(getDifficultySkillName("hard"), "interview-hard");
  assert.equal(getDifficultySkillName("oops"), "interview-normal");

  const hard = buildWorkflowPrompt({ profile: {}, jd: { difficulty: "hard" }, skillPaths: [] });
  assert.match(hard, /当前：hard/);
  assert.match(hard, /面试难度 skill/);

  const fallback = buildWorkflowPrompt({ profile: {}, jd: {}, skillPaths: [] });
  assert.match(fallback, /当前：normal/);
});
