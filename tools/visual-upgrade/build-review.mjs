// Self-contained, backend-free review. Reads the validated baseline with git show; never checks it out or edits it.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const BASE='d0f4bd2866cfdee625bbdcffa62138b557f696a9';
const imports={},seen=new Set();
function moduleFor(file,version){
 file=file.split('?')[0];if(file.includes('/vendor/'))version='shared';
 const id=`echo-${version}:${file}`;if(seen.has(id))return id;seen.add(id);
 let text=version==='before'?execFileSync('git',['show',`${BASE}:${file}`],{encoding:'utf8',maxBuffer:8e6}):fs.readFileSync(file,'utf8');
 text=text.replace(/(from\s*|import\s*)['"]([^'"]+)['"]/g,(all,lead,spec)=>{
  const resolved=spec==='three'?'dist/lab/vendor/three.module.js':spec.startsWith('.')?path.posix.normalize(path.posix.join(path.posix.dirname(file),spec)):spec.startsWith('/')?'dist'+spec:null;
  return resolved?`${lead}'${moduleFor(resolved,version)}'`:all;
 });
 imports[id]='data:text/javascript;base64,'+Buffer.from(text).toString('base64');return id;
}
const entries={};
for(const version of ['before','after'])entries[version]=Object.fromEntries(['room','materials','blocking','editorial-characters'].map(name=>[name,moduleFor(`dist/studio/${name}.js`,version)]));
const three=moduleFor('dist/lab/vendor/three.module.js','shared'),loader=moduleFor('dist/lab/vendor/GLTFLoader.js','shared'),festival=moduleFor('dist/studio/visual-upgrade/festival-set.js','after');
const assets=Object.fromEntries(['cast-clean-v6','hair-clean-v6'].map(n=>[n,fs.readFileSync(`dist/studio/lookdev/assets/${n}.glb`).toString('base64')]));assets.festival=fs.readFileSync('dist/studio/visual-upgrade/festival-set.glb').toString('base64');
const sourceSha256=Object.fromEntries([...seen].filter(id=>id.startsWith('echo-after:')||id.startsWith('echo-shared:')).map(id=>id.slice(id.indexOf(':')+1)).concat(['dist/studio/visual-upgrade/festival-set.glb','dist/studio/lookdev/assets/cast-clean-v6.glb','dist/studio/lookdev/assets/hair-clean-v6.glb','tools/visual-upgrade/review-viewer.js']).map(file=>[file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const entry=fs.readFileSync('tools/visual-upgrade/review-viewer.js','utf8').replace('__CONFIG__',JSON.stringify({BASE,entries,three,loader,festival,assets,sourceSha256}));
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ECHO isolated visual review</title><style>*{box-sizing:border-box}body{margin:0;background:#0d1b19;color:#ecebdc;font:15px system-ui}header,nav,#status{padding:12px 24px}h1{font-size:20px;margin:0}p{margin:6px 0;color:#b4c8bb}nav{display:flex;flex-wrap:wrap;gap:9px}button,select{background:#263e35;color:#fff;border:1px solid #72917b;border-radius:6px;padding:10px 15px;font:inherit}button:focus-visible,select:focus-visible{outline:3px solid #dfeeaa}button:disabled{opacity:.5}#stage{margin:0 auto;width:min(1280px,100%);aspect-ratio:16/9}#stage.portrait{width:min(390px,100%);aspect-ratio:390/844}canvas{width:100%;height:100%;display:block}pre{white-space:pre-wrap;margin:12px 24px}#status{color:#deeea7}</style><header><h1>ECHO · Independent visual review</h1><p>Baseline d0f4bd2 / event set · Visual-only scene. No production state, agents, audio or broadcast actions.</p></header><nav><select id="version" aria-label="Visual version"><option value="before">Before · validated 3.1 visuals</option><option value="after">After · event set</option></select><select id="shot" aria-label="Camera shot"><option>wide</option><option>echo</option><option>nova</option><option>atlas</option><option>two</option></select><button id="portrait">Portrait / landscape</button><button id="suite">Capture comparison + benchmark</button><button id="save" disabled>Save evidence JSON</button></nav><div id="stage"><canvas id="canvas" aria-label="ECHO studio visual comparison"></canvas></div><div id="status" role="status">Loading local embedded assets…</div><pre id="metrics"></pre><script type="importmap">${JSON.stringify({imports})}</script><script type="module">${entry}</script></html>`;
fs.mkdirSync('data/visual-review',{recursive:true});fs.writeFileSync('data/visual-review/index.html',html);console.log(`Standalone review: ${html.length} bytes; ${Object.keys(imports).length} embedded modules; no server or network required.`);
