import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeModels, curateModels, migrateSettings, selectModel, handoverSummary } from '../lib/models.mjs';
import { createDeckTools, renderedImagePath } from '../lib/agent-tools.mjs';
import { CodexSession } from '../lib/codex.mjs';

const claude = normalizeModels('claude', [{ value: 'sonnet', displayName: 'Sonnet', supportedEffortLevels: ['low','high'] }, {value:'haiku'}, {value:'locked',available:false}, {value:'hidden',hidden:true}]);
const codex = normalizeModels('codex', [{ model:'gpt-test',supportedReasoningEfforts:[{reasoningEffort:'medium'}],defaultReasoningEffort:'medium',isDefault:true }]);
const catalog = {claude:{models:claude},codex:{models:codex}};
test('discovery filters unavailable models and preserves provider effort capabilities',()=>{
 assert.deepEqual(claude.map(m=>m.id),['sonnet','haiku']);assert.deepEqual(claude[1].efforts,[]);
 assert.deepEqual(selectModel(catalog,{provider:'claude',model:'sonnet',effort:'high'},{provider:'codex'}),{provider:'codex',model:'gpt-test',effort:'medium'});
 assert.equal(selectModel(catalog,{provider:'claude',model:'sonnet',effort:'high'},{model:'haiku'}).effort,null);
 assert.throws(()=>selectModel(catalog,{provider:'claude',model:'sonnet',effort:'high'},{provider:'codex',effort:'max'}),/support/);
 assert.throws(()=>selectModel(catalog,{provider:'claude',model:'sonnet'},{model:'locked'}),/available/);
});
test('a provider without a chosen model gets its default model',()=>{
 const catalog={codex:{models:[{id:'a',efforts:['low'],defaultEffort:'low'},{id:'b',efforts:[],defaultEffort:null,isDefault:true}]}};
 assert.deepEqual(selectModel(catalog,{provider:'codex',model:'',effort:null},{}),{provider:'codex',model:'b',effort:null});
});
test('legacy settings migrate to Claude without losing model and effort',()=>{
 assert.deepEqual(migrateSettings({model:'opus',effort:'high'}),{provider:'claude',model:'opus',effort:'high'});
});
test('handover excludes tools and stays bounded',()=>{
 const summary=handoverSummary([{kind:'tool',text:'SECRET TOOL OUTPUT'},...Array.from({length:100},(_,i)=>({kind:'user',text:`Request ${i}: `+'x'.repeat(3000)}))]);
 assert(!summary.includes('SECRET'));assert(summary.length<16500);assert(summary.includes('Request 99'));
});
test('bridge rejects outside files, linked files, locked edits and arbitrary commands',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pindeck-tools-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const deck=path.join(root,'deck');fs.mkdirSync(deck);fs.writeFileSync(path.join(root,'secret.txt'),'secret');
 fs.writeFileSync(path.join(deck,'index.html'),'<h1>Before</h1>');fs.writeFileSync(path.join(deck,'brand.css'),'locked');
 const tools=createDeckTools({deckDir:deck,cliFile:'/unused',env:{}});
 await assert.rejects(tools('pindeck_read',{path:'../secret.txt'}),/outside/);
 fs.symlinkSync(path.join(root,'secret.txt'),path.join(deck,'linked.txt'));
 await assert.rejects(tools('pindeck_read',{path:'linked.txt'}),/outside/);
 await assert.rejects(tools('pindeck_edit',{path:'brand.css',oldText:'locked',newText:'oops'}),/locked/);
 await assert.rejects(tools('pindeck_command',{command:'git-setup',args:[]}),/Invalid/);
 await assert.rejects(tools('pindeck_command',{command:'bash',args:['-c','touch pwned']}),/Invalid/);
 await tools('pindeck_edit',{path:'index.html',oldText:'Before',newText:'After $&'});
 assert.equal(fs.readFileSync(path.join(deck,'index.html'),'utf8'),'<h1>After $&</h1>');
 await assert.rejects(tools('pindeck_edit',{path:'index.html',oldText:'missing',newText:'oops'}),/exactly once/);
 fs.linkSync(path.join(root,'secret.txt'),path.join(deck,'theme.css'));
 await assert.rejects(tools('pindeck_edit',{path:'theme.css',oldText:'secret',newText:'oops'}),/Linked/);
 const abort=new AbortController();abort.abort();
 await assert.rejects(tools('pindeck_edit',{path:'index.html',oldText:'After',newText:'oops'},abort.signal));
 assert.equal(fs.readFileSync(path.join(deck,'brand.css'),'utf8'),'locked');
});
test('bridge edits and creates other deck files, never locked paths or files outside the deck',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pindeck-tools-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const deck=path.join(root,'deck'),shared=path.join(root,'shared');fs.mkdirSync(deck);fs.mkdirSync(shared);
 fs.writeFileSync(path.join(deck,'talk.html'),'<h1>Talk</h1>');fs.writeFileSync(path.join(deck,'other.html'),'<h1>Other</h1>');
 fs.writeFileSync(path.join(deck,'deck.js'),'const a = 1;');fs.mkdirSync(path.join(deck,'vendor'));fs.writeFileSync(path.join(deck,'vendor/lib.js'),'lib');
 fs.writeFileSync(path.join(shared,'style.css'),'shared');
 let origin='http://before';
 const tools=createDeckTools({deckDir:deck,readDirs:[shared],cliFile:'/unused',env:()=>({DECK_EDITOR_URL:origin}),
  locked:()=>['brand.css','vendor/**','.git/**','other.html']});
 await tools('pindeck_edit',{path:'deck.js',oldText:'1',newText:'2'});
 assert.equal(fs.readFileSync(path.join(deck,'deck.js'),'utf8'),'const a = 2;');
 await tools('pindeck_write',{path:'notes/outline.md',content:'# Outline'});
 assert.equal(fs.readFileSync(path.join(deck,'notes/outline.md'),'utf8'),'# Outline');
 await assert.rejects(tools('pindeck_write',{path:'brand.css',content:'oops'}),/locked/);
 await assert.rejects(tools('pindeck_edit',{path:'vendor/lib.js',oldText:'lib',newText:'oops'}),/locked/);
 await assert.rejects(tools('pindeck_write',{path:'vendor/new.js',content:'oops'}),/locked/);
 await assert.rejects(tools('pindeck_write',{path:'.git/config',content:'oops'}),/locked/);
 await assert.rejects(tools('pindeck_edit',{path:'other.html',oldText:'Other',newText:'oops'}),/locked/);
 // asset roots can be read, not written
 assert.match((await tools('pindeck_read',{path:'../shared/style.css'}))[0].text,/shared/);
 await assert.rejects(tools('pindeck_write',{path:'../shared/style.css',content:'oops'}),/inside the deck/);
 // a folder that links out of the deck cannot be written through
 fs.symlinkSync(shared,path.join(deck,'linked'));
 await assert.rejects(tools('pindeck_write',{path:'linked/new.css',content:'oops'}),/symlink/);
 assert.equal(fs.existsSync(path.join(shared,'new.css')),false);
 assert.equal(fs.readFileSync(path.join(shared,'style.css'),'utf8'),'shared');
 assert.deepEqual(fs.readdirSync(deck).filter(f=>f.includes('.pindeck-')),[]);   // no temporary files left behind
});
test('Codex rejects stale tool calls, declines native approvals and finalizes a turn once',async()=>{
 const replies=[],events=[];let calls=0;
 const s=new CodexSession({onEvent:e=>events.push(e),tools:async()=>{calls++;return[];}});
 s.transport={closed:false,write:m=>replies.push(m)};s.sessionId='thread';s.turnId='new';s.controller=new AbortController();
 await s.message({id:1,method:'item/tool/call',params:{threadId:'thread',turnId:'old',tool:'pindeck_edit',arguments:{}}});
 assert.equal(calls,0);assert.equal(replies[0].result.success,false);
 await s.message({id:2,method:'item/fileChange/requestApproval',params:{threadId:'thread',turnId:'new'}});
 assert.equal(replies[1].result.decision,'decline');
 await s.message({method:'turn/completed',params:{threadId:'thread',turn:{id:'new',status:'completed'}}});
 await s.message({method:'turn/completed',params:{threadId:'thread',turn:{id:'new',status:'completed'}}});
 assert.equal(events.length,1);
});

