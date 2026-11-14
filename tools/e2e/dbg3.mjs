import { chromium } from 'playwright-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT='/home/ky/dev/power_grid_game_qwen_flash_next';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const srv=http.createServer((q,r)=>{const u=decodeURIComponent(q.url.split('?')[0]);const f=path.join(ROOT,u==='/'?'index.html':u);if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'content-type':MIME[path.extname(f)]||'text/plain'});fs.createReadStream(f).pipe(r);});
await new Promise(res=>srv.listen(8149,'127.0.0.1',res));
const b=await chromium.launch({executablePath:'/usr/local/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
const p=await b.newPage({viewport:{width:1440,height:900}});
p.on('response',r=>{ if(r.url().includes('styles')) console.log('css status', r.status(), r.headers()['content-type']); });
p.on('requestfailed',r=>console.log('reqfail', r.url()));
await p.goto('http://127.0.0.1:8149/');
await p.waitForTimeout(400);
console.log(await p.evaluate(()=>{
  const map=document.getElementById('map'), main=document.querySelector('main'), board=document.getElementById('board'), panel=document.getElementById('panel');
  const cs=getComputedStyle(map);
  return {
    sheets: document.styleSheets.length, rules: document.styleSheets[0]?.cssRules?.length ?? 0,
    mapCss:{width:cs.width,height:cs.height,flex:cs.flex},
    mapRect:{w:map.getBoundingClientRect().width,h:map.getBoundingClientRect().height},
    mainRect:{w:main.getBoundingClientRect().width,h:main.getBoundingClientRect().height},
    boardRect:{w:board.getBoundingClientRect().width,h:board.getBoundingClientRect().height},
    panelRect:{w:panel.getBoundingClientRect().width,h:panel.getBoundingClientRect().height},
    mainDisplay:getComputedStyle(main).display, mainGridRows:getComputedStyle(main).gridTemplateRows,
  };
}));
await b.close(); srv.close();
