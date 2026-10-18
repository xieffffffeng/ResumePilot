const assert = require("node:assert/strict");
const test = require("node:test");

const {
  analyzeJobDescription,
  createEmptyProfile,
  runWorkflow,
} = require("../src/services/agents");

test("analyzeJobDescription extracts prioritized keywords from JD text", () => {
  const analysis = analyzeJobDescription(`
    Senior Frontend Engineer
    Requirements: React, TypeScript, Electron, UI performance, communication.
    Nice to have: interview platform or recruiting workflow experience.
  `);

  assert.equal(analysis.title, "Senior Frontend Engineer");
  assert.ok(analysis.mustHave.includes("react"));
  assert.ok(analysis.mustHave.includes("typescript"));
  assert.ok(analysis.keywords.includes("electron"));
});

test("runWorkflow creates tailored resume, evaluation, and interview questions", () => {
  const profile = createEmptyProfile();
  Object.assign(profile.basic, {
    name: "Alice Zhang",
    email: "alice@example.com",
    school: "Example University",
  });
  profile.experiences.push({
    title: "Frontend Intern",
    role: "Frontend Developer Intern",
    startDate: "2025-01",
    endDate: "2025-06",
    period: "2025-01 - 2025-06",
    description: "Built an Electron and React interview practice platform with resume scoring.",
  });
  profile.projects.push({
    title: "Desktop Interview Coach",
    startDate: "2024-09",
    endDate: "2024-12",
    period: "2024-09 - 2024-12",
    description: "Implemented TypeScript UI performance profiling for a recruiting workflow.",
  });
  profile.papers.push({
    title: "Resume Agent Evaluation",
    description: "Studied LLM agent scoring consistency for resume and interview workflows.",
  });
  profile.education.push({
    schoolName: "Example University",
    degree: "本科",
    startDate: "2021-09",
    endDate: "2025-06",
    major: "Computer Science",
  });

  const result = runWorkflow(profile, {
    jobTitle: "Frontend Engineer",
    jdText: "React TypeScript Electron UI performance communication",
  });

  assert.match(result.resumeMarkdown, /Alice Zhang/);
  assert.match(result.resumeMarkdown, /Electron/);
  assert.match(result.resumeMarkdown, /Frontend Developer Intern/);
  assert.match(result.resumeMarkdown, /Desktop Interview Coach|Resume Agent Evaluation/);
  assert.match(result.resumeMarkdown, /Example University \| 本科 \| Computer Science \| 2021-09 - 2025-06/);
  assert.ok(result.evaluation.score >= 60);
  assert.ok(result.interview.questions.length >= 6);
  assert.ok(result.interview.questions.every((item) => item.question && item.referenceAnswer));
});
