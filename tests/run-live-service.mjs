import { build } from 'vite';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import electronPath from 'electron';
const output=resolve('.test-dist/live-service');
const player=process.argv.includes('--player');
const packaged=process.argv.includes('--packaged');
const entry=player?'live-player.integration':'live-service.integration';
await build({configFile:false,build:{ssr:resolve(`tests/${entry}.ts`),outDir:output,emptyOutDir:true}});
const environment={...process.env};
if(packaged){
 environment.KATARUNE_LIVE_PLAYER=resolve('dist/win-unpacked/resources/avatar/KataruneAvatar.exe');
 environment.KATARUNE_LIVE_TOOLS=resolve('dist/win-unpacked/resources/live-media');
 environment.PATH=join(process.env.SystemRoot??'C:/Windows','System32');
}
const result=spawnSync(electronPath,[join(output,`${entry}.js`)],{stdio:'inherit',windowsHide:true,timeout:process.env.KATARUNE_LIVE_DANCE==='1'?360000:90000,env:environment});
process.exitCode=result.status??1;