test('PDF renderer output preserves image paths containing spaces',()=>{
 assert.equal(renderedImagePath('/tmp/some directory/page.png (1600 × 1200 px). Read it; add a figures/ name to save it into the deck.'),'/tmp/some directory/page.png');
 assert.equal(renderedImagePath('unrelated output'),undefined);
});

test('late completion of an old Codex turn does not finish a new turn',async()=>{
 const events=[];const s=new CodexSession({onEvent:e=>events.push(e)});
 s.sessionId='thread';s.turnId='new';s.controller=new AbortController();
 await s.message({method:'turn/completed',params:{threadId:'thread',turn:{id:'old',status:'completed'}}});
 assert.equal(events.length,0);assert.equal(s.controller.signal.aborted,false);assert.equal(s.turnId,'new');
});

test('process startup failures and timeouts reject pending requests once',async()=>{
 const {AgentProcess}=await import('../lib/agent-process.mjs');let exits=0;
 const missing=new AgentProcess({binary:'/no-such-pindeck-agent',args:[],onExit:()=>exits++});
 await assert.rejects(missing.request('initialize',{}),/ENOENT/);missing.stop();assert.equal(exits,1);
 const idle=new AgentProcess({binary:process.execPath,args:['-e','process.stdin.resume()']});
 await assert.rejects(idle.request('initialize',{}, {timeout:20}),/timed out/);idle.stop();assert.equal(idle.pending.size,0);
});

