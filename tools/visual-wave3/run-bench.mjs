import {chromium} from '/Users/apple/Bridge/Projects/Hacktoberfest/echo-stage/node_modules/playwright/index.mjs';import fs from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal']});const page=await (await browser.newContext({viewport:{width:1320,height:600}})).newPage();
const done=new Promise(r=>page.exposeFunction('__benchDone',r));const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('file://'+process.cwd()+'/data/visual-wave3/bench.html');
const json=await Promise.race([done,new Promise((_,rej)=>setTimeout(()=>rej(new Error('bench timeout')),240000))]);
fs.writeFileSync(process.argv[2]||'docs/visual-wave3/evidence/benchmark.json',JSON.stringify({...JSON.parse(json),errors},null,1));await browser.close();
const r=JSON.parse(json);console.log('gpu',r.gpu,'timerQuery',r.timerQuery);for(const x of r.results)console.log(x.version,x.trial,x.shot,'draw',x.drawCalls,'tri',x.triangles,'anim',x.animationMedianMs.toFixed(2),'/',x.animationP95Ms.toFixed(2),'submit',x.submitMedianMs.toFixed(2),'gpu',x.gpuMedianMs?.toFixed(2),'/',x.gpuP95Ms?.toFixed(2),'n',x.gpuSamples);
