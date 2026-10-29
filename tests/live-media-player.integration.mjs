import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile, appendFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const output=resolve('.test-dist/live-media-optimized'); await mkdir(output,{recursive:true});
await build({configFile:false,logLevel:'error',build:{ssr:resolve('src/main/live/media.ts'),outDir:join(output,'module'),emptyOutDir:false,rollupOptions:{output:{entryFileNames:'media.mjs'}}}});
const {LiveMedia}=await import(pathToFileURL(join(output,'module/media.mjs')).href);
const tools=resolve('resources/live-media'), ffmpeg=join(tools,'ffmpeg.exe'), ffprobe=join(tools,'ffprobe.exe');
const executable=resolve('unity/KataruneAvatar/Builds/Windows/KataruneAvatar.exe');
const control=`katarune-live-control-${randomUUID()}`, pipe=`katarune-live-${randomUUID()}`;
const width=Number(process.env.KATARUNE_LIVE_WIDTH??1920);
const settings={characterId:null,instructions:'',replyIntervalSeconds:15,proactive:true,idleSeconds:60,thankGifts:true,background:'immersive',backgroundColor:'#202020',camera:'center',subtitles:true,voiceVolume:1,musicVolume:1,width,port:19435,pipe};
const messages=[]; let socket, child, playerFailure; let previews=0;
const server=createServer(connection=>{
  socket=connection; connection.setEncoding('utf8'); let buffer='';
  connection.on('data',data=>{buffer+=data; let end; while((end=buffer.indexOf('\n'))>=0){messages.push(JSON.parse(buffer.slice(0,end)));buffer=buffer.slice(end+1);}});
});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label,timeout=30000){ const deadline=Date.now()+timeout; while(!predicate()){ if(playerFailure) throw playerFailure; assert.ok(Date.now()<deadline,label+': '+JSON.stringify(messages.slice(-2))); await delay(25); } }
async function command(operation,value='',extras={}) { const id=randomUUID(); socket.write(JSON.stringify({id,operation,value,...extras})+'\n'); const terminal=message=>message.id===id && (operation==='speech' ? message.type==='speech'&&['completed','failed'].includes(message.status) : message.type==='result'); await until(()=>messages.some(terminal),operation); const reply=messages.find(terminal); assert.ok(operation==='speech'?reply.status==='completed':reply.ok,reply.error); return reply; }
await writeFile(join(output,'encoder.log'),'');
const media=new LiveMedia(tools,join(output,'runtime'),value=>{void appendFile(join(output,'encoder.log'),value);});
const previewChunks=[];
media.onPreview=frame=>{previews++; if(!previewChunks.length)previewChunks.push(frame.initialization);if(previewChunks.length<40)previewChunks.push(frame.fragment);};
media.onFailure=error=>{playerFailure=error;};
const lifetime=new AbortController();
async function measureCapture(capture, name) {
  const audioFile=join(output,`${name}.f32`), markerFile=join(output,`${name}.gray`);
  await promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',capture,'-vn','-f','f32le','-ac','1','-ar','48000',audioFile],{timeout:10000,windowsHide:true});
  const pcm=await readFile(audioFile); let peak=0;for(let i=0;i<pcm.length;i+=4)peak=Math.max(peak,Math.abs(pcm.readFloatLE(i)));
  assert.ok(peak>.02,`RTMP audio unexpectedly silent (${peak})`);
  await promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',capture,'-an','-vf','crop=32:24:iw-40:8,scale=1:1,format=gray','-fps_mode','passthrough','-f','rawvideo',markerFile],{timeout:10000,windowsHide:true});
  const recorded=JSON.parse((await promisify(execFile)(ffprobe,['-v','error','-show_streams','-of','json',capture],{timeout:10000,windowsHide:true})).stdout).streams;
  const audioStart=Number(recorded.find(stream=>stream.codec_type==='audio').start_time);
  const frameTimes=JSON.parse((await promisify(execFile)(ffprobe,['-v','error','-select_streams','v','-show_entries','frame=best_effort_timestamp_time','-of','json',capture],{timeout:10000,windowsHide:true})).stdout).frames.map(frame=>Number(frame.best_effort_timestamp_time));
  const audioOnsets=[]; let lastAudible=-48000;
  for(let sample=0;sample<pcm.length/4;sample++)if(Math.abs(pcm.readFloatLE(sample*4))>.03){ if(sample-lastAudible>24000) audioOnsets.push(sample/48000+audioStart); lastAudible=sample; }
  const markers=await readFile(markerFile), videoOnsets=[];
  for(let frame=1;frame<markers.length;frame++)if(markers[frame]>220&&markers[frame-1]<160)videoOnsets.push(frameTimes[frame]);
  // Exclude the receiver's initial keyframe/audio boundary; measure steady playback.
  const offsets=audioOnsets.filter(time=>time>audioStart+1&&time<audioStart+6.5).map(time=>videoOnsets.map(video=>video-time).sort((a,b)=>Math.abs(a)-Math.abs(b))[0]);
  assert.ok(offsets.length>=3&&offsets.every(offset=>Number.isFinite(offset)&&Math.abs(offset)<=.05),`Audio/video pulse offsets: ${JSON.stringify({audioOnsets,videoOnsets,offsets})}`);
  return {audioPeak:peak,syncMaxMs:Math.round(Math.max(...offsets.map(Math.abs))*1000),offsetsMs:offsets.map(offset=>Math.round(offset*1000))};
}
try {
  await media.preflight(settings,lifetime.signal);
  await new Promise(resolve=>server.listen(`\\\\.\\pipe\\${control}`,resolve));
  child=spawn(executable,['-force-d3d11','-force-d3d11-bitblt-model','-screen-fullscreen','1','-window-mode','borderless','-logFile',join(output,'player.log'),'--exit-on-error'],{cwd:dirname(executable),windowsHide:true,stdio:'ignore',env:{...process.env,KATARUNE_AVATAR_PIPE:control,KATARUNE_LIVE_ACCEPTANCE:'1'}});
  child.on('error',error=>{playerFailure=error;}); child.on('exit',code=>{playerFailure=new Error(`Player exited (${code})`);});
  await until(()=>messages.some(message=>message.type==='ready'),'Player readiness',60000);
  await command('live-start',JSON.stringify({...settings,fps:60}));
  await media.start(settings,pipe,lifetime.signal);
  const url=`rtmp://127.0.0.1:${settings.port}/katarune/live`;
  const streams=JSON.parse((await promisify(execFile)(ffprobe,['-v','error','-show_streams','-of','json',url],{timeout:15000,windowsHide:true,maxBuffer:1024*1024})).stdout).streams;
  assert.ok(streams.some(stream=>stream.codec_name==='h264'&&stream.width===width&&stream.height===width*9/16&&stream.r_frame_rate==='60/1'));
  assert.ok(streams.some(stream=>stream.codec_name==='h264'&&stream.color_space==='bt709'&&stream.color_primaries==='bt709'&&stream.color_transfer==='bt709'&&stream.color_range==='tv'),'Missing BT.709 video color metadata');
  assert.ok(streams.some(stream=>stream.codec_name==='aac'&&stream.sample_rate==='48000'&&stream.channels===2));
  const wav=Buffer.alloc(44+48000*2*12); wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
  for(let sample=0;sample<48000*12;sample++)wav.writeInt16LE(Math.round((sample%48000<12000?.2:0)*32767*Math.sin(sample/48000*2*Math.PI*880)),44+sample*2);
  const tone=join(output,'tone.wav');await writeFile(tone,wav);
  const recording=promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',url,'-t','8','-c','copy',join(output,'capture.flv')],{timeout:25000,windowsHide:true});
  const speech=command('speech',tone,{text:'直播音视频测试：中文字幕、口型与声音同步。',segments:[]});
  await Promise.all([recording,speech]);
  await promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',join(output,'capture.flv'),'-ss','3','-frames:v','1',join(output,'frame.png')],{timeout:10000,windowsHide:true});
  const sync=[{stage:'initial',...await measureCapture(join(output,'capture.flv'),'initial')}];
  assert.ok(previews>5,'Preview segments missing');
  await writeFile(join(output,'preview.mp4'),Buffer.concat(previewChunks));
  const duration=Number(process.env.KATARUNE_LIVE_SOAK_SECONDS??0), started=Date.now();
  const memory=[];
  const memorySample=async()=>{
    const script=`$all=Get-CimInstance Win32_Process; $direct=@($all | Where-Object ParentProcessId -eq ${process.pid}); $ids=@($direct.ProcessId)+@($all | Where-Object { $_.ParentProcessId -in $direct.ProcessId } | Select-Object -ExpandProperty ProcessId); Get-Process -Id $ids -ErrorAction SilentlyContinue | Where-Object ProcessName -Match 'KataruneAvatar|ffmpeg|mediamtx|media-supervisor' | Select-Object Id,ProcessName,PrivateMemorySize64,WorkingSet64,HandleCount | ConvertTo-Json -Compress`;
    const result=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:15000});
    memory.push({seconds:Math.floor((Date.now()-started)/1000),processes:JSON.parse(result.stdout||'[]')});
    await writeFile(join(output,'soak-memory.json'),JSON.stringify(memory,null,2));
  };
  if(duration) await memorySample();
  while(Date.now()-started<duration*1000){ await delay(Math.max(1,Math.min(30000,duration*1000-(Date.now()-started)))); assert.ifError(playerFailure); await memorySample(); console.log(`Live media running: ${Math.floor((Date.now()-started)/1000)}s`); }
  if(duration) {
    const capture=join(output,'after-soak.flv');
    await Promise.all([
      promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',url,'-t','8','-c','copy',capture],{timeout:25000,windowsHide:true}),
      command('speech',tone,{text:'持续运行后的音画同步复测。',segments:[]})
    ]);
    sync.push({stage:'after-soak',...await measureCapture(capture,'after-soak')});
  }
  await command('live-stop'); await media.stop();
  assert.equal(playerFailure,undefined);
  const log=await readFile(join(output,'player.log'),'utf8');
  const diagnostics=log.split('\n').filter(line=>line.startsWith('LIVE_ACCEPTANCE'));
  const encoderLog=await readFile(join(output,'encoder.log'),'utf8');
  const sampleRate=Number(encoderLog.match(/Audio: pcm_f32le[^\r\n]*, (\d+) Hz/)?.[1]);
  assert.ok(sampleRate>0,'Raw audio sample rate missing');
  const steady=diagnostics.map(line=>Object.fromEntries([...line.matchAll(/(\w+)=(\d+(?:\.\d+)?)/g)].map(match=>[match[1],Number(match[2])]))).filter(row=>row.samples>=sampleRate*6);
  assert.ok(steady.length>=3,'Steady frame diagnostics missing');
  const first=steady[0],last=steady.at(-1),seconds=(last.samples-first.samples)/sampleRate;
  const written=last.written-first.written,repeated=last.repeated-first.repeated;
  const frames={seconds:Math.round(seconds),freshFps:Number(((written-repeated)/seconds).toFixed(2)),outputFps:Number((written/seconds).toFixed(2)),repeated,repeatedPercent:Number((repeated/written*100).toFixed(2)),dropped:last.dropped-first.dropped};
  const report={video:`h264 ${width}x${width*9/16} 60fps`,audio:'aac 48k stereo',monitor:false,syncMaxMs:Math.max(...sync.map(sample=>sample.syncMaxMs)),sync,frames,previews,soakSeconds:duration,diagnostics};
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,diagnostics:undefined}));
  assert.ok(frames.freshFps>=58&&frames.repeatedPercent<=3,`Steady frame delivery below target: ${JSON.stringify(frames)}`);
} catch(error) {
  const log=await readFile(join(output,'player.log'),'utf8').catch(()=> '');
  console.error(log.split('\n').filter(line=>/Exception|Error|error|直播|Live/.test(line)).slice(-25).join('\n'));
  console.error((await readFile(join(output,'encoder.log'),'utf8').catch(()=> '')).split('\n').slice(-25).join('\n'));
  throw error;
} finally {
  lifetime.abort(); await media.stop(); socket?.destroy(); child?.kill(); await new Promise(resolve=>server.close(resolve));
}