test('curated picker keeps GPT-6 variants and the newest available Claude family entries', () => {
 const codex = normalizeModels('codex', ['gpt-5.6-sol', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-60', 'gpt-7'].map(model => ({model})));
 assert.deepEqual(curateModels('codex', codex).filter(m => m.curated).map(m => m.id), ['gpt-6-sol','gpt-6.1-sol','gpt-6-astra']);
 const claude = normalizeModels('claude', [
  {value:'default',displayName:'Default (recommended)'},
  {value:'opus',displayName:'Opus 5.5'}, {value:'claude-opus-5-5',displayName:'Opus 5.5'},
  {value:'claude-opus-5-10',displayName:'Opus 5.10'},
  {value:'fable',displayName:'Fable 5.1'}, {value:'claude-fable-5',displayName:'Fable 5'},
  {value:'sonnet',displayName:'Sonnet 5.5'}, {value:'claude-sonnet-5-5',displayName:'Sonnet 5.5'},
  {value:'claude-haiku-4-5-20251001'}, {value:'claude-haiku-4-20250101'},
  {value:'claude-haiku-9',available:false}, {value:'claude-opus-9',hidden:true}
 ]);
 const curated = curateModels('claude', claude);
 assert.deepEqual(curated.filter(m => m.curated).map(m => m.id), ['claude-opus-5-10','fable','sonnet','claude-haiku-4-5-20251001']);
 assert.equal(curated.length, claude.length); // Filtering never destroys the full available catalog.
 assert.equal(selectModel({claude:{models:curated}}, {provider:'claude',model:'opus',effort:null}, {}).model, 'opus');
 assert.deepEqual(curateModels('claude', []), []);
 assert.equal(curateModels('claude', [{id:'haiku',label:'Haiku'}])[0].curated, true);
});

test('picker toggle preserves the active older model, efforts and browser preference', async () => {
 const vm = await import('node:vm');
 const source = fs.readFileSync(new URL('../public/editor.js', import.meta.url), 'utf8');
 const code = source.slice(source.indexOf('let modelCatalog ='), source.indexOf('/* ---- Delete the selected element'));
 const stored = new Map();
 const state = { status: { settings: {provider:'codex',model:'gpt-5.6-sol',effort:'high'}, models: {
  codex: { models: [
   {id:'gpt-5.6-sol',label:'GPT 5.6 Sol',efforts:['high'],curated:false},
   {id:'gpt-5.6-luna',label:'GPT 5.6 Luna',curated:false},
   {id:'gpt-6-sol',label:'GPT 6 Sol',curated:true}
  ]}, claude:{models:[]}
 }}};
 function harness() {
  const elements = {}, listeners = {};
  const ctx = vm.createContext({state, esc:s=>String(s||''), wireMenu(){},
   $: id => elements[id] ||= {addEventListener:(event,fn)=>listeners[id+event]=fn},
   localStorage: {getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)}
  });
  vm.runInContext(code,ctx);vm.runInContext('renderModelMenu()',ctx);
  return {html:()=>elements['model-menu'].innerHTML,toggle:()=>listeners['model-menuclick']({stopPropagation(){},target:{closest:()=>({hasAttribute:key=>key==='data-model-filter'})}})};
 }
 const ui=harness();
 assert.match(ui.html(),/GPT 5.6 Sol \(current\)/);assert.doesNotMatch(ui.html(),/data-effort=/);
 assert.match(ui.html(),/GPT 6 Sol/);assert.doesNotMatch(ui.html(),/GPT 5.6 Luna/);
 await ui.toggle();assert.match(ui.html(),/GPT 5.6 Luna/);assert.equal(stored.get('editor.showAllModels'),'true');
 assert.match(harness().html(),/GPT 5.6 Luna/);
 await ui.toggle();assert.doesNotMatch(ui.html(),/GPT 5.6 Luna/);
 assert.equal(state.status.settings.model,'gpt-5.6-sol');
});

test('effort preferences are scoped to provider and model and validated against discovery', () => {
 const models = normalizeModels('codex', [
  {model:'a',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'ultra',description:'More reasoning'}],defaultReasoningEffort:'low'},
  {model:'b',supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'high'}],defaultReasoningEffort:'medium'}
 ]);
 const c={codex:{models}};const current={provider:'codex',model:'a',effort:'ultra'};
 assert.equal(selectModel(c,current,{model:'b'},{'codex:b':'high'}).effort,'high');
 assert.equal(selectModel(c,current,{model:'b'},{'claude:b':'high'}).effort,'medium');
 assert.equal(selectModel(c,current,{model:'b'},{'codex:b':'ultra'}).effort,'medium');
 assert.equal(selectModel(c,current,{model:'b',effort:'high'},{}).effort,'high');
 assert.equal(selectModel(c,current,{},{}).effort,'ultra');
 assert.equal(models[0].effortDescriptions.ultra,'More reasoning');
 assert.equal(models[0].effortDefaultSource,'provider');
 assert.equal(claude[0].effortDefaultSource,'fallback');
});

