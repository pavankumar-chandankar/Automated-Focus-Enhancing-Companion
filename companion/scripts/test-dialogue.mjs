import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
// Compile the pure dialogue module with the project's existing TS dependency.
// No extra test framework or runtime dependencies.
const input = await readFile(new URL("../src/dialogue.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
});
const { planMessage, restingBehaviour, actionAllowed, confirmedPlan, resolveConfirmation, proposalQuestion, rememberTurn, awarenessCommand, screenCommand, monitoringRequest, monitoringGoalFromRequest, focusDeclaration } = await import("data:text/javascript;base64," + Buffer.from(outputText).toString("base64"));
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

assert.equal(planMessage("Pause the session I am taking a break", "running").action, "pause");
assert.equal(planMessage("Pause the session, I am taking a break", "running").action, "pause");
assert.equal(planMessage("I'm going to take a break", "running").action, "pause");
assert.equal(planMessage("Alright, let's get going again", "paused").action, "resume");
assert.equal(planMessage("I'm finished for today", "running").action, "finish");
assert.equal(planMessage("Leave me alone for now", "running").action, "hide");
for (const input of ["Don't pause the session", "Should I take a break?", "Pause and finish the session", "I am not taking a break", "I need to work on my paper but don't start"]) {
  assert.equal(planMessage(input, "running").action, "none", input);
  assert.equal(planMessage(input, "idle").action, "none", input);
}
const pending = {action:"pause", phase:"running", expiresAt:1000};
assert.equal(resolveConfirmation("yes please", pending, "running", 999), "accept");
assert.equal(resolveConfirmation("no thanks", pending, "running", 999), "decline");
assert.equal(resolveConfirmation("yes but don't pause", pending, "running", 999), "unrelated");
assert.equal(resolveConfirmation("yes", pending, "running", 1000), "expired");
assert.equal(resolveConfirmation("yes", pending, "paused", 999), "expired");
assert.equal(resolveConfirmation("yes", null, "running", 999), "unrelated");
assert.equal(actionAllowed("pause", "paused"), false);
assert.equal(confirmedPlan("resume", "running"), null);
assert.equal(confirmedPlan("pause", "running").behaviour, "resting");
assert.equal(confirmedPlan("start", "idle").goal, "Focus together");
assert.match(proposalQuestion("pause"), /pause/);
console.log("Functional intent and confirmation regression assertions passed.");

let memory = [];
for (let i=0;i<6;i++) memory = rememberTurn(memory, "message "+i, "reply "+i);
assert.equal(memory.length,4);
assert.equal(memory[0].user,"message 2");
assert.equal(memory[3].reply,"reply 5");
assert.equal(rememberTurn(memory,"", "response").length,4);
assert.equal(Array.from(rememberTurn([], "x".repeat(301), "ok")[0].user).length,300);
console.log("Bounded conversation memory assertions passed.");

assert.equal(awarenessCommand("Watch my activity."), "enable");
assert.equal(awarenessCommand("Stop watching"), "disable");
assert.equal(awarenessCommand("What can you see?"), "status");
for (const text of ["Don't watch my activity", "Should I watch my activity?", "watch my activity and finish", '"watch my activity"']) assert.equal(awarenessCommand(text), null);
console.log("Local awareness consent command assertions passed.");

assert.equal(screenCommand("Watch my screen."), "choose");
assert.equal(screenCommand("What can you read?"), "preview");
assert.equal(screenCommand("Stop watching my screen"), "stop");
for (const text of ["Don't watch my screen", "Should I watch my screen?", '"watch my screen"', "watch my screen and analyze"]) assert.equal(screenCommand(text), null);
console.log("Screen consent command assertions passed.");

assert.equal(screenCommand("Follow my work"), "choose");
assert.equal(screenCommand("What am I working on?"), "preview");
assert.equal(screenCommand("Summarize my screen"), "preview");
assert.equal(screenCommand("Don't follow my screen"), null);

assert.equal(monitoringRequest("I am reading this document and get me on track if I get diverted"), true);
assert.equal(monitoringRequest("Remind me if I switch tabs"), true);
assert.equal(monitoringRequest("Don't keep me on track"), false);
assert.equal(monitoringRequest("What if you watch my screen?"), false);
console.log("Natural monitoring request routing assertions passed.");

assert.equal(screenCommand("Please watch my screen"), "choose");
assert.equal(monitoringGoalFromRequest("Please watch my screen", "please watch my screen"), "");
assert.equal(monitoringGoalFromRequest("Please watch my screen", "Read reliability theory"), "Read reliability theory");
assert.equal(monitoringGoalFromRequest("I am reading this document and get me on track if I get diverted", ""), "I am reading this document");
assert.equal(monitoringGoalFromRequest("Remind me if I switch tabs", ""), "");
console.log("Monitoring goal extraction assertions passed.");


