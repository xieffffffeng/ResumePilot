const assert = require("node:assert/strict");
const test = require("node:test");

const { buildReviewPrompt, normalizeReviewResult, truncateText } = require("../src/services/reviewer");
const { buildWorkflowPrompt } = require("../src/services/llm-workflow");

const profile = {
  basic: { name: "林晓", school: "清华大学" },
  education: [{ schoolName: "清华大学", degree: "硕士" }],
  experiences: [{ title: "字节跳动", role: "实习生" }],
  projects: [],
  competitions: [],
  papers: [],
  skills: "TypeScript, React",
  selfSummary: "",
};

const jd = { jobTitle: "前端工程师", source: "t", jdText: "要求 React" };

test("buildReviewPrompt includes profile, jd and the review JSON schema", () => {
  const prompt = buildReviewPrompt({
    profile,
    jd,
    workflowResult: {
      resumeMarkdown: "# 林晓",
      selectedItems: [],
      evaluation: { score: 80, matchedKeywords: [], missingKeywords: [], suggestions: [] },
      interview: { questions: [{ question: "q", referenceAnswer: "a" }], tips: [] },
    },
  });

  assert.match(prompt, /审核员 Agent/);
  assert.match(prompt, /林晓/);
  assert.match(prompt, /前端工程师/);
  assert.match(prompt, /"score": 0/);
  assert.match(prompt, /fabrication/);
  assert.match(prompt, /低于 60/);
});

test("truncateText marks truncated content", () => {
  assert.equal(truncateText("abc", 10), "abc");
  assert.equal(truncateText("abcdef", 3), "abc……（截断）");
});

test("normalizeReviewResult clamps score and normalizes issues", () => {
  const review = normalizeReviewResult({
    score: 175,
    fabrication: true,
    issues: [
      { aspect: "事实", problem: "编造成绩", severity: "major" },
      { problem: "缺少单位" },
      { severity: "minor" },
    ],
    comment: "存在编造",
  });

  assert.equal(review.score, 100);
  assert.equal(review.fabrication, true);
  assert.equal(review.issues.length, 2);
  assert.equal(review.issues[0].severity, "major");
  assert.equal(review.issues[1].severity, "major");
  assert.equal(review.comment, "存在编造");
});

test("normalizeReviewResult defaults score to 0 when missing", () => {
  const review = normalizeReviewResult({});
  assert.equal(review.score, 0);
  assert.equal(review.fabrication, false);
  assert.deepEqual(review.issues, []);
});

test("normalizeReviewResult parses a JSON string", () => {
  const review = normalizeReviewResult('{"score": 42, "issues": []}');
  assert.equal(review.score, 42);
});

test("buildWorkflowPrompt embeds review feedback for regeneration", () => {
  const base = buildWorkflowPrompt({ profile, jd, skillPaths: [] });
  const withFeedback = buildWorkflowPrompt({
    profile,
    jd,
    skillPaths: [],
    reviewFeedback: [
      { aspect: "事实", problem: "编造了奖项", severity: "major" },
      { aspect: "格式", problem: "缺少技能节", severity: "minor" },
    ],
  });

  assert.match(withFeedback, /被审核员打回/);
  assert.match(withFeedback, /1\. \[major\] 编造了奖项/);
  assert.match(withFeedback, /2\. \[minor\] 缺少技能节/);
  assert.ok(!base.includes("被审核员打回"));
});
