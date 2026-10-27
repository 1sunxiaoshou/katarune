import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Offline authoring only. Pass a local @napi-rs/canvas module directory when
// using a bundled runtime; the application and Player do not depend on it.
const require = createRequire(import.meta.url);
const moduleIndex = process.argv.indexOf("--canvas-module");
const { createCanvas, loadImage } = require(moduleIndex < 0 ? "@napi-rs/canvas" : process.argv[moduleIndex + 1]);
const output = resolve("unity/KataruneAvatar/Assets/Katarune/Resources/Immersive");
await mkdir(output, { recursive: true });
const accent = "#afce32", dark = "#2c4c01";
const surface = createCanvas;
function rect(g, x, y, w, h, r, color) {
  g.fillStyle = color; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
}
function star(g, x, y, r, color) {
  g.fillStyle = color; g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4 - Math.PI / 2, rr = i % 2 ? r * .34 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath(); g.fill();
}
const letters = new Map();
function glyph(ch) {
  if (letters.has(ch)) return letters.get(ch);
  const el = surface(104, 120), g = el.getContext("2d");
  g.fillStyle = "#fff";
  const outer = () => rect(g, 0, 0, 100, 120, 8, "#fff");
  const cut = (x, y, w, h, r = 1) => {
    g.globalCompositeOperation = "destination-out"; rect(g, x, y, w, h, r, "#000");
    g.globalCompositeOperation = "source-over";
  };
  const polygon = points => {
    g.beginPath(); points.forEach(([x, y]) => g.lineTo(x, y)); g.closePath(); g.fill();
  };
  // Keep the reference's 104x120 heavy geometric alphabet, including its
  // original E/L/N/O/R forms. Additional letters follow the same stroke widths.
  if (ch === "O") { outer(); cut(32, 42, 36, 36, 3); }
  else if (ch === "E") { outer(); cut(36, 34, 69, 12); cut(36, 74, 69, 12); }
  else if (ch === "L") { outer(); cut(34, -3, 70, 87); }
  else if (ch === "N") {
    rect(g, 0, 0, 29, 120, 3, "#fff"); rect(g, 71, 0, 29, 120, 3, "#fff");
    polygon([[18,0],[48,0],[84,120],[54,120]]);
  }
  else if (ch === "R") {
    outer(); cut(30, 29, 40, 21, 2); cut(29, 82, 22, 42);
    g.globalCompositeOperation = "destination-out"; polygon([[68,78],[101,78],[101,120]]);
    g.globalCompositeOperation = "source-over";
  }
  else if (ch === "A") { outer(); cut(32,29,36,24,2); cut(32,85,36,38); }
  else if (ch === "T") { outer(); cut(-3,34,35,90); cut(68,34,35,90); }
  else if (ch === "U") { outer(); cut(32,-3,36,88,2); }
  else if (ch === "D") { outer(); cut(31,32,37,56,3); }
  else if (ch === "I") { outer(); cut(-3,26,35,68); cut(68,26,35,68); }
  else if (ch === "H") { outer(); cut(32,-3,36,46); cut(32,77,36,46); }
  else if (ch === "F") { outer(); cut(36,34,69,12); cut(36,77,69,46); }
  else if (ch === "V") { polygon([[0,0],[33,0],[50,76],[67,0],[100,0],[70,120],[30,120]]); }
  else if (ch === "Y") { polygon([[0,0],[34,0],[50,40],[66,0],[100,0],[67,72],[67,120],[33,120],[33,72]]); }
  else if (ch === "W") {
    polygon([[0,0],[28,0],[34,73],[47,40],[59,40],[71,73],[76,0],[104,0],[91,120],[65,120],[53,89],[40,120],[14,120]]);
  }
  else if (ch === "K") {
    rect(g, 0, 0, 32, 120, 3, "#fff");
    polygon([[30,43],[65,0],[102,0],[57,59],[104,120],[64,120],[30,77]]);
  }
  else throw new Error(`Missing geometric glyph: ${ch}`);
  letters.set(ch, el); return el;
}
function blockText(g, text, x, y, size, color, space = 5) {
  const scale = size / 120, w = (text.length * 104 + (text.length - 1) * space) * scale;
  const el = surface(Math.ceil(w), Math.ceil(size)), t = el.getContext("2d");
  let cursor = 0;
  for (const ch of text) {
    if (ch !== " ") t.drawImage(glyph(ch), cursor, 0, 104 * scale, size);
    cursor += (ch === " " ? 62 : 104 + space) * scale;
  }
  t.globalCompositeOperation = "source-in"; t.fillStyle = color; t.fillRect(0, 0, el.width, el.height);
  g.drawImage(el, x, y);
}
function speech(g, x, y, size, color, bg) {
  g.save(); g.translate(x, y); g.scale(size / 100, size / 100);
  rect(g, -47, -43, 94, 82, 23, color);
  g.fillStyle = color; g.beginPath(); g.moveTo(-26, 30); g.lineTo(-35, 56); g.lineTo(0, 35); g.closePath(); g.fill();
  star(g, 0, -2, 25, bg); g.restore();
}
function makeFilm(colored) {
  // Dimensions, placement, rounded corners and visual mass match the HTML.
  const el = surface(202, 1080), g = el.getContext("2d");
  g.fillStyle = colored ? dark : "#050505"; g.fillRect(0, 0, 202, 1080);
  if (!colored) {
    for (let y = 7; y < 1080; y += 30) { rect(g,5,y,15,21,3,"#2a2a2a"); rect(g,182,y,15,21,3,"#2a2a2a"); }
    for (let y = 0; y < 1080; y += 180) { rect(g,25,y+5,152,170,8,"#292929"); rect(g,31,y+11,140,158,6,"#020202"); }
    return el;
  }
  rect(g,13,18,176,392,17,accent);
  g.save(); g.translate(101,214); g.rotate(Math.PI / 2);
  blockText(g,"YOU",-174,-66,54,dark,4); speech(g,86,6,145,dark,accent);
  g.fillStyle = dark; g.font = "700 7px Arial"; g.fillText("KATARUNE  /  SHARED STORIES",-173,45);
  g.font = "700 6px Arial"; g.fillText("TELL A STORY  //  KEEP A MEMORY",-173,56); g.restore();
  g.save(); g.translate(101,492); g.rotate(Math.PI);
  blockText(g,"OUR",-75,-40,48,accent,0); blockText(g,"DAY",-75,12,48,accent,0); g.restore();
  // Paired memory seals replace the record motif, retaining the original
  // two 72px silhouettes and dark edge between overlapping shapes.
  for (const y of [649,779]) {
    g.beginPath(); g.arc(101,y,72,0,Math.PI*2); g.fillStyle=accent; g.fill();
    g.strokeStyle=dark; g.lineWidth=4; g.stroke(); star(g,101,y,34,dark);
    g.beginPath(); g.arc(101,y,6,0,Math.PI*2); g.fillStyle=accent; g.fill();
  }
  g.save(); g.translate(101,946); g.rotate(Math.PI/2);
  blockText(g,"LIVE",-85,-64,51,accent,0); g.font="700 7px Arial"; g.fillStyle=accent;
  g.fillText("SIDE BY SIDE",-80,34); g.restore(); return el;
}
function makeType() {
  const el=surface(3200,1050), g=el.getContext("2d");
  blockText(g,"KATARUNE",0,0,400,"#000",3);
  blockText(g,"OUR WORLD",0,419,151,"#000",2);
  g.fillStyle="#000"; g.font="900 20px Arial";
  g.fillText("A DIGITAL LIFE SHARING YOUR EVERYDAY, REMEMBERING OUR STORIES AND EXPLORING THE WORLD TOGETHER.",0,617);
  g.fillText("FROM A SINGLE CONVERSATION TO A WORLD OF SHARED MEMORIES. STAY CURIOUS. GROW SIDE BY SIDE.",0,644);
  return el;
}
const type=makeType(), film=makeFilm(true), frames=makeFilm(false);
for (const [name, canvas] of [["Typography",type],["Film",film],["Frames",frames]])
  await writeFile(resolve(output,`${name}.png`),canvas.toBuffer("image/png"));

