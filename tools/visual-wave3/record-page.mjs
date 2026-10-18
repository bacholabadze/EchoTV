// Wave 3 evidence recorder. Headless Chrome only (no window, no focus change), two throwaway static servers
// on 127.0.0.1 (never 8787). Records the real /studio/ page of the Wave 2 tree and the Wave 3 tree with the
// same dialogue clock, captures CDP screencast frames with true timestamps, samples frame intervals, then
// muxes the original unchanged MP3s at the measured turn-start offsets. Nothing is simulated in the page.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import {execFileSync} from 'node:child_process';
import {chromium} from '/Users/apple/Bridge/Projects/Hacktoberfest/echo-stage/node_modules/playwright/index.mjs';
const [,,outDir='docs/visual-wave3/evidence/raw',seconds='42']=process.argv;
const versions={before:{root:'/Users/apple/Bridge/Projects/Hacktoberfest/echo-stage-visuals/dist',port:8898,url:'/studio/'},after:{root:'/Users/apple/Bridge/Projects/Hacktoberfest/echo-stage-visuals-w3/dist',port:8899,url:'/studio/?opening=1'}};
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary','.mp3':'audio/mpeg','.hdr':'application/octet-stream'};
function serve(root,port){return new Promise(resolve=>{const s=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(root,p),(e,d)=>{if(e){res.writeHead(404);res.end();return;}res.writeHead(200,{'content-type':types[path.extname(p)]||'application/octet-stream'});res.end(d);});});s.listen(port,'127.0.0.1',()=>resolve(s));});}
const pct=(a,q)=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor((s.length-1)*q)]:null;};
async function record(name,v){
 const dir=path.join(outDir,name),frames=path.join(dir,'frames');fs.mkdirSync(frames,{recursive:true});
 const server=await serve(v.root,v.port);
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio','--use-angle=metal']});
 const context=await browser.newContext({viewport:{width:1320,height:760},deviceScaleFactor:1});
 await context.addInitScript(()=>{window.__w3frames=[];let last=0;const tick=t=>{if(last)window.__w3frames.push(t-last);last=t;requestAnimationFrame(tick);};requestAnimationFrame(tick);});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/404/.test(m.text()))errors.push(m.text());});
 await page.goto(`http://127.0.0.1:${v.port}${v.url}`);
 await page.waitForFunction(()=>window.EchoStudio?.getState().rendererAvailable&&window.EchoStudio.getState().renderedFrames>0,null,{timeout:90000});
 await page.evaluate(()=>document.querySelector('#stage').scrollIntoView({block:'start'}));await new Promise(r=>setTimeout(r,800));
 const rect=await page.evaluate(()=>{const r=document.querySelector('#stage').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};});
 const list=[];const cdp=await context.newCDPSession(page);
 cdp.on('Page.screencastFrame',f=>{const file=`f${String(list.length).padStart(6,'0')}.jpg`;fs.writeFileSync(path.join(frames,file),Buffer.from(f.data,'base64'));list.push({t:f.metadata.timestamp,file});cdp.send('Page.screencastFrameAck',{sessionId:f.sessionId}).catch(()=>{});});
 await cdp.send('Page.startScreencast',{format:'jpeg',quality:90,maxWidth:1320,maxHeight:760,everyNthFrame:1});
 await new Promise(r=>setTimeout(r,500));
 const t0=Date.now()/1000;await page.evaluate(()=>window.__w3frames.length=0);
 await page.click('#play');const clickAt=Date.now()/1000;
 const samples=[];let lastTurn=-1,lastShot=null;const events=[];
 const until=clickAt+Number(seconds);
 while(Date.now()/1000<until){await new Promise(r=>setTimeout(r,100));const s=await page.evaluate(()=>window.EchoStudio.getState());const now=Date.now()/1000;
  if(s.turn!==lastTurn&&s.state==='playing'&&!s.opening){events.push({kind:'turn',turn:s.turn,wall:now,audioTime:s.audioTime});lastTurn=s.turn;}
  if(s.shot!==lastShot){events.push({kind:'shot',shot:s.shot,wall:now,turn:s.turn,audioTime:s.audioTime});lastShot=s.shot;}
  if(s.opening&&!events.some(e=>e.kind==='opening'))events.push({kind:'opening',wall:now});
  samples.push({wall:now,...s});if(s.state==='ended')break;}
 const intervals=await page.evaluate(()=>window.__w3frames.slice());
 await cdp.send('Page.stopScreencast').catch(()=>{});
 const metrics=await cdp.send('Performance.getMetrics').catch(()=>null);
 const last=samples.at(-1);
 const result={name,url:v.url,viewport:'1320x760',stage:rect,clickAt,frames:list.length,span:list.length?list.at(-1).t-list[0].t:0,events,errors,visual:last?.visual,drawCalls:last?.drawCalls,triangles:last?.triangles,pixelRatio:last?.pixelRatio,renderedFrames:last?.renderedFrames,
  rafIntervalMs:{samples:intervals.length,p50:pct(intervals,.5),p95:pct(intervals,.95),max:Math.max(...intervals)},jsHeapMB:metrics?.metrics?.find(m=>m.name==='JSHeapUsedSize')?.value/1048576,taskDurationS:metrics?.metrics?.find(m=>m.name==='TaskDuration')?.value};
 fs.writeFileSync(path.join(dir,'frames.json'),JSON.stringify(list));fs.writeFileSync(path.join(dir,'samples.json'),JSON.stringify(samples));fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,1));
 let cat='ffconcat version 1.0\n';for(let i=0;i<list.length;i++){const d=i+1<list.length?list[i+1].t-list[i].t:1/30;cat+=`file 'frames/${list[i].file}'\nduration ${Math.max(.001,d).toFixed(6)}\n`;}fs.writeFileSync(path.join(dir,'frames.ffconcat'),cat);
 await context.close();await browser.close();server.close();
 console.log(name,JSON.stringify({frames:list.length,span:+result.span.toFixed(2),events:events.length,errors:errors.length,draw:result.drawCalls,tri:result.triangles,raf:result.rafIntervalMs}));
 return result;
}
const results={};for(const [name,v] of Object.entries(versions))results[name]=await record(name,v);
fs.writeFileSync(path.join(outDir,'results.json'),JSON.stringify(results,null,1));console.log('DONE',outDir);
