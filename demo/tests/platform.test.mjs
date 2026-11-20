import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import worker from '../server/worker.mjs';

function database() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0000_platform.sql',import.meta.url),'utf8'));
  return {sqlite,prepare(sql){
    let args=[];
    const statement={bind(...values){args=values;return statement;},async first(){return sqlite.prepare(sql).get(...args);},async run(){return {meta:{changes:sqlite.prepare(sql).run(...args).changes}};}};
    return statement;
  }};
}
function client(DB) {
  let cookie='';
  return async(path,body)=>{
    const headers={Origin:'https://event.test','CF-Connecting-IP':crypto.randomUUID()};
    if(cookie)headers.Cookie=cookie;
    if(body)headers['Content-Type']='application/json';
    const response=await worker.fetch(new Request('https://event.test/api/'+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined}),{DB});
    if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    return {status:response.status,body:await response.json()};
  };
}
const command=(action,data,requestId=crypto.randomUUID())=>({action,data,requestId});

test('cloud workflow preserves balances, roles, retries and simultaneous submissions',async()=>{
  const DB=database(),admin=client(DB),employee=client(DB),other=client(DB);
  assert.equal((await admin('status')).body.needsSetup,true);
  assert.equal((await admin('setup',{name:'活动管理员',department:'筹备组',password:'Admin-test-2027'})).status,200);
  assert.equal((await admin('setup',{name:'重复',department:'重复',password:'Admin-test-2027'})).status,409);
  assert.equal((await admin('login',{id:'EMP001',password:'wrong-pass'})).status,401);
  assert.equal((await admin('login',{id:'EMP001',password:'Admin-test-2027'})).status,200);
  const imported=await admin('action',command('employees',{rows:[{id:'EMP002',name:'测试员工',department:'研发部',password:'Employee-test-2027'},{id:'EMP003',name:'测试员工2',department:'研发部',password:'Employee2-test-2027'}]}));
  assert.equal(imported.status,200);
  assert.equal(imported.body.credentials.length,2);
  await employee('login',{id:'EMP002',password:'Employee-test-2027'});
  await other('login',{id:'EMP003',password:'Employee2-test-2027'});
  assert.equal((await employee('action',command('adjust',{employeeId:'EMP002',amount:999,reason:'越权'}))).status,403);
  const checkin=command('checkin',{employeeId:'EMP002'});
  await Promise.all([admin('action',checkin),admin('action',checkin)]);
  assert.equal((await employee('state')).body.me.points,100);
  const awardResults=await Promise.all([admin('action',command('award',{employeeId:'EMP002',game:'飞镖',amount:100})),admin('action',command('award',{employeeId:'EMP002',game:'飞镖',amount:100}))]);
  assert.deepEqual(awardResults.map(row=>row.status).sort(),[200,400]);
  assert.equal((await employee('state')).body.me.points,200);
  await admin('action',command('adjust',{employeeId:'EMP003',amount:200,reason:'测试积分'}));
  const now=Date.now();
  await admin('action',command('product',{name:'耳机',description:'测试奖品',minimum:50,quantity:1,start:new Date(now-1000).toISOString(),end:new Date(now+3600000).toISOString()}));
  await admin('action',command('product',{name:'手表',description:'测试奖品',minimum:50,quantity:1,start:new Date(now-1000).toISOString(),end:new Date(now+3600000).toISOString()}));
  const products=(await employee('state')).body.products;
  const bids=await Promise.all(products.map(product=>employee('action',command('bid',{productId:product.id,amount:150}))));
  assert.deepEqual(bids.map(row=>row.status).sort(),[200,400]);
  let current=(await employee('state')).body;
  assert.equal(current.me.frozen,150);
  assert.equal(current.me.points,200);
  const active=current.bids[0];
  await other('action',command('bid',{productId:active.productId,amount:160}));
  assert.equal((await admin('action',command('adjust',{employeeId:'EMP002',amount:-100,reason:'扣分测试'}))).status,400);
  const settled=await Promise.all([admin('action',command('settle',{productId:active.productId})),admin('action',command('settle',{productId:active.productId}))]);
  assert.deepEqual(settled.map(row=>row.status).sort(),[200,400]);
  current=(await employee('state')).body;
  assert.equal(current.me.frozen,0);
  assert.equal(current.me.points,200);
  const winner=(await other('state')).body;
  assert.equal(winner.me.points,40);
  assert.equal(winner.me.frozen,0);
  assert.equal(winner.ledger.filter(row=>row.amount===-160).length,1);
  assert.equal((await other('action',command('bid',{productId:active.productId,amount:170}))).status,400);
  assert.ok(!JSON.stringify(current).includes('Employee-test-2027'));
  assert.equal(current.ledger.every(row=>row.employeeId==='EMP002'),true);
  await employee('logout',{});
  assert.equal((await employee('state')).status,401);
  const invalidOrigin=await worker.fetch(new Request('https://event.test/api/setup',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:'{}'}),{DB});
  assert.equal(invalidOrigin.status,403);
  DB.sqlite.close();
});