test('separate effort menu shows native levels, readable labels, defaults and descriptions', async () => {
 const vm=await import('node:vm');const source=fs.readFileSync(new URL('../public/editor.js',import.meta.url),'utf8');
 const elements={};const state={status:{settings:{provider:'codex',model:'test',effort:'xhigh'},models:{codex:{models:[{
 id:'test',efforts:['low','medium','high','xhigh','max','ultra'],defaultEffort:'medium',effortDefaultSource:'provider',effortDescriptions:{ultra:'Longer reasoning'}
 }]}}}};
 const ctx=vm.createContext({state,esc:s=>s,$:id=>elements[id]||=( {})});
 vm.runInContext(source.slice(source.indexOf('const effortLabel ='),source.indexOf('wireMenu("effort-btn"')),ctx);
 vm.runInContext('renderEffortMenu()',ctx);
 assert.equal(elements.effort.textContent,'Extra high');
 assert.match(elements['effort-menu'].innerHTML,/data-effort="ultra"/);
 assert.match(elements['effort-menu'].innerHTML,/Model default/);
 assert.match(elements['effort-menu'].innerHTML,/Longer reasoning/);
 state.status.busy=true;vm.runInContext('renderEffortMenu()',ctx);assert.equal(elements['effort-btn'].disabled,true);
 state.status.busy=false;state.status.models.codex.models[0].efforts=[];
 vm.runInContext('renderEffortMenu()',ctx);assert.equal(elements['effort-btn'].disabled,true);assert.equal(elements.effort.textContent,'Effort N/A');
});

test('Claude session grants only supported PinDeck helper commands', async () => {
 const vm=await import('node:vm');const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const ctx=vm.createContext({ClaudeSession:class {constructor(options){Object.assign(this,options)}},
  DECK_DIR:'/deck',ORIGIN:'http://localhost',TOKEN:'test',session:null,systemPrompt:'instructions',slidesInstructions:()=>'',deckInstructions:()=>'',
  agentEnv:()=>({}),lockedPaths:()=>['brand.css','vendor/**','.git/**'],
  CLI_CMD:'node /app/cli.mjs',EDITABLE:['index.html','theme.css'],LOCKED:['brand.css']});
 vm.runInContext(source.slice(source.indexOf('function makeSession(choice)'),source.indexOf('async function discoverModels()')),ctx);
 const agent=vm.runInContext('makeSession({provider:"claude",model:"sonnet",effort:"low"})',ctx);
 const all=agent.args(),args=all.slice(all.indexOf('--allowedTools')+1,all.indexOf('--disallowedTools'));
 assert.deepEqual(Array.from(args.filter(a=>a.startsWith('Bash('))),['layout','shot','slides','pdf','pdf-figure'].map(name=>`Bash(node /app/cli.mjs ${name}:*)`));
 assert(!args.includes('Bash(node /app/cli.mjs:*)'));
});
