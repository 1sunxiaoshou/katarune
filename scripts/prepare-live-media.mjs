import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, copyFile, access } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'win32') throw new Error('Live media preparation currently supports Windows x64.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(root, 'resources/live-media-manifest.json'), 'utf8'));
const directory = join(root, 'resources/live-media');
const cache = join(root, '.cache/live-media');
await mkdir(directory, {recursive:true}); await mkdir(cache,{recursive:true});
const quote = text => `'${text.replaceAll("'", "''")}'`;
const powershell = script => execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',script],{stdio:'inherit',windowsHide:true});
async function walk(path) { const files=[]; for(const entry of await readdir(path,{withFileTypes:true})) { const full=join(path,entry.name); if(entry.isDirectory()) files.push(...await walk(full)); else files.push(full); } return files; }
for (const [name, item] of Object.entries(manifest)) {
  const archive=join(cache,`${name}-${item.sha256}.zip`);
  let bytes; try { bytes=await readFile(archive); } catch { const response=await fetch(item.url); if(!response.ok) throw new Error(`${name} download HTTP ${response.status}`); bytes=Buffer.from(await response.arrayBuffer()); }
  if(createHash('sha256').update(bytes).digest('hex')!==item.sha256) throw new Error(`${name} checksum mismatch`);
  await writeFile(archive,bytes);
  const extracted=join(cache,item.sha256); try { await access(extracted); } catch { powershell(`$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(extracted)}`); }
  for(const file of await walk(extracted)) {
    const base=file.split(/[\\/]/).at(-1);
    if (/\.dll$/i.test(base) || /^(ffmpeg|ffprobe|mediamtx)\.exe$/i.test(base)) await copyFile(file,join(directory,base));
    else if(/^(license|copying|readme)(\.|$)/i.test(base)) await copyFile(file,join(directory,`${name}-${base}`));
  }
}
const supervisor=join(directory,'media-supervisor.exe');
// Windows PowerShell compiles against the Windows-provided .NET Framework.
const supervisorSource=join(root,'scripts/live-media-supervisor.cs');
const supervisorHash=createHash('sha256').update(await readFile(supervisorSource)).digest('hex');
const compiled=join(cache,`media-supervisor-${supervisorHash}.exe`);
try { await access(compiled); } catch { powershell(`$ErrorActionPreference='Stop'; Add-Type -Path ${quote(supervisorSource)} -OutputAssembly ${quote(compiled)} -OutputType ConsoleApplication`); }
await copyFile(compiled,supervisor);
await copyFile(supervisorSource,join(directory,'media-supervisor.cs'));
await writeFile(join(directory,'SOURCES.md'),`# Bundled media components\n\nMediaMTX ${manifest.mediamtx.version}: ${manifest.mediamtx.url}\nSource: https://github.com/bluenviron/mediamtx/tree/v${manifest.mediamtx.version}\n\nFFmpeg ${manifest.ffmpeg.version}: ${manifest.ffmpeg.url}\nCorresponding source: https://github.com/FFmpeg/FFmpeg/commit/92611900bb\nBuild recipes: https://github.com/BtbN/FFmpeg-Builds/tree/autobuild-2026-10-27-18-38\nThis is the LGPL shared build; DLLs can be replaced independently. See ffmpeg-LICENSE.txt.\n\nThe Katarune Windows supervisor source is included as media-supervisor.cs.\n`);
await copyFile(join(root,'resources/live-media-manifest.json'),join(directory,'manifest.json'));
const inventory={};
for(const name of await readdir(directory)) if(/\.(exe|dll)$/i.test(name)) inventory[name]=createHash('sha256').update(await readFile(join(directory,name))).digest('hex');
await writeFile(join(directory,'checksums.json'),JSON.stringify(inventory,null,2)+'\n');
execFileSync(join(directory,'ffmpeg.exe'),['-hide_banner','-loglevel','error','-f','lavfi','-i','color=size=1280x720:rate=30','-t','0.2','-an','-c:v','h264_mf','-f','null','-'],{stdio:'inherit',windowsHide:true});
console.log('Live media verified: pinned FFmpeg, MediaMTX, Windows job supervisor.');
