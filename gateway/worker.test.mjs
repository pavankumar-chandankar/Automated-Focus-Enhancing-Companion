import test from "node:test";
import assert from "node:assert/strict";
import worker, {normalize,nextQuota} from "./worker.mjs";
const body = {model:"openai/gpt-oss-120b",stream:false,reasoning_effort:"low",include_reasoning:false,
  max_completion_tokens:512,temperature:0.55,messages:[{role:"system",content:"Oplyra"},{role:"user",content:"Hello"}]};
test("accept bounded chat and OCR variants; reject arbitrary upstream parameters",()=>{
  assert.deepEqual(normalize(body),body);
  assert.doesNotThrow(()=>normalize({...body,max_completion_tokens:256,temperature:0.1}));
  for (const bad of [{...body,model:"other"},{...body,tools:[]},{...body,stream:true},
    {...body,max_completion_tokens:999},{...body,messages:[{role:"tool",content:"x"}]},
    {...body,messages:[...body.messages,{role:"user",content:"x".repeat(5001)}]}]) {
    assert.throws(()=>normalize(bad));
  }
});
test("quota resets on minute/day boundaries and caps attempts",()=>{
  let state;
  for(let i=0;i<6;i++) state=nextQuota(state,1000).state;
  assert.equal(nextQuota(state,1000).retry,59);
  state=nextQuota(state,60000).state;
  assert.equal(state.daily,7);
  for(let i=7;i<100;i++) state=nextQuota(state,Math.floor(i/6+1)*60000).state;
  assert.equal(state.daily,100);
  assert.ok(nextQuota(state,1200000).retry);
  assert.equal(nextQuota(state,86400000).state.daily,1);
});
test("reject unauthenticated, malformed and unconfigured requests without quota/upstream",async()=>{
  const env={GROQ_API_KEY:"fake-test-only",OPLYRA_CLIENT_TOKEN:"a".repeat(64)};
  const req=(path,token,method="GET",payload)=>new Request("https://example.test"+path,{
    method,headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:payload});
  assert.equal((await worker.fetch(req("/health","b".repeat(64)),env)).status,401);
  assert.equal((await worker.fetch(req("/health","a".repeat(64)),env)).status,200);
  assert.equal((await worker.fetch(req("/health","a".repeat(64)),{})).status,503);
  assert.equal((await worker.fetch(req("/v1/chat/completions","a".repeat(64),"POST","{}"),env)).status,400);
  assert.equal((await worker.fetch(req("/v1/chat/completions","a".repeat(64),"POST","x".repeat(25000)),env)).status,400);
});
test("quota failure fails closed without upstream",async()=>{
  const env={GROQ_API_KEY:"fake-test-only",OPLYRA_CLIENT_TOKEN:"a".repeat(64),
    QUOTA:{idFromName:()=>1,get:()=>({fetch:async()=>new Response(null,{status:429,headers:{"retry-after":"30"}})})}};
  const response=await worker.fetch(new Request("https://example.test/v1/chat/completions",{
    method:"POST",headers:{authorization:"Bearer "+"a".repeat(64),"content-type":"application/json"},body:JSON.stringify(body)}),env);
  assert.equal(response.status,429);assert.equal(response.headers.get("retry-after"),"30");
});

test("quota exceptions are distinguishable from upstream exceptions",async()=>{
  const makeRequest=()=>new Request("https://example.test/v1/chat/completions",{
    method:"POST",headers:{authorization:"Bearer "+"a".repeat(64),"content-type":"application/json"},body:JSON.stringify(body)});
  const env={GROQ_API_KEY:"fake-test-only",OPLYRA_CLIENT_TOKEN:"a".repeat(64),
    QUOTA:{idFromName:()=>1,get:()=>({fetch:async()=>{throw new Error("private diagnostic");}})}};
  let result=await worker.fetch(makeRequest(),env);
  assert.equal(result.status,503); assert.deepEqual(await result.json(),{status:"quota_unavailable"});
  env.QUOTA.get=()=>({fetch:async()=>new Response(null,{status:200})});
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>{throw new Error("private network error")};
    result=await worker.fetch(makeRequest(),env);
    assert.equal(result.status,503); assert.deepEqual(await result.json(),{status:"provider_connection"});
    globalThis.fetch=async()=>new Response("private response",{status:401});
    result=await worker.fetch(makeRequest(),env);
    assert.equal(result.status,502); assert.deepEqual(await result.json(),{status:"provider_auth"});
    globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{role:"assistant",content:"Hello"}}]}));
    result=await worker.fetch(makeRequest(),env);
    assert.equal(result.status,200);
    assert.equal((await result.json()).choices[0].message.content,"Hello");
  } finally {globalThis.fetch=original;}
});

test("Workers-compatible redirect handling rejects redirects without forwarding the key",async()=>{
  const env={GROQ_API_KEY:"fake-test-only",OPLYRA_CLIENT_TOKEN:"a".repeat(64),
    QUOTA:{idFromName:()=>1,get:()=>({fetch:async()=>new Response(null,{status:200})})}};
  const request=()=>new Request("https://example.test/v1/chat/completions",{
    method:"POST",headers:{authorization:"Bearer "+"a".repeat(64),"content-type":"application/json"},body:JSON.stringify(body)});
  const original=globalThis.fetch;
  let calls=0;
  try {
    globalThis.fetch=async(url,init)=>{
      calls++;
      // Simulate the documented Workers runtime restriction.
      if(init.redirect !== "manual") throw new TypeError("Unsupported redirect mode");
      assert.equal(url,"https://api.groq.com/openai/v1/chat/completions");
      assert.equal(init.headers.authorization,"Bearer fake-test-only");
      return new Response(null,{status:302,headers:{location:"https://other.example/"}});
    };
    const result=await worker.fetch(request(),env);
    assert.equal(result.status,502);
    assert.deepEqual(await result.json(),{status:"provider_error"});
    assert.equal(calls,1);
    globalThis.fetch=async(url,init)=>{
      if(init.redirect !== "manual") throw new TypeError("Unsupported redirect mode");
      return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{role:"assistant",content:"Hello"}}]}));
    };
    const success=await worker.fetch(request(),env);
    assert.equal(success.status,200);
    assert.equal((await success.json()).choices[0].message.content,"Hello");
  } finally {globalThis.fetch=original;}
});
