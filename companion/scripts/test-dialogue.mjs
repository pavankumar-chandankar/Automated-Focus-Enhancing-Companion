import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
// Compile the pure dialogue module with the project's existing TS dependency.
// No extra test framework or runtime dependencies.
const input = await readFile(new URL("../src/dialogue.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
});
const { planMessage, restingBehaviour } = await import("data:text/javascript;base64," + Buffer.from(outputText).toString("base64"));
const cases = [
  ["Let's study together.", "idle", "start", "working"],
  ["I need to work on my paper", "idle", "start", "working"],
  ["I'm getting distracted.", "running", "none", "encouraging"],
  ["I need a break", "running", "pause", "resting"],
  ["I need a break", "paused", "none", "resting"],
  ["I'm back", "paused", "resume", "working"],
  ["I'm back", "idle", "none", "attentive"],
  ["I'm done", "running", "finish", "celebrating"],
  ["I'm done", "idle", "none", "available"],
  ["Just sit with me", "running", "quiet", "working"],
  ["Don't interrupt me", "idle", "quiet", "available"],
  ["I am tired", "running", "none", "encouraging"],
  ["Don't pause", "running", "none", "attentive"],
  ["Explain my research paper", "running", "none", "attentive"],
  ["I need to work on " + "x".repeat(161), "idle", "none", "attentive"],
  ["Let's study together", "paused", "none", "resting"],
  ["I want to kill myself", "running", "none", "attentive"]
];
for (const [text, phase, action, behaviour] of cases) {
  const plan = planMessage(text, phase);
  assert.equal(plan.action, action, text);
  assert.equal(plan.behaviour, behaviour, text);
}
assert.equal(planMessage("I need to work on my paper", "idle").goal, "my paper");
assert.equal(planMessage("Let's study together", "idle").goal, "Focus together");
assert.match(planMessage("I want to kill myself", "running").reply, /emergency services/);
assert.equal(restingBehaviour("running"), "working");
assert.equal(restingBehaviour("paused"), "resting");
assert.equal(restingBehaviour("idle"), "available");
console.log("23 dialogue and behaviour assertions/cases passed.");

// Free-form dialogue can reach the model; commands and explicit crisis phrases cannot.
assert.equal(planMessage("My mind keeps wandering today", "running").useModel, true);
assert.equal(planMessage("I'm distracted", "running").useModel, true);
assert.equal(planMessage("Pause", "running").useModel, undefined);
assert.equal(planMessage("I want to kill myself", "running").useModel, undefined);
assert.equal(planMessage("Don't interrupt me", "running").useModel, undefined);
console.log("5 model-routing assertions passed.");