// Embodied presence is independent of native and cloud intelligence.
const presenceSource = await readFile(new URL("../src/presence.ts", import.meta.url), "utf8");
const {outputText: presenceJs} = ts.transpileModule(presenceSource, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
const {choosePose, basePose, reactionPose, autonomousMove, canAnimateAmbient, scheduleAmbient} = await import("data:text/javascript;base64," + Buffer.from(presenceJs).toString("base64"));
const neutral = {phase:"idle",dragging:false,pressed:false,busy:false,reminder:false,expanded:false,hovered:false,gesture:null,response:null,ambient:null};
assert.equal(choosePose(neutral),"idle");
assert.equal(choosePose({...neutral,phase:"running"}),"work");
assert.equal(choosePose({...neutral,phase:"paused"}),"rest");
assert.equal(choosePose({...neutral,hovered:true}),"curious");
assert.equal(choosePose({...neutral,pressed:true,ambient:"stretch"}),"touch");
assert.equal(choosePose({...neutral,dragging:true,pressed:true,busy:true}),"carried");
assert.equal(choosePose({...neutral,gesture:"settle",hovered:true}),"settle");
assert.equal(choosePose({...neutral,busy:true,response:"celebrate"}),"thinking");
assert.equal(choosePose({...neutral,reminder:true,ambient:"stretch"}),"encourage");
assert.equal(choosePose({...neutral,response:"celebrate"}),"celebrate");
assert.equal(choosePose({...neutral,expanded:true,ambient:"look-around"}),"listening");
assert.equal(choosePose({...neutral,ambient:"stretch"}),"stretch");
assert.equal(reactionPose("working"),null);
assert.equal(reactionPose("celebrating"),"celebrate");
assert.equal(basePose("running"),"work");
assert.equal(autonomousMove("idle",.1,false).pose,"stretch");
assert.equal(autonomousMove("idle",.9,false).pose,"look-around");
assert.equal(autonomousMove("running",.5,true).pose,"turn-page");
assert.ok(autonomousMove("running",.5,true).delay > autonomousMove("running",.5,false).delay);
assert.equal(autonomousMove("paused",.5,false).pose,"yawn");
assert.equal(canAnimateAmbient(neutral),true);
for(const key of ["dragging","pressed","busy","reminder","expanded","hovered"]) assert.equal(canAnimateAmbient({...neutral,[key]:true}),false);
assert.equal(canAnimateAmbient({...neutral,response:"encourage"}),false);
assert.equal(choosePose({...neutral,phase:"running",response:null,ambient:null}),"work");
console.log("Embodied presence policy assertions passed.");

let nextId=0;
const scheduled=new Map(), emitted=[];
const clock={set(fn,ms){const id=++nextId;scheduled.set(id,{fn,ms});return id;},clear(id){scheduled.delete(id);},random:()=>0};
function fireNext(){const [id,job]=scheduled.entries().next().value;scheduled.delete(id);job.fn();return job.ms;}
const cancel=scheduleAmbient("idle",false,p=>emitted.push(p),clock);
assert.equal(scheduled.size,1);
assert.equal(fireNext(),12000);
assert.deepEqual(emitted,["stretch"]);
assert.equal(fireNext(),1900);
assert.deepEqual(emitted,["stretch",null]);
assert.equal(scheduled.size,1);
cancel();
assert.equal(scheduled.size,0);
const stop=scheduleAmbient("running",true,p=>emitted.push(p),clock);
assert.equal(fireNext(),65000);
assert.equal(emitted.at(-1),"turn-page");
const stale=scheduled.values().next().value.fn;
stop();stale();
assert.equal(scheduled.size,0);
assert.equal(emitted.at(-1),"turn-page");
console.log("Autonomous scheduler cancellation and recurrence assertions passed.");

assert.equal(focusDeclaration("I am focusing on reliability engineering."),"I am focusing on reliability engineering.");
assert.equal(focusDeclaration("I'm reading this document"),"I'm reading this document");
assert.equal(focusDeclaration("I'm not focusing on anything"),null);
assert.equal(focusDeclaration("I am focusing on this?"),null);
assert.equal(focusDeclaration("I am exhausted"),null);
console.log("Concrete focus declaration routing assertions passed.");

const controlSource = await readFile(new URL("../src/controlLogic.ts", import.meta.url), "utf8");
const {outputText:controlJs}=ts.transpileModule(controlSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
const {sessionActions,elapsedLabel}=await import("data:text/javascript;base64,"+Buffer.from(controlJs).toString("base64"));
assert.deepEqual(sessionActions("idle"),["start"]);
assert.deepEqual(sessionActions("running"),["pause","finish"]);
assert.deepEqual(sessionActions("paused"),["resume","finish"]);
assert.equal(elapsedLabel(3661999),"01:01:01");
assert.equal(elapsedLabel(-1),"00:00:00");
console.log("Control Center phase and elapsed time tests passed");
