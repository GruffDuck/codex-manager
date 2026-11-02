// Read-only documentation preview. Uses synthetic accounts and never opens the real database.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../ui/dist');
const now = Date.now();
const window = (used, hours) => ({ used_percent: used, limit_window_seconds: hours * 3600,
  reset_after_seconds: hours === 5 ? 10_800 : 345_600, reset_at: Math.floor(now / 1000) + (hours === 5 ? 10_800 : 345_600) });
const accounts = [
  ['demo-personal', 'alex@example.com', 'plus', 28, 41, 'active'],
  ['demo-work', 'team@example.com', 'pro', 9, 18, 'active'],
  ['demo-spare', 'archive@example.com', 'plus', 100, 63, 'rate_limited'],
].map(([id,email,plan,primary,secondary,status],index) => ({ id,email,account_id:id,plan_type:plan,status,
  status_reason: status === 'rate_limited' ? 'Usage limit reached' : null,
  cooldown_until: status === 'rate_limited' ? now + 10_800_000 : null,
  last_used: now - (index + 1) * 300_000,created_at: now - 864_000_000,
  quota: {plan_type:plan,allowed:status==='active',limit_reached:status!=='active',primary:window(primary,5),secondary:window(secondary,168),captured_at:now,source:'usage'},
  weight: index===1?3:2,is_current:index===0,eligible:status==='active' }));
const state = {version:'0.1.0',started_at:now-3_600_000,uptime_ms:3_600_000,
 gateway:{port:8055,url:'http://127.0.0.1:8055/v1',upstream_base:'https://chatgpt.com/backend-api/codex',
 api_key:'demo-only-not-a-real-credential',api_key_masked:'demo…only',max_account_attempts:3,request_timeout_ms:600_000,oauth_port:1455},
 codex_home:'/Users/demo/.codex',accounts,counts:{total:3,active:2},current_account_id:'demo-personal',codex_auth_account_id:'demo-personal',backup_exists:true,
 codex_restart:{supported:true,installed:true,running:true,reason:'Example macOS session.',operation:null},
 codex_desktop:{state:'unavailable',reason:'Direct restart mode.',account_id:null,email:null,busy:null,checked_at:now,sessions:[]},
 codex_config:{path:'/Users/demo/.codex/config.toml',applied:false,backup:'/Users/demo/.codex/config.toml.codex-manager.bak'},
 settings:{auto_switch:{enabled:true,remaining_threshold:0,interval_seconds:60,allow_refresh:true,target:'codex'},
 notifications:{auto_switch:true,low_quota:true,account_errors:true,low_quota_threshold:10}},
 events:[{id:1,ts:now-120_000,type:'import',title:'Account added',detail:'team@example.com is ready to use.',account_id:'demo-work',notify:false},
 {id:2,ts:now-60_000,type:'system',title:'Auto-switch enabled',detail:'Checks every minute and switches at 0% remaining.',account_id:null,notify:false}],
 event_cursor:2,requests:Array.from({length:12},(_,index)=>({id:`demo-request-${index}`,account_id:index%2?'demo-personal':'demo-work',ts:now-index*75_000,
 model:'gpt-5.1-codex',status:index===7?429:200,latency_ms:840+index*167,note:index===7?'Usage limit reached; another account was tried.':'Responses request completed.'})),total_requests:12};
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const server=http.createServer((request,response)=>{
 const url=new URL(request.url,'http://127.0.0.1');
 if(request.method!=='GET'){response.writeHead(409,{'content-type':'application/json'});response.end(JSON.stringify({error:{message:'Read-only documentation preview.'}}));return;}
 if(url.pathname==='/api/state'){response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(state));return;}
 if(url.pathname.startsWith('/api/')){response.writeHead(404);response.end();return;}
 const relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
 const file=path.resolve(root,relative);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);response.end();return;}
 response.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(response);
});
server.listen(18065,'127.0.0.1',()=>console.log('Read-only demo: http://127.0.0.1:18065'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
