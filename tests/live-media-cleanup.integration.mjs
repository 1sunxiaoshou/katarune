import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'vite';
import { pathToFileURL } from 'node:url';
const output=resolve('.test-dist/live-cleanup'); await mkdir(output,{recursive:true});
await build({configFile:false,logLevel:'error',build:{ssr:resolve('src/main/live/media.ts'),outDir:join(output,'module'),emptyOutDir:false,rollupOptions:{output:{entryFileNames:'media.mjs'}}}});
const {LiveMedia}=await import(pathToFileURL(join(output,'module/media.mjs')).href);
const tools=resolve('resources/live-media'), port=19436, config=join(output,'mediamtx.yml');
await writeFile(config,`logLevel: error\nrtmp: true\nrtmpAddress: 127.0.0.1:${port}\nrtsp: false\nhls: false\nwebrtc: false\nsrt: false\nmoq: false\npaths:\n  katarune/live:\n    source: publisher\n`);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const run=promisify(execFile);
async function children(pid){ return JSON.parse((await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`@(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${pid}' | Select-Object ProcessId,Name) | ConvertTo-Json -Compress`],{windowsHide:true,timeout:10000})).stdout||'[]'); }
function alive(pid){ try{process.kill(pid,0);return true;}catch{return false;} }
async function until(predicate,label){const end=Date.now()+10000;while(!await predicate()){assert.ok(Date.now()<end,label);await delay(50);}}
function listening(){return new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();resolve(true)});socket.once('error',()=>resolve(false));});}
const media=new LiveMedia(tools,output);
const occupied=createServer();await new Promise(resolve=>occupied.listen(port,'127.0.0.1',resolve));
await assert.rejects(media.preflight({port},new AbortController().signal),/端口已被占用/);
assert.ok(occupied.listening);await new Promise(resolve=>occupied.close(resolve));
for(const mode of ['control-eof','kill-supervisor','kill-encoder']){
 const child=spawn(join(tools,'media-supervisor.exe'),[join(tools,'mediamtx.exe'),config,join(tools,'ffmpeg.exe'),'-nostdin','-hide_banner','-loglevel','error','-re','-f','lavfi','-i','color=size=64x64:rate=1','-f','null','-'],{windowsHide:true,stdio:'pipe'});
 child.stdout.resume();child.stderr.resume();
 let owned=[];
 try{
  await until(listening,'Supervisor did not open the local listener');
  await delay(500);owned=(await children(child.pid)).filter(process=>['ffmpeg.exe','mediamtx.exe'].includes(process.Name));
  assert.equal(owned.length,2);assert.ok(owned.some(process=>process.Name==='ffmpeg.exe'));assert.ok(owned.some(process=>process.Name==='mediamtx.exe'));
  if(mode==='control-eof')child.stdin.end();
  else if(mode==='kill-supervisor')child.kill();
  else process.kill(owned.find(process=>process.Name==='ffmpeg.exe').ProcessId);
  await until(()=>!alive(child.pid),'Supervisor remained alive');
  await until(()=>owned.every(process=>!alive(process.ProcessId)),'Owned media children remained alive');
  await until(async()=>!await listening(),'Owned RTMP listener remained open');
  console.log(`Media cleanup passed: ${mode}`);
 }finally{child.stdin.end();if(alive(child.pid))child.kill();}
}
const hostProgram=`import {spawn} from 'node:child_process'; const input=JSON.parse(process.argv[1]); const child=spawn(input.file,input.args,{windowsHide:true,stdio:'pipe'}); child.stdout.resume();child.stderr.resume();process.stdout.write(JSON.stringify({pid:child.pid})+'\\n');process.stdin.resume();`;
const host=spawn(process.execPath,['--input-type=module','-e',hostProgram,JSON.stringify({file:join(tools,'media-supervisor.exe'),args:[join(tools,'mediamtx.exe'),config,join(tools,'ffmpeg.exe'),'-nostdin','-hide_banner','-loglevel','error','-re','-f','lavfi','-i','color=size=64x64:rate=1','-f','null','-']})],{windowsHide:true,stdio:'pipe'});
let supervisor;
try{
 let reply='';host.stdout.on('data',data=>{reply+=data});host.stderr.resume();
 await until(()=>reply.includes('\n'),'Host did not report its supervisor');supervisor=JSON.parse(reply.trim()).pid;
 await until(listening,'Host media service did not listen');await delay(500);
 const owned=(await children(supervisor)).filter(process=>['ffmpeg.exe','mediamtx.exe'].includes(process.Name));assert.equal(owned.length,2);
 host.kill();await until(()=>!alive(supervisor),'Supervisor survived abrupt host termination');
 await until(()=>owned.every(process=>!alive(process.ProcessId)),'Media children survived abrupt host termination');
 await until(async()=>!await listening(),'Listener survived abrupt host termination');
 console.log('Media cleanup passed: abrupt host termination');
}finally{if(alive(host.pid))host.kill();if(supervisor&&alive(supervisor))process.kill(supervisor);}
console.log('Occupied port preserved; all tested termination paths released owned media processes and ports.');
