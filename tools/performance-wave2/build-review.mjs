// Self-contained, backend-free review. Reads the validated baseline with git show; never checks it out or edits it.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const BASE='9ca8eceb28ba32c6f10207c469f62757d78d0f4b';
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
for(const version of ['before','after'])entries[version]=Object.fromEntries(['room','materials','blocking','editorial-characters','core'].map(name=>[name,moduleFor(`dist/studio/${name}.js`,version)]));
const three=moduleFor('dist/lab/vendor/three.module.js','shared'),loader=moduleFor('dist/lab/vendor/GLTFLoader.js','shared'),festival=moduleFor('dist/studio/visual-upgrade/festival-set.js','after');
const assets=Object.fromEntries(['cast-clean-v6','hair-clean-v6'].map(n=>[n,fs.readFileSync(`dist/studio/lookdev/assets/${n}.glb`).toString('base64')]));assets.festival=fs.readFileSync('dist/studio/visual-upgrade/festival-set.glb').toString('base64');
const sourceSha256=Object.fromEntries([...seen].filter(id=>id.startsWith('echo-after:')||id.startsWith('echo-shared:')).map(id=>id.slice(id.indexOf(':')+1)).concat(['dist/studio/visual-upgrade/festival-set.glb','dist/studio/lookdev/assets/cast-clean-v6.glb','dist/studio/lookdev/assets/hair-clean-v6.glb','tools/performance-wave2/viewer.js','dist/studio/performance-direction.js','dist/studio/studio.js','dist/studio/core.js','dist/studio/dialogue.json']).map(file=>[file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const direction=moduleFor('dist/studio/performance-direction.js','after');
const turns=JSON.parse(fs.readFileSync('dist/studio/dialogue.json'));
const audioAssets=Object.fromEntries(turns.map(t=>[t.audio,fs.readFileSync('dist/studio/'+t.audio).toString('base64')]));
const entry=fs.readFileSync('tools/performance-wave2/viewer.js','utf8').replace('__CONFIG__',JSON.stringify({BASE,entries,three,loader,festival,assets,sourceSha256,direction,turns,audioAssets}));
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ECHO performance wave 2</title><style>body{margin:0;background:#0d201a;color:#eee;font:16px system-ui}header,nav,#status,pre{margin:16px 24px}h1{font-size:22px}button,a{padding:12px;background:#2d5141;color:#fff;border:1px solid #b4c58e;border-radius:6px;margin-right:8px;display:inline-block}button:focus-visible,a:focus-visible{outline:3px solid #dfeeaa}canvas{width:100%;display:block}#render{display:none}#status{white-space:pre-wrap}pre{white-space:pre-wrap}</style><header><h1>ECHO · Character performance comparison</h1><p>Left: Wave 1 baseline. Right: Wave 2. Matched camera, recorded dialogue clock; sound is muxed at measured playback offsets. Local review only.</p></header><nav><button id="start" disabled>Record 32-second comparison</button><button id="save" disabled>Save evidence JSON</button><a id="video" hidden>Download preview WebM</a></nav><canvas id="render"></canvas><canvas id="output" width="1920" height="620" aria-label="Before and after animated studio"></canvas><div id="status" role="status">Loading embedded studio assets…</div><pre id="metrics"></pre><script type="importmap">${JSON.stringify({imports})}</script><script type="module">${entry}</script></html>`;
fs.mkdirSync('data/performance-wave2',{recursive:true});fs.writeFileSync('data/performance-wave2/index.html',html);console.log(`Review: ${html.length} bytes; ${Object.keys(imports).length} embedded modules; local recorded audio only.`);
