import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {mkdir,copyFile,access,readFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'vite';
const output=resolve('.test-dist/live-startup'), tools=resolve('resources/live-media'), fixtureTools=join(output,'tools');
await mkdir(fixtureTools,{recursive:true});
await build({configFile:false,logLevel:'error',build:{ssr:resolve('src/main/live/media.ts'),outDir:join(output,'module'),emptyOutDir:false,rollupOptions:{output:{entryFileNames:'media.mjs'}}}});
const {LiveMedia}=await import(pathToFileURL(join(output,'module/media.mjs')).href);
const fixtureSource=resolve('tests/fixtures/live-media-process.cs');
const fixtureHash=createHash('sha256').update(await readFile(fixtureSource)).digest('hex');
const run=promisify(execFile), fixture=join(output,`fixture-${fixtureHash}.exe`);
try { await access(fixture); } catch {
  const quote=value=>`'${value.replaceAll("'","''")}'`;
  await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Add-Type -Path ${quote(fixtureSource)} -OutputAssembly ${quote(fixture)} -OutputType ConsoleApplication -ErrorAction Stop`],{windowsHide:true,timeout:20000});
}
await copyFile(fixture,join(fixtureTools,'ffmpeg.exe'));
await copyFile(fixture,join(fixtureTools,'mediamtx.exe'));
for(const name of ['media-supervisor.exe','manifest.json']) await copyFile(join(tools,name),join(fixtureTools,name));
process.env.KATARUNE_MEDIA_TEST_SERVER=join(tools,'mediamtx.exe');
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
async function until(predicate){const deadline=Date.now()+5000;while(!await predicate()){assert.ok(Date.now()<deadline,'Expected media state was not reached');await delay(25);}}
async function freePort(){const server=createServer();await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok)});const port=server.address().port;await new Promise(ok=>server.close(ok));return port;}
async function released(port){const server=createServer();await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok)});await new Promise(ok=>server.close(ok));}
async function mediaCase(mode,check){
  process.env.KATARUNE_MEDIA_TEST_MODE=mode;
  const settings={width:1920,aspectRatio:'16:9',port:await freePort()}, controller=new AbortController();
  let logs='',previews=0; const failures=[];
  const media=new LiveMedia(fixtureTools,join(output,mode),value=>{logs+=value});
  media.onPreview=()=>{previews++}; media.onFailure=error=>failures.push(error);
  try {
    await media.preflight(settings,controller.signal);
    await check({media,settings,controller,logs:()=>logs,previews:()=>previews,failures});
  } finally { controller.abort();await media.stop();await released(settings.port); }
}
await mediaCase('server-delay',async({media,settings,controller,previews,failures})=>{
  const start=Date.now();await media.start(settings,'synthetic',controller.signal);
  assert.ok(Date.now()-start>=2000);assert.equal(previews(),1);assert.deepEqual(failures,[]);
  const first=media.stop(),second=media.stop();assert.equal(first,second);await first;
  await released(settings.port);
});
for(const [mode,processName,code,stage] of [['server-exit','server',17,'server-start'],['encoder-exit','encoder',23,'output']]){
  await mediaCase(mode,async({media,settings,controller})=>{
    await assert.rejects(media.start(settings,'synthetic',controller.signal),error=>{
      assert.deepEqual(error.context,{mediaStage:stage,mediaProcess:processName,exitCode:code,durationMs:error.context.durationMs});return true;
    });
  });
}
await mediaCase('server-hang',async({media,settings,controller,logs,failures})=>{
  const attempt=media.start(settings,'synthetic',controller.signal);
  const rejected=assert.rejects(attempt,/取消/);await delay(300);controller.abort();await rejected;
  assert.ok(!logs().includes('"event":"started"'));assert.deepEqual(failures,[]);
});
await mediaCase('server-hang',async({media,settings,controller,logs})=>{
  await assert.rejects(media.start(settings,'synthetic',controller.signal),error=>{
    assert.match(error.message,/服务启动超时/);assert.equal(error.context.mediaProcess,'server');assert.equal(error.context.mediaStage,'server-start');return true;
  });
  assert.ok(!logs().includes('"event":"started"'));
});
await mediaCase('normal',async({media,settings,controller})=>{
  const encoder=join(fixtureTools,'ffmpeg.exe'), temporarilyMissing=join(fixtureTools,'ffmpeg-hidden.exe');
  await rename(encoder,temporarilyMissing);
  try {
    await assert.rejects(media.start(settings,'synthetic',controller.signal),error=>{
      assert.equal(error.context.mediaStage,'encoder-start');assert.equal(error.context.mediaProcess,'encoder');assert.equal(error.context.nativeError,2);return true;
    });
  } finally { await rename(temporarilyMissing,encoder); }
});
for(const mode of ['progress-only','preview-only']){
  await mediaCase(mode,async({media,settings,controller,logs,previews})=>{
    let ready=false;const attempt=media.start(settings,'synthetic',controller.signal).then(()=>{ready=true});
    const rejected=assert.rejects(attempt,/取消/);
    await until(()=>mode==='progress-only'?logs().includes('out_time_us=3000000'):previews()>0);
    await delay(100);assert.equal(ready,false);controller.abort();await rejected;
  });
}
await mediaCase('delayed-preview',async({media,settings,controller,logs})=>{
  let ready=false;const attempt=media.start(settings,'synthetic',controller.signal).then(()=>{ready=true});
  await until(()=>logs().includes('out_time_us=3000000'));assert.equal(ready,false);await attempt;assert.equal(ready,true);
  await media.stop();await released(settings.port);
  await media.start(settings,'synthetic-again',controller.signal);await media.stop();
});
await mediaCase('encoder-runtime-exit',async({media,settings,controller,failures})=>{
  await media.start(settings,'synthetic',controller.signal);
  await until(()=>failures.length===1);
  assert.equal(failures[0].context.mediaProcess,'encoder');assert.equal(failures[0].context.exitCode,23);assert.equal(failures[0].context.mediaStage,'output');
  await media.stop();assert.equal(failures.length,1);
});
await mediaCase('normal',async({media,settings,controller,logs})=>{
  // A port taken after preflight must fail the owned service, even though TCP connects.
  const occupied=createServer();await new Promise(ok=>occupied.listen(settings.port,'127.0.0.1',ok));
  try {
    await assert.rejects(media.start(settings,'synthetic',controller.signal),error=>error.context.mediaProcess==='server');
    assert.equal(occupied.listening,true);assert.ok(!logs().includes('"event":"started"'));
  } finally { await new Promise(ok=>occupied.close(ok)); }
});
delete process.env.KATARUNE_MEDIA_TEST_MODE;delete process.env.KATARUNE_MEDIA_TEST_SERVER;
console.log('Media startup passed: delayed owned listener, child exit attribution, cancellation, readiness timeout, native launch error, preview/progress gating, concurrent stop, immediate restart and post-preflight port conflict.');
