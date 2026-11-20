import {initialState,fail,text,employeeId,integer,requireRole,expireAuctions,mutate,publicState} from './core.mjs';
import {assets} from './assets.mjs';
const encoder=new TextEncoder();
const pagesOrigin='https://yanhong113.github.io';
const hex=bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
async function hash(value) { return hex(await crypto.subtle.digest('SHA-256',encoder.encode(value))); }
async function receiptKey(token) {
  return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',encoder.encode(token)),'AES-GCM',false,['encrypt','decrypt']);
}
async function sealCredentials(credentials,token) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await receiptKey(token),encoder.encode(JSON.stringify(credentials)));
  return {iv:Array.from(iv),bytes:Array.from(new Uint8Array(encrypted))};
}
async function openCredentials(sealed,token) {
  const result=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(sealed.iv)},await receiptKey(token),new Uint8Array(sealed.bytes));
  return JSON.parse(new TextDecoder().decode(result));
}
async function passwordHash(password,salt) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations:100000},key,256));
}
function secret(value) { if (typeof value!=='string' || value.length<8 || value.length>128) fail('登录凭证须为8至128位'); return value; }
function cookieToken(request) { return request.headers.get('Cookie')?.match(/(?:^|;\s*)weiya_session=([a-f0-9]{64})(?:;|$)/)?.[1] || ''; }
function authToken(request) {
  const bearer=request.headers.get('Authorization');
  if(bearer) return bearer.match(/^Bearer ([a-f0-9]{64})$/)?.[1] || '';
  return cookieToken(request);
}
function allowedOrigin(request) {
  const origin=request.headers.get('Origin');
  return origin===new URL(request.url).origin || origin===pagesOrigin;
}
function cors(response,request) {
  if(request.headers.get('Origin')!==pagesOrigin)return response;
  const headers=new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin',pagesOrigin);
  headers.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers','Content-Type, Authorization');
  headers.set('Access-Control-Max-Age','600');
  headers.set('Vary','Origin');
  return new Response(response.body,{status:response.status,headers});
}
function json(data,status=200,cookie) {
  const headers={'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if(cookie) headers['Set-Cookie']=cookie;
  return new Response(JSON.stringify(data),{status,headers});
}
async function update(db,operation) {
  await db.prepare('INSERT INTO platform_state (id,revision,payload) VALUES (1,0,?) ON CONFLICT(id) DO NOTHING').bind(JSON.stringify(initialState())).run();
  for(let attempt=0;attempt<20;attempt++) {
    const row=await db.prepare('SELECT revision,payload FROM platform_state WHERE id=1').first();
    const state=JSON.parse(row.payload);
    const now=Date.now();
    expireAuctions(state,now);
    state.sessions=state.sessions.filter(session=>session.expires>now);
    state.receipts=state.receipts.filter(receipt=>receipt.expires>now);
    for(const [key,attempt] of Object.entries(state.attempts)) if(attempt.until<=now) delete state.attempts[key];
    const result=await operation(state,now);
    if(JSON.stringify(state)===row.payload) return result;
    const write=await db.prepare('UPDATE platform_state SET payload=?, revision=revision+1 WHERE id=1 AND revision=?').bind(JSON.stringify(state),row.revision).run();
    if(write.meta.changes===1) return result;
    await new Promise(resolve=>setTimeout(resolve,Math.min(150,5*2**attempt)+Math.random()*30));
  }
  fail('当前提交较多，请稍后重试',409);
}
async function api(request,env,path) {
  if(!env.DB) fail('数据库尚未配置',503);
  const isPost=request.method==='POST';
  if(!isPost && request.method!=='GET') fail('不支持的请求方法',405);
  if(isPost && !allowedOrigin(request)) fail('请求来源无效',403);
  let data={};
  if(isPost) {
    if(!request.headers.get('Content-Type')?.startsWith('application/json')) fail('请求格式错误',415);
    const body=await request.text();
    if(body.length>800000) fail('导入数据过大',413);
    try { data=JSON.parse(body); } catch { fail('请求内容无效'); }
    if(!data || Array.isArray(data) || typeof data!=='object') fail('请求内容无效');
  }
  const token=authToken(request);
  const tokenHash=token?await hash(token):'';
  const response=await update(env.DB,async(state,now)=>{
    if(path==='/api/status' && !isPost) return {body:{needsSetup:state.employees.length===0}};
    if(path==='/api/setup' && isPost) {
      if(request.headers.get('Origin')!==new URL(request.url).origin) fail('请在云端主站初始化管理员',403);
      if(state.employees.length) fail('平台已初始化',409);
      const salt=crypto.randomUUID();
      const password=secret(data.password);
      state.employees.push({id:'EMP001',name:text(data.name,50),department:text(data.department,50),role:'admin',points:0,salt,password:await passwordHash(password,salt)});
      return {body:{message:'管理员已创建，请使用 EMP001 和设置的凭证登录'}};
    }
    if(path==='/api/login' && isPost) {
      const id=employeeId(data.id);
      const address=request.headers.get('CF-Connecting-IP')||'local';
      const attemptKey=await hash(address);
      const attempt=state.attempts[attemptKey];
      if(attempt && attempt.until>now && attempt.count>=12) return {status:429,body:{error:'尝试次数过多，请15分钟后重试'}};
      const user=state.employees.find(row=>row.id===id);
      const candidate=await passwordHash(typeof data.password==='string'?data.password.slice(0,128):'',user?.salt||'unrecognized');
      if(!user || candidate!==user.password) {
        state.attempts[attemptKey]={count:attempt?.until>now?attempt.count+1:1,until:now+900000};
        return {status:401,body:{error:'工号或登录凭证错误'}};
      }
      delete state.attempts[attemptKey];
      const sessionToken=hex(crypto.getRandomValues(new Uint8Array(32)));
      state.sessions.push({hash:await hash(sessionToken),employeeId:id,expires:now+12*3600000});
      return {body:{message:'登录成功',...(request.headers.get('Origin')===pagesOrigin?{token:sessionToken}:{})},cookie:`weiya_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`};
    }
    const session=state.sessions.find(row=>row.hash===tokenHash);
    const user=state.employees.find(row=>row.id===session?.employeeId);
    if(!user) fail('请先登录',401);
    if(path==='/api/logout' && isPost) {
      state.sessions=state.sessions.filter(row=>row.hash!==tokenHash);
      return {body:{message:'已退出'},cookie:'weiya_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'};
    }
    if(path==='/api/state' && !isPost) return {body:publicState(state,user,now)};
    if(path!=='/api/action' || !isPost) fail('接口不存在',404);
    const requestId=text(data.requestId,80);
    const fingerprint=await hash(JSON.stringify({action:data.action,data:data.data}));
    const receipt=state.receipts.find(row=>row.id===requestId && row.employeeId===user.id);
    if(receipt) {
      if(receipt.fingerprint!==fingerprint) fail('请求编号冲突',409);
      const body={...receipt.body};
      if(receipt.credentials) {
        if(receipt.sessionHash!==tokenHash) fail('请使用原登录会话重试此次导入',409);
        body.credentials=await openCredentials(receipt.credentials,token);
      }
      return {body};
    }
    let body;
    if(data.action==='employees') {
      requireRole(user,['admin']);
      if(!Array.isArray(data.data?.rows) || !data.data.rows.length || data.data.rows.length>1000) fail('每次请导入1至1000位员工');
      const credentials=[];
      for(const row of data.data.rows) {
        const id=employeeId(row.id);
        if(state.employees.some(item=>item.id===id)) fail(`工号 ${id} 已存在，整批导入已取消`);
        const role=row.role||'employee';
        if(!['employee','gamemaster','admin'].includes(role)) fail(`工号 ${id} 的角色无效`);
        const password=secret(row.password||hex(crypto.getRandomValues(new Uint8Array(8))));
        const salt=crypto.randomUUID();
        const person={id,name:text(row.name,50),department:text(row.department,50),role,points:0,salt,password:await passwordHash(password,salt)};
        state.employees.push(person);
        credentials.push({id,name:person.name,password});
      }
      body={message:`已导入 ${credentials.length} 位员工`,credentials};
    } else body={message:mutate(state,user,data.action,data.data||{},now)};
    // Keep retry results encrypted with the current opaque session token.
    const sealed=body.credentials?await sealCredentials(body.credentials,token):undefined;
    state.receipts.push({id:requestId,employeeId:user.id,fingerprint,body:{message:body.message},credentials:sealed,sessionHash:sealed?tokenHash:undefined,expires:now+86400000});
    return {body};
  });
  return json(response.body,response.status||200,response.cookie);
}
export default { async fetch(request,env) {
  const url=new URL(request.url);
  try {
    if(url.pathname.startsWith('/api/')) {
      if(request.method==='OPTIONS') {
        if(!allowedOrigin(request)) fail('请求来源无效',403);
        return cors(new Response(null,{status:204}),request);
      }
      return cors(await api(request,env,url.pathname),request);
    }
    const asset=assets[url.pathname] || (!url.pathname.includes('.')?assets['/index.html']:null);
    if(!asset) return new Response('Not found',{status:404});
    return new Response(asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"}});
  } catch(error) {
    if(!error.status) console.error('Request failed',error.message);
    return cors(json({error:error.status?error.message:'服务暂时不可用，请稍后重试'},error.status||500),request);
  }
}};