test('expiry settles once and failed employee imports leave no partial records',async()=>{
  const DB=database(),admin=client(DB);
  await admin('setup',{name:'管理员',department:'筹备',password:'Admin-test-2027'});
  await admin('login',{id:'EMP001',password:'Admin-test-2027'});
  const invalid=await admin('action',command('employees',{rows:[{id:'EMP002',name:'员工',department:'研发'},{id:'EMP001',name:'重复',department:'研发'}]}));
  assert.equal(invalid.status,400);
  assert.equal((await admin('state')).body.employees.length,1);
  await admin('action',command('adjust',{employeeId:'EMP001',amount:100,reason:'初始积分'}));
  const now=Date.now();
  await admin('action',command('product',{name:'礼品',description:'奖品',minimum:10,quantity:1,start:new Date(now-10000).toISOString(),end:new Date(now+100000).toISOString()}));
  const product=(await admin('state')).body.products[0];
  await admin('action',command('bid',{productId:product.id,amount:30}));
  const row=DB.sqlite.prepare('SELECT payload FROM platform_state WHERE id=1').get();
  const data=JSON.parse(row.payload);data.products[0].end=Date.now()-1;
  DB.sqlite.prepare('UPDATE platform_state SET payload=?, revision=revision+1 WHERE id=1').run(JSON.stringify(data));
  assert.equal((await admin('state')).body.me.points,70);
  assert.equal((await admin('state')).body.me.points,70);
  DB.sqlite.close();
});

test('QR encoder produces the reference matrix',()=>{
  const context=vm.createContext({TextEncoder});
  vm.runInContext(readFileSync(new URL('../web/qr.js',import.meta.url),'utf8'),context);
  const expected=JSON.parse(readFileSync(new URL('./qr-reference.json',import.meta.url),'utf8'));
  for(const [id,matrix] of Object.entries(expected)) assert.equal(JSON.stringify(vm.runInContext(`employeeQR('${id}')`,context)),JSON.stringify(matrix));
});

test('GitHub Pages uses scoped CORS and bearer sessions with role checks',async()=>{
  const DB=database(),admin=client(DB);
  await admin('setup',{name:'管理员',department:'筹备组',password:'Admin-test-2027'});
  const origin='https://yanhong113.github.io';
  const request=(path,body,token,source=origin)=>new Request('https://event.test/api/'+path,{method:body?'POST':'GET',headers:{Origin:source,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
  const preflight=await worker.fetch(new Request('https://event.test/api/login',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}}),{DB});
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);
  const login=await worker.fetch(request('login',{id:'EMP001',password:'Admin-test-2027'}),{DB});
  assert.equal(login.status,200);
  assert.equal(login.headers.get('Access-Control-Allow-Origin'),origin);
  const token=(await login.json()).token;
  assert.match(token,/^[a-f0-9]{64}$/);
  const state=await worker.fetch(request('state',null,token),{DB});
  assert.equal((await state.json()).me.id,'EMP001');
  const denied=await worker.fetch(request('login',{id:'EMP001',password:'Admin-test-2027'},null,'https://untrusted.test'),{DB});
  assert.equal(denied.status,403);
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'),null);
  const unauthorized=await worker.fetch(request('state'),{DB});
  assert.equal(unauthorized.status,401);
  assert.equal(unauthorized.headers.get('Access-Control-Allow-Origin'),origin);
  await worker.fetch(request('logout',{},token),{DB});
  assert.equal((await worker.fetch(request('state',null,token),{DB})).status,401);
  DB.sqlite.close();
});