// Deterministic offline previews use the HTML's exact draw order/transforms.
// These are authoring references, not extra Player assets.
export function drawPreview(time=0) {
  const el=surface(1920,1080), g=el.getContext("2d"), mask=surface(1920,1080), c=mask.getContext("2d");
  g.fillStyle="#292929"; g.fillRect(0,0,1920,1080);
  g.strokeStyle="#171717"; g.lineWidth=2.4; g.beginPath();
  for (let x=-1096;x<1936;x+=8) { g.moveTo(x,-8); g.lineTo(x+1096,1088); } g.stroke();
  c.fillStyle="#000"; c.fillRect(0,0,1920,1080);
  // Rasterize the same transformed apertures into a separate alpha layer.
  // This avoids Skia's transformed destination-out clipping at canvas edges;
  // compositing the finished layer is mathematically identical to browser Canvas.
  const apertures=surface(1920,1080), a=apertures.getContext("2d");
  const mod=(n,m)=>((n%m)+m)%m;
  for (let x=-1;x<2;x++) {
    a.save(); a.translate(615+x*3200-mod(time*26,3200),-260); a.rotate(-.305);
    for(let y=-2;y<3;y++) a.drawImage(type,0,y*1050);
    a.restore();
  }
  c.save(); c.globalCompositeOperation="destination-out"; c.drawImage(apertures,0,0); c.restore();
  c.save(); c.rotate(-.305);
  for(const [x,tile,movement,phase] of [[-101,frames,22,0],[101,film,-22,0],[303,frames,22,0],[505,film,-22,245]]) {
    c.save(); c.translate(x-101,mod(time*movement+phase,1080));
    c.fillStyle=c.createPattern(tile,"repeat"); c.fillRect(0,-3240,202,6480); c.restore();
  }
  c.restore(); g.drawImage(mask,0,0); return el;
}
if (process.argv.includes("--preview") || process.argv.includes("--compare")) {
  await mkdir(resolve(".test-dist/immersive-reference"),{recursive:true});
  for(const time of [0,5]) await writeFile(resolve(`.test-dist/immersive-reference/katarune-${time}.png`),drawPreview(time).toBuffer("image/png"));
}
if (process.argv.includes("--compare")) {
  for (const time of [0,5]) {
    const expected=drawPreview(time).getContext("2d").getImageData(0,0,1920,1080).data;
    const actualCanvas=surface(1920,1080), g=actualCanvas.getContext("2d");
    g.drawImage(await loadImage(resolve(`.test-dist/immersive-reference/shader-${time}.png`)),0,0);
    const actual=g.getImageData(0,0,1920,1080).data;
    let difference=0, outliers=0;
    for(let i=0;i<expected.length;i+=4) {
      let error=0;
      for(let c=0;c<3;c++) { const d=Math.abs(expected[i+c]-actual[i+c]); difference+=d; error=Math.max(error,d); }
      if(error>16) outliers++;
    }
    const mean=difference/(1920*1080*3), outlierRatio=outliers/(1920*1080);
    console.log(JSON.stringify({time,meanChannelError:mean,outlierRatio}));
    assert.ok(mean<1 && outlierRatio<.01,"URP background diverged from the Canvas reference");
  }
}
