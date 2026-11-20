const games = ['套圈圈','飞镖','九宫格投球','神射手','趣味闯关'];
const initialState = () => ({ employees:[], products:[], bids:[], ledger:[], notices:[{id:'welcome',title:'欢迎参加 2027 尾牙',body:'签到后参与闯关，用获得的积分竞标心仪奖品。'},{id:'schedule',title:'活动流程',body:'18:00 签到 · 18:30 闯关游戏 · 20:00 积分竞标 · 21:00 结标'}], sessions:[], attempts:{}, receipts:[] });
function fail(message, status=400) { throw Object.assign(new Error(message), {status}); }
function text(value, max=100) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail('请检查必填文字和长度');
  return value.trim();
}
function integer(value, min=0, max=1000000) {
  const number = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isSafeInteger(number) || number < min || number > max) fail('积分或数量超出允许范围');
  return number;
}
function employeeId(value) {
  const id = text(value,16).toUpperCase();
  if (!/^[A-Z0-9_-]+$/.test(id)) fail('工号须为不超过16位的字母、数字、下划线或连字符');
  return id;
}
function requireRole(user, roles) { if (!user || !roles.includes(user.role)) fail('当前账号无此操作权限',403); }
function employee(state,id) {
  const found = state.employees.find(row => row.id === id);
  if (!found) fail('未找到该员工',404);
  return found;
}
function frozen(state,id) {
  return state.bids.filter(bid => bid.employeeId===id && bid.status==='active').reduce((sum,bid)=>sum+bid.amount,0);
}
function available(state,id) { return employee(state,id).points - frozen(state,id); }
function addPoints(state,id,amount,reason,actor,now) {
  const target=employee(state,id);
  target.points += amount;
  state.ledger.unshift({id:crypto.randomUUID(),employeeId:id,amount,reason,actor,time:now});
}
function settle(state,product,actor,now) {
  if (product.status==='closed') return;
  const bids=state.bids.filter(bid=>bid.productId===product.id && bid.status==='active').sort((a,b)=>b.amount-a.amount || a.time-b.time || (a.order||0)-(b.order||0));
  for (const [index,bid] of bids.entries()) {
    bid.status=index<product.quantity ? 'won':'lost';
    if (bid.status==='won') addPoints(state,bid.employeeId,-bid.amount,`竞标得标 · ${product.name}`,actor,now);
  }
  product.status='closed';
  product.closedAt=now;
}
function expireAuctions(state,now) {
  for (const product of state.products) {
    if (product.status==='open' && product.end<=now) settle(state,product,'系统结标',now);
  }
}
function mutate(state,user,action,data,now=Date.now()) {
  if (action==='bid') {
    const product=state.products.find(row=>row.id===data.productId);
    if (!product) fail('奖品不存在',404);
    if (product.status!=='open' || now<product.start || now>=product.end) fail('当前奖品不在竞标时间内');
    const amount=integer(data.amount,product.minimum);
    const previous=state.bids.find(bid=>bid.productId===product.id && bid.employeeId===user.id && bid.status==='active');
    if (previous && amount<=previous.amount) fail('新出价必须高于原出价');
    if (available(state,user.id)+(previous?.amount||0)<amount) fail('可用积分不足');
    state.bidSequence=(state.bidSequence||0)+1;
    if (previous) Object.assign(previous,{amount,time:now,order:state.bidSequence});
    else state.bids.push({id:crypto.randomUUID(),employeeId:user.id,productId:product.id,amount,time:now,order:state.bidSequence,status:'active'});
    return '出价成功，积分已冻结';
  }
  if (action==='checkin') {
    requireRole(user,['admin','gamemaster']);
    const id=employeeId(data.employeeId);
    employee(state,id);
    if (state.ledger.some(row=>row.employeeId===id && row.kind==='checkin')) fail('该员工已签到');
    addPoints(state,id,100,'签到',user.id,now);
    state.ledger[0].kind='checkin';
    return '签到成功，已加100分';
  }
  if (action==='award') {
    requireRole(user,['admin','gamemaster']);
    const id=employeeId(data.employeeId);
    employee(state,id);
    if (!games.includes(data.game)) fail('请选择游戏');
    const amount=integer(data.amount,10,100);
    if (![10,20,30,50,100].includes(amount)) fail('请选择加分档位');
    if (state.ledger.some(row=>row.employeeId===id && row.game===data.game)) fail('该游戏已加分，请勿重复提交');
    addPoints(state,id,amount,data.game,user.id,now);
    state.ledger[0].game=data.game;
    return '加分成功';
  }
  requireRole(user,['admin']);
  if (action==='adjust') {
    const id=employeeId(data.employeeId);
    const amount=integer(data.amount,-1000000,1000000);
    if (!amount) fail('调整积分不能为0');
    if (available(state,id)+amount<0) fail('调整后可用积分不能低于0，请先完成相关竞标');
    addPoints(state,id,amount,text(data.reason,200),user.id,now);
    return '积分已调整';
  }
  if (action==='product') {
    const start=Date.parse(data.start),end=Date.parse(data.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end<=start || end<=now) fail('请设置有效的竞标开始和结束时间');
    state.products.push({id:crypto.randomUUID(),name:text(data.name,80),description:text(data.description,500),minimum:integer(data.minimum,1),quantity:integer(data.quantity,1,1000),start,end,status:'open'});
    return '奖品已发布';
  }
  if (action==='settle') {
    const product=state.products.find(row=>row.id===data.productId);
    if (!product) fail('奖品不存在',404);
    if (product.status==='closed') fail('奖品已结标');
    settle(state,product,user.id,now);
    return '结标完成，得标积分已扣除，其余冻结额度已释放';
  }
  if (action==='notice') {
    state.notices.unshift({id:crypto.randomUUID(),title:text(data.title,80),body:text(data.body,2000)});
    return '公告已发布';
  }
  fail('不支持的操作',404);
}
function publicState(state,user,now=Date.now()) {
  const manager=['admin','gamemaster'].includes(user.role);
  const rows=state.employees.map(({id,name,department,role,points})=>({id,name,department,role,points,frozen:frozen(state,id)})).sort((a,b)=>b.points-a.points||a.id.localeCompare(b.id));
  const me=rows.find(row=>row.id===user.id);
  return {me,employees:rows,products:state.products,notices:state.notices,games,
    bids:state.bids.filter(row=>row.employeeId===user.id || user.role==='admin' || row.status==='won'),
    ledger:state.ledger.filter(row=>manager || row.employeeId===user.id),serverTime:now};
}

const assets={"/app.js":{"body":"'use strict';\nconst root=document.querySelector('#app');\nconst modal=document.querySelector('#modal');\nconst apiOrigin=window.WEIYA_API_ORIGIN || location.origin;\nconst crossOriginAPI=new URL(apiOrigin).origin!==location.origin;\nconst tokenKey='weiya-session:'+apiOrigin;\nlet state=null, needsSetup=false, adminTab='employees', selectedEmployee='', selectedGame='', pollTimer;\nlet cameraStream=null, cameraFrame=null, retryRequest=null;\nconst titles={home:'活动首页',points:'我的积分',ranking:'排行榜',auction:'竞标中心',announcements:'活动公告',bids:'我的出价',results:'得标结果',game:'关主加分',admin:'管理员后台'};\nconst icons={home:'◈',points:'▤',ranking:'★',auction:'◆',announcements:'☷',bids:'▣',results:'✦',game:'◎',admin:'⚙'};\nconst escape=value=>String(value??'').replace(/[&<>\"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[char]));\nconst date=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});\nconst roleName=role=>({admin:'管理员',gamemaster:'关主',employee:'员工'}[role]);\nconst currentPage=()=>location.hash.slice(1)||'home';\nconst person=id=>state.employees.find(row=>row.id===id);\nconst prize=id=>state.products.find(row=>row.id===id);\nconst available=person=>person.points-person.frozen;\nconst productStatus=product=>product.status==='closed'?'已结标':product.start>state.serverTime?'未开始':'竞标中';\nfunction toast(message) {\n  const node=document.querySelector('#toast'); node.textContent=message; node.classList.add('visible');\n  clearTimeout(toast.timer); toast.timer=setTimeout(()=>node.classList.remove('visible'),4500);\n}\nasync function api(path,body) {\n  const headers=body?{'Content-Type':'application/json'}:{};\n  const token=crossOriginAPI?sessionStorage.getItem(tokenKey):null;\n  if(token)headers.Authorization='Bearer '+token;\n  const response=await fetch(apiOrigin+'/api/'+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,credentials:crossOriginAPI?'omit':'same-origin'});\n  const data=await response.json();\n  if(!response.ok) { const error=new Error(data.error||'请求失败'); error.status=response.status; throw error; }\n  if(crossOriginAPI && path==='login' && data.token)sessionStorage.setItem(tokenKey,data.token);\n  if(crossOriginAPI && path==='logout')sessionStorage.removeItem(tokenKey);\n  return data;\n}\nasync function refresh(renderPage=true) {\n  state=await api('state');\n  if(renderPage) render();\n}\nfunction field(label,name,type='text',extra='') {return `<label for=\"${name}\">${label}</label><input id=\"${name}\" name=\"${name}\" type=\"${type}\" ${extra} required>`;}\nfunction formError(error,target) { const node=target?.querySelector('.error'); if(node) node.textContent=error.message; else toast(error.message); }\nfunction renderLogin() {\n  root.innerHTML=`<main class=\"login-shell\"><div class=\"login-box\"><section class=\"login-art\"><div class=\"eyebrow\">2027 · 年终相聚</div><div><h1>闯关积好礼<br>竞标迎新年</h1><p>尾牙积分竞技暨竞标平台</p></div><small>积分闯关 / 奖品竞标 / 得标揭晓</small></section><section class=\"login-form\"><h2>${needsSetup?'初始化管理员':'欢迎参加尾牙'}</h2><p>${needsSetup?'设置首位管理员 EMP001，开启活动筹备。':'使用管理员分配的工号和登录凭证。'}</p><form data-form=\"${needsSetup?'setup':'login'}\">${needsSetup?field('管理员姓名','name','text','maxlength=\"50\"')+field('部门','department','text','maxlength=\"50\"'):field('员工工号','id','text','autocomplete=\"username\" maxlength=\"16\" placeholder=\"EMP001\"')}${field(needsSetup?'设置管理员凭证（至少8位）':'登录凭证','password','password','minlength=\"8\" maxlength=\"128\" autocomplete=\"'+(needsSetup?'new-password':'current-password')+'\"')}<p class=\"error\" role=\"alert\"></p><button class=\"primary\">${needsSetup?'初始化平台':'登录平台'}</button></form><small>工号和凭证由活动管理员统一分配。</small></section></div></main>`;\n}\nfunction render() {\n  if(!state) return renderLogin();\n  const page=titles[currentPage()]?currentPage():'home';\n  const nav=Object.keys(titles).filter(key=>key!=='admin'||state.me.role==='admin').filter(key=>key!=='game'||['admin','gamemaster'].includes(state.me.role));\n  root.innerHTML=`<div class=\"shell\"><header class=\"topbar\"><div class=\"brand\"><span>2027</span> 尾牙积分平台</div><button data-action=\"logout\">退出登录</button></header><div class=\"layout\"><nav class=\"sidebar\" aria-label=\"功能导航\">${nav.map(key=>`<button data-page=\"${key}\" class=\"${page===key?'active':''}\" ${page===key?'aria-current=\"page\"':''}>${icons[key]} ${titles[key]}</button>`).join('')}</nav><main><div class=\"page-heading\"><h1>${titles[page]}</h1><span class=\"tag\">${escape(roleName(state.me.role))}</span></div>${content(page)}<p class=\"banner\">${escape(state.me.name)} · ${escape(state.me.id)} · 数据保存于云端<br>页面时间统一使用北京时间</p></main></div></div>`;\n}\nfunction stats(user,hero=false) {return `<div class=\"stats\"><div class=\"stat\">总积分<strong>${user.points}</strong></div><div class=\"stat\">已冻结<strong>${user.frozen}</strong></div><div class=\"stat\">可用积分<strong>${available(user)}</strong></div></div>`;}\nfunction notices() {return state.notices.map(row=>`<article class=\"card\"><h3>${escape(row.title)}</h3><p class=\"prewrap\">${escape(row.body)}</p></article>`).join('')||empty('暂无活动公告');}\nfunction empty(message) {return `<div class=\"card empty\">${message}</div>`;}\nfunction rowsLedger(rows) {return rows.map(row=>`<div class=\"row\"><div><strong>${escape(row.reason)}</strong><small>${escape(person(row.employeeId)?.name||row.employeeId)} · ${date(row.time)}<br>操作人 ${escape(row.actor)}</small></div><strong class=\"${row.amount>0?'positive':'negative'}\">${row.amount>0?'+':''}${row.amount}</strong></div>`).join('')||'<p class=\"empty\">暂无积分记录</p>';}\nfunction content(page) {\n  if(page==='home') return `<section class=\"card hero\"><div class=\"eyebrow\">2027 尾牙积分竞技暨竞标</div><h1>${escape(state.me.name)}，欢迎参加</h1><p>${escape(state.me.department)} · ${escape(state.me.id)} · 当前排名 #${state.employees.findIndex(row=>row.id===state.me.id)+1}</p>${stats(state.me,true)}<button class=\"gold\" data-action=\"badge\">出示我的工号二维码</button></section><div class=\"grid\"><section class=\"card\"><h3>闯关赢积分</h3><p>向关主出示工号，完成游戏后获得积分。每项游戏可记录一次。</p><button data-page=\"points\">查看积分明细</button></section><section class=\"card\"><h3>积分竞好礼</h3><p>使用可用积分出价，结标后揭晓得标结果。</p><button class=\"primary\" data-page=\"auction\">进入竞标中心</button></section></div><h2>活动公告</h2>${notices()}`;\n  if(page==='points') return `${stats(state.me)}<section class=\"card\"><h2>积分明细</h2>${rowsLedger(state.ledger.filter(row=>row.employeeId===state.me.id))}</section>`;\n  if(page==='ranking') return `<section class=\"card\"><p>按总积分排序，同分按工号排序。</p>${state.employees.map((row,index)=>`<div class=\"row\"><div class=\"rank-number ${index<3?'top':''}\">${index+1}</div><div class=\"grow\"><strong>${escape(row.name)} ${row.id===state.me.id?'<span class=\"tag\">我</span>':''}</strong><small>${escape(row.department)}</small></div><strong>${row.points} 分</strong></div>`).join('')}</section>`;\n  if(page==='announcements') return notices();\n  if(page==='auction') return `<div class=\"note\">出价额度会冻结。可提高已有出价，结标后按出价从高到低得标，同价以出价时间优先。每人每种奖品最多得标一件。</div>${stats(state.me)}<div class=\"grid\">${state.products.map(product=>`<article class=\"card prize\"><div class=\"prize-art\" aria-hidden=\"true\">🎁</div><div><span class=\"tag ${productStatus(product)==='竞标中'?'live':''}\">${productStatus(product)}</span><h3>${escape(product.name)}</h3><p>${escape(product.description)}</p><p class=\"small\">起标 ${product.minimum} 分 · 数量 ${product.quantity}<br>开始 ${date(product.start)}<br>结束 ${date(product.end)}</p></div><button class=\"primary\" data-action=\"bid\" data-id=\"${product.id}\" ${productStatus(product)!=='竞标中'?'disabled':''}>${productStatus(product)==='竞标中'?'提交 / 提高出价':productStatus(product)}</button></article>`).join('')}</div>${!state.products.length?empty('奖品尚未发布，请留意活动公告。'):''}`;\n  if(page==='bids') {\n    const mine=state.bids.filter(row=>row.employeeId===state.me.id);\n    return mine.length?`<section class=\"card\">${mine.map(row=>`<div class=\"row\"><div><strong>${escape(prize(row.productId)?.name)}</strong><small>${date(row.time)}</small><p>${row.status==='active'?'竞标中 · 额度已冻结':row.status==='won'?'已得标 · 积分已扣除':'未得标 · 冻结已释放'}</p></div><strong>${row.amount} 分</strong></div>`).join('')}</section>`:empty('你还没有提交出价，去竞标中心看看吧。');\n  }\n  if(page==='results') {\n    const closed=state.products.filter(row=>row.status==='closed');\n    return closed.length?closed.map(product=>`<section class=\"card\"><h2>${escape(product.name)}</h2><p>结标时间 ${date(product.closedAt)}</p>${state.bids.filter(row=>row.productId===product.id&&row.status==='won').map(row=>`<div class=\"row\"><div><strong>${escape(person(row.employeeId)?.name)}</strong><small>${escape(person(row.employeeId)?.department)}</small></div><strong>${row.amount} 分</strong></div>`).join('')||'<p>本奖品无人出价。</p>'}</section>`).join(''):empty('竞标结束后，得标结果会显示在这里。');\n  }\n  if(page==='game') return gamePage();\n  if(page==='admin') return adminPage();\n  return '';\n}\nfunction gamePage() {\n  if(!['admin','gamemaster'].includes(state.me.role)) return empty('当前账号无此权限');\n  const target=person(selectedEmployee);\n  if(!target) return `<section class=\"card\"><h2>查询员工</h2><button data-action=\"camera\">打开相机扫码</button><form data-form=\"lookup\">${field('员工工号（支持扫码枪输入）','employeeId','text','maxlength=\"16\" placeholder=\"EMP001\"')}<p class=\"error\" role=\"alert\"></p><button class=\"primary\">查询员工</button></form></section>`;\n  const logs=state.ledger.filter(row=>row.employeeId===target.id);\n  return `<section class=\"card\"><h2>${escape(target.name)}</h2><p>${escape(target.department)} · ${escape(target.id)}</p>${stats(target)}<div class=\"actions\"><button data-action=\"checkin\" ${logs.some(row=>row.kind==='checkin')?'disabled':''}>${logs.some(row=>row.kind==='checkin')?'已签到':'签到 +100分'}</button><button data-action=\"next\">查询下一位</button></div></section><section class=\"card\"><h2>选择游戏</h2><div class=\"game-options\">${state.games.map(game=>`<button data-action=\"game\" data-id=\"${escape(game)}\" ${logs.some(row=>row.game===game)?'disabled':''} class=\"${selectedGame===game?'active':''}\">${escape(game)} ${logs.some(row=>row.game===game)?'✓':''}</button>`).join('')}</div>${selectedGame?`<h3 class=\"section-gap\">${escape(selectedGame)} · 选择加分</h3><div class=\"actions\">${[10,20,30,50,100].map(amount=>`<button class=\"primary\" data-action=\"award\" data-id=\"${amount}\">+${amount} 分</button>`).join('')}</div>`:''}</section>`;\n}\nfunction adminPage() {\n  if(state.me.role!=='admin') return empty('当前账号无此权限');\n  const tabs={employees:'员工管理',products:'商品管理',notices:'公告管理',ledger:'积分记录'};\n  let body='';\n  if(adminTab==='employees') body=`<section class=\"card\"><div class=\"actions\"><button class=\"primary\" data-action=\"newEmployee\">新增员工</button><button data-action=\"import\">批量导入 CSV</button><button data-action=\"exportEmployees\">导出员工积分</button></div>${state.employees.map(row=>`<div class=\"row\"><div><strong>${escape(row.name)} · ${escape(row.id)}</strong><small>${escape(row.department)} · ${roleName(row.role)}<br>总积分 ${row.points} · 冻结 ${row.frozen}</small></div><button data-action=\"adjust\" data-id=\"${escape(row.id)}\">调整积分</button></div>`).join('')}</section>`;\n  if(adminTab==='products') body=`<section class=\"card\"><button class=\"primary\" data-action=\"newProduct\">新增奖品</button>${state.products.map(product=>`<div class=\"row\"><div><strong>${escape(product.name)}</strong><small>${productStatus(product)} · 起标 ${product.minimum} 分 · 数量 ${product.quantity}<br>结束 ${date(product.end)}</small></div>${product.status!=='closed'?`<button class=\"danger\" data-action=\"settle\" data-id=\"${product.id}\">提前结标</button>`:''}</div>`).join('')||'<p>暂无奖品</p>'}</section>`;\n  if(adminTab==='notices') body=`<section class=\"card\"><button class=\"primary\" data-action=\"newNotice\">发布公告</button></section>${notices()}`;\n  if(adminTab==='ledger') body=`<section class=\"card\"><button data-action=\"exportLedger\">导出积分记录 CSV</button>${rowsLedger(state.ledger)}</section>`;\n  return `<div class=\"tabs\">${Object.entries(tabs).map(([key,title])=>`<button data-tab=\"${key}\" class=\"${key===adminTab?'active':''}\">${title}</button>`).join('')}</div>${body}`;\n}\nfunction closeModal() {\n  if(cameraFrame) cancelAnimationFrame(cameraFrame);\n  cameraFrame=null;\n  if(cameraStream) cameraStream.getTracks().forEach(track=>track.stop());\n  cameraStream=null;\n  modal.close();\n}\nmodal.addEventListener('close',()=>{if(cameraStream) closeModal();});\nfunction showModal(title,body,form,button='确认提交') {\n  modal.innerHTML=`<h2>${title}</h2>${form?`<form data-form=\"${form}\">${body}<p class=\"error\" role=\"alert\"></p><div class=\"actions\"><button type=\"button\" data-action=\"close\">取消</button><button class=\"primary\">${button}</button></div></form>`:`${body}<div class=\"actions\"><button data-action=\"close\">关闭</button></div>`}`;\n  modal.showModal();\n}\nasync function action(name,data) {\n  const payload=JSON.stringify({action:name,data});\n  if(!retryRequest || retryRequest.payload!==payload) retryRequest={payload,requestId:crypto.randomUUID()};\n  const result=await api('action',{action:name,data,requestId:retryRequest.requestId});\n  retryRequest=null;\n  closeModal();\n  await refresh();\n  toast(result.message);\n  return result;\n}\nfunction csvDownload(filename,rows) {\n  const csv='\\uFEFF'+rows.map(row=>row.map(cell=>'\"'+String(cell??'').replaceAll('\"','\"\"').replace(/^[=+@\\-]/,\"'import {assets} from './assets.mjs';\")+'\"').join(',')).join('\\r\\n');\n  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));\n  const link=document.createElement('a'); link.href=url; link.download=filename; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);\n}\nfunction parseCSV(source) {\n  const rows=[]; let row=[],cell='',quoted=false;\n  source=source.replace(/^\\uFEFF/,'');\n  for(let index=0;index<source.length;index++) {\n    const char=source[index];\n    if(char==='\"') {if(quoted&&source[index+1]==='\"'){cell+='\"';index++;}else quoted=!quoted;}\n    else if(char===','&&!quoted){row.push(cell);cell='';}\n    else if((char==='\\n'||char==='\\r')&&!quoted){if(char==='\\r'&&source[index+1]==='\\n')index++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}\n    else cell+=char;\n  }\n  if(quoted) throw new Error('CSV 引号未闭合');\n  row.push(cell);if(row.some(Boolean)) rows.push(row);\n  const header=rows.shift()?.map(value=>value.trim());\n  const aliases={id:['工号','id'],name:['姓名','name'],department:['部门','department'],role:['角色','role'],password:['登录凭证','password']};\n  const indices=Object.fromEntries(Object.entries(aliases).map(([key,names])=>[key,header?.findIndex(value=>names.includes(value))??-1]));\n  if(['id','name','department'].some(key=>indices[key]===-1)) throw new Error('CSV 需包含工号、姓名、部门三列');\n  return rows.map(values=>Object.fromEntries(Object.entries(indices).map(([key,index])=>[key,index>=0?values[index]?.trim():undefined])));\n}\ndocument.addEventListener('click',async event=>{\n  const button=event.target.closest('button'); if(!button) return;\n  if(button.dataset.page){closeModal();location.hash=button.dataset.page;return;}\n  if(button.dataset.tab){adminTab=button.dataset.tab;render();return;}\n  const name=button.dataset.action,id=button.dataset.id;\n  if(!name)return;\n  try {\n    if(name==='close')return closeModal();\n    if(name==='logout'){await api('logout',{});state=null;location.hash='';render();return;}\n    if(name==='badge') {showModal('我的工号二维码',`<canvas id=\"badge\" width=\"232\" height=\"232\" aria-label=\"工号 ${escape(state.me.id)} 的二维码\"></canvas><p class=\"center\">${escape(state.me.name)} · ${escape(state.me.id)}</p><p>向关主出示此码，用于查询员工和登记积分。</p>`); drawQR(document.querySelector('#badge'),state.me.id);return;}\n    if(name==='bid'){\n      const product=prize(id),bid=state.bids.find(row=>row.productId===id&&row.employeeId===state.me.id&&row.status==='active');\n      showModal(escape(product.name),`<p>可用于此奖品的额度 ${available(state.me)+(bid?.amount||0)} 分。结标前可以提高出价。</p><input type=\"hidden\" name=\"productId\" value=\"${id}\">${field('出价积分','amount','number',`min=\"${bid?bid.amount+1:product.minimum}\" step=\"1\" max=\"${available(state.me)+(bid?.amount||0)}\"`)}`,'bid','确认出价');return;\n    }\n    if(name==='newEmployee')return showModal('新增员工',field('工号','id','text','maxlength=\"16\"')+field('姓名','name','text','maxlength=\"50\"')+field('部门','department','text','maxlength=\"50\"')+'<label for=\"role\">角色</label><select id=\"role\" name=\"role\"><option value=\"employee\">员工</option><option value=\"gamemaster\">关主</option><option value=\"admin\">管理员</option></select><p class=\"small\">系统将生成登录凭证，提交后请下载并私下发给本人。</p>','employee');\n    if(name==='import')return showModal('批量导入员工','<p>UTF-8 CSV 需包含工号、姓名、部门。可选角色列填写 employee、gamemaster 或 admin。每批最多1000位。</p><label for=\"file\">CSV 文件</label><input id=\"file\" name=\"file\" type=\"file\" accept=\".csv,text/csv\" required><p class=\"small\">导入后会提供新员工登录凭证下载。</p>','import','导入员工');\n    if(name==='adjust')return showModal('调整积分',`<p>${escape(person(id).name)} · 可用积分 ${available(person(id))}</p><input type=\"hidden\" name=\"employeeId\" value=\"${escape(id)}\">${field('调整分数（负数为扣分）','amount','number','min=\"-1000000\" max=\"1000000\" step=\"1\"')}${field('调整原因','reason','text','maxlength=\"200\"')}`,'adjust');\n    if(name==='newProduct')return showModal('新增竞标奖品',field('奖品名称','name','text','maxlength=\"80\"')+field('奖品说明','description','text','maxlength=\"500\"')+field('起标积分','minimum','number','min=\"1\" max=\"1000000\" step=\"1\"')+field('数量','quantity','number','min=\"1\" max=\"1000\" step=\"1\" value=\"1\"')+field('开始时间（本机时区）','start','datetime-local')+field('结束时间（本机时区）','end','datetime-local'),'product','发布奖品');\n    if(name==='settle')return showModal('确认提前结标',`<p>结标后将立即按出价排序产生得标结果，扣除得标积分并释放其余冻结额度。</p><p>奖品 ${escape(prize(id).name)}</p><input type=\"hidden\" name=\"productId\" value=\"${id}\">`,'settle','确认结标');\n    if(name==='newNotice')return showModal('发布活动公告',field('标题','title','text','maxlength=\"80\"')+'<label for=\"body\">公告内容</label><textarea id=\"body\" name=\"body\" maxlength=\"2000\" required></textarea>','notice','发布公告');\n    if(name==='next'){selectedEmployee='';selectedGame='';render();return;}\n    if(name==='game'){selectedGame=id;render();return;}\n    if(name==='award'||name==='checkin') {\n      button.disabled=true;\n      await action(name,name==='award'?{employeeId:selectedEmployee,game:selectedGame,amount:Number(id)}:{employeeId:selectedEmployee});\n      selectedGame='';render();return;\n    }\n    if(name==='exportEmployees')return csvDownload('员工积分.csv',[['工号','姓名','部门','角色','总积分','冻结积分'],...state.employees.map(row=>[row.id,row.name,row.department,row.role,row.points,row.frozen])]);\n    if(name==='exportLedger')return csvDownload('积分记录.csv',[['工号','原因','分数','操作人','时间'],...state.ledger.map(row=>[row.employeeId,row.reason,row.amount,row.actor,date(row.time)])]);\n    if(name==='camera') await scanCamera();\n  }catch(error){button.disabled=false;toast(error.message);}\n});\ndocument.addEventListener('submit',async event=>{\n  const form=event.target.closest('form[data-form]');if(!form)return;\n  event.preventDefault();\n  const button=form.querySelector('button[type=\"submit\"],button.primary');button.disabled=true;\n  const data=Object.fromEntries(new FormData(form));\n  try {\n    const type=form.dataset.form;\n    if(type==='setup'){await api('setup',data);needsSetup=false;renderLogin();toast('初始化成功，请使用 EMP001 登录');return;}\n    if(type==='login'){await api('login',data);await refresh();return;}\n    if(type==='lookup'){\n      const id=data.employeeId.trim().toUpperCase();\n      if(!person(id))throw new Error('未找到该员工');\n      selectedEmployee=id;selectedGame='';render();return;\n    }\n    if(type==='employee'||type==='import'){\n      const rows=type==='employee'?[data]:parseCSV(await data.file.text());\n      if(rows.some(row=>row.role==='admin')&&!confirm('本批员工包含管理员，将获得积分调整、员工导入和结标权限。确认继续？'))return;\n      const result=await action('employees',{rows});\n      if(result.credentials) {\n        showModal('员工导入完成','<p>请下载新员工登录凭证，妥善分发。关闭后无法再次查看。</p><button class=\"primary\" id=\"downloadCredentials\">下载登录凭证 CSV</button>');\n        document.querySelector('#downloadCredentials').addEventListener('click',()=>csvDownload('新员工登录凭证.csv',[['工号','姓名','登录凭证'],...result.credentials.map(row=>[row.id,row.name,row.password])]));\n      }\n      return;\n    }\n    if(type==='product'){data.start=new Date(data.start).toISOString();data.end=new Date(data.end).toISOString();}\n    await action(type,data);\n  }catch(error){formError(error,form);}\n  finally{button.disabled=false;}\n});\nasync function scanCamera() {\n  if(!('BarcodeDetector' in window))throw new Error('此浏览器暂不支持相机识码，请使用工号或扫码枪查询。');\n  showModal('扫描工号二维码','<video id=\"camera\" autoplay playsinline muted></video><p>将员工二维码置于画面中。</p>');\n  try {\n    cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});\n    if(!modal.open){cameraStream.getTracks().forEach(track=>track.stop());cameraStream=null;return;}\n    const video=document.querySelector('#camera');video.srcObject=cameraStream;await video.play();\n    const detector=new BarcodeDetector({formats:['qr_code']});\n    const scan=async()=>{\n      if(!cameraStream)return;\n      try {\n        const codes=await detector.detect(video);\n        const id=codes[0]?.rawValue.trim().toUpperCase();\n        if(id){if(!person(id))throw new Error('未找到二维码对应员工');selectedEmployee=id;selectedGame='';closeModal();render();return;}\n      }catch(error){closeModal();toast(error.message);return;}\n      cameraFrame=requestAnimationFrame(scan);\n    };\n    cameraFrame=requestAnimationFrame(scan);\n  }catch(error){closeModal();throw new Error('相机未能启动，请检查权限，或手动输入工号。');}\n}\nwindow.addEventListener('hashchange',()=>{closeModal();render();window.scrollTo(0,0);});\nasync function start() {\n  try {\n    const status=await api('status');needsSetup=status.needsSetup;\n    if(!needsSetup){try{await refresh();}catch(error){if(error.status!==401)throw error;renderLogin();}}\n    else renderLogin();\n    pollTimer=setInterval(async()=>{\n      if(!state||document.hidden||modal.open||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;\n      try{await refresh();}catch(error){if(error.status===401){state=null;renderLogin();}else toast(error.message);}\n    },15000);\n  }catch(error){root.innerHTML=`<main class=\"login-shell\"><section class=\"card\"><h1>连接暂时不可用</h1><p>${escape(error.message)}</p><button data-action=\"retry\">重新连接</button></section></main>`;root.querySelector('button').addEventListener('click',start,{once:true});}\n}\nstart();\n","type":"text/javascript;charset=utf-8"},"/index.html":{"body":"<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"theme-color\" content=\"#192d5b\"><title>2027 尾牙 · 积分竞技与竞标</title><link rel=\"stylesheet\" href=\"/style.css\"><script src=\"/qr.js\" defer></script><script src=\"/app.js\" defer></script></head><body><div id=\"app\"></div><dialog id=\"modal\"></dialog><div id=\"toast\" role=\"status\" aria-live=\"polite\"></div></body></html>\r\n","type":"text/html;charset=utf-8"},"/qr.js":{"body":"// Version 1-L byte-mode QR codes for employee IDs (up to 16 ASCII bytes).\nfunction employeeQR(value) {\n  const bytes=new TextEncoder().encode(value);\n  if(bytes.length>16)throw new Error('工号过长，无法生成二维码');\n  const bits=[];\n  const append=(number,count)=>{for(let index=count-1;index>=0;index--)bits.push((number>>>index)&1);};\n  append(4,4);append(bytes.length,8);bytes.forEach(byte=>append(byte,8));\n  append(0,Math.min(4,152-bits.length));\n  while(bits.length%8)bits.push(0);\n  const data=[];\n  for(let index=0;index<bits.length;index+=8)data.push(bits.slice(index,index+8).reduce((sum,bit)=>sum*2+bit,0));\n  while(data.length<19)data.push(data.length%2===(Math.ceil(bits.length/8)%2)?236:17);\n  const multiply=(a,b)=>{let result=0;for(let i=0;i<8;i++){if(b&1)result^=a;b>>>=1;a<<=1;if(a&256)a^=285;}return result;};\n  let generator=[1],power=1;\n  for(let degree=0;degree<7;degree++){\n    const next=Array(generator.length+1).fill(0);\n    generator.forEach((coefficient,index)=>{next[index]^=coefficient;next[index+1]^=multiply(coefficient,power);});\n    generator=next;power=multiply(power,2);\n  }\n  const remainder=[...data,...Array(7).fill(0)];\n  for(let index=0;index<data.length;index++){\n    const factor=remainder[index];\n    generator.forEach((coefficient,offset)=>{remainder[index+offset]^=multiply(coefficient,factor);});\n  }\n  const allBits=[];\n  for(const byte of [...data,...remainder.slice(-7)])for(let index=7;index>=0;index--)allBits.push((byte>>>index)&1);\n  const matrix=Array.from({length:21},()=>Array(21).fill(null));\n  const finder=(left,top)=>{for(let y=-1;y<=7;y++)for(let x=-1;x<=7;x++){\n    if(left+x<0||top+y<0||left+x>=21||top+y>=21)continue;\n    matrix[top+y][left+x]=x>=0&&x<=6&&y>=0&&y<=6&&(x===0||x===6||y===0||y===6||(x>=2&&x<=4&&y>=2&&y<=4));\n  }};\n  finder(0,0);finder(14,0);finder(0,14);\n  for(let index=8;index<13;index++){matrix[6][index]=index%2===0;matrix[index][6]=index%2===0;}\n  const format=0x77c4;\n  for(let index=0;index<15;index++){\n    const bit=!!((format>>>index)&1);\n    matrix[index<6?index:index<8?index+1:21-15+index][8]=bit;\n    matrix[8][index<8?20-index:index<9?15-index:14-index]=bit;\n  }\n  matrix[13][8]=true;\n  let cursor=0,up=true;\n  for(let right=20;right>0;right-=2){\n    if(right===6)right--;\n    for(let offset=0;offset<21;offset++){\n      const y=up?20-offset:offset;\n      for(let x=right;x>=right-1;x--)if(matrix[y][x]===null){matrix[y][x]=!!((allBits[cursor++]||0)^((x+y)%2===0?1:0));}\n    }\n    up=!up;\n  }\n  return matrix;\n}\nfunction drawQR(canvas,value) {\n  const matrix=employeeQR(value),context=canvas.getContext('2d');\n  const scale=8;canvas.width=232;canvas.height=232;\n  context.fillStyle='#fff';context.fillRect(0,0,232,232);context.fillStyle='#102449';\n  matrix.forEach((row,y)=>row.forEach((dark,x)=>{if(dark)context.fillRect((x+4)*scale,(y+4)*scale,scale,scale);}));\n}\n","type":"text/javascript;charset=utf-8"},"/style.css":{"body":"*{box-sizing:border-box}body{margin:0;background:#f3f5fa;color:#1d2c4b;font:16px/1.55 system-ui,-apple-system,\"Microsoft YaHei\",sans-serif}button,input,select,textarea{font:inherit}button{cursor:pointer;border:0;border-radius:10px;padding:10px 16px;background:#e9edf5;color:#253859;font-weight:600}button:hover{filter:brightness(.96)}button:disabled{cursor:not-allowed;opacity:.5}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid #6e95ee;outline-offset:3px}input,select,textarea{display:block;width:100%;padding:12px;border:1px solid #ccd3e1;border-radius:9px;background:white;color:#1d2c4b}textarea{min-height:90px}label{display:block;margin:16px 0 6px;font-size:.9rem;font-weight:600}h1,h2,h3,p{margin-top:0}h1{font-size:2rem;line-height:1.2}h2{font-size:1.5rem}h3{font-size:1.05rem}p{color:#5e6c84}.primary{background:#254fa3;color:white}.gold{background:#ffe1a1;color:#66410a}.danger{background:#fce8e8;color:#9b2929}.muted,small{color:#65738b}.small{font-size:.875rem}.shell{max-width:1200px;margin:auto;padding:28px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:26px}.brand{font-weight:800;letter-spacing:.03em}.brand span{color:#b47821}.topbar button{background:white}.layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:28px}.sidebar{position:sticky;top:20px;align-self:start}.sidebar button{display:block;width:100%;text-align:left;margin-bottom:6px;background:transparent;padding:13px 16px}.sidebar button.active{background:#1d3568;color:white}.card{background:white;border:1px solid #e1e6ef;border-radius:16px;padding:24px;margin-bottom:20px}.hero{background:linear-gradient(115deg,#172d5b,#2b4e8a);color:white;padding:30px;border:0}.hero p,.hero small{color:#d6e1f5}.hero h1{margin:10px 0}.eyebrow{font-size:.875rem;letter-spacing:.08em;font-weight:650}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:20px 0}.stat{background:#f6f8fc;border-radius:12px;padding:18px}.stat strong{display:block;font-size:1.9rem;color:#213f7b}.hero .stat{background:#ffffff12}.hero .stat strong{color:#fff}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.prize{margin:0;display:flex;flex-direction:column}.prize-art{height:115px;display:grid;place-items:center;background:#eef2fa;border-radius:10px;margin-bottom:16px;font-size:3rem}.prize h3{font-size:1.25rem;margin-bottom:8px}.prize .primary{margin-top:auto}.row{display:flex;justify-content:space-between;align-items:center;gap:16px;border-bottom:1px solid #edf0f5;padding:14px 0}.row:last-child{border-bottom:0}.row p{margin:4px 0 0}.row strong{display:block}.tag{display:inline-block;font-size:.875rem;padding:3px 9px;border-radius:6px;background:#edf2fa;color:#34558d}.tag.live{background:#e0f4eb;color:#176143}.positive{color:#14845c}.negative{color:#b14646}.actions{display:flex;flex-wrap:wrap;gap:10px}.empty{padding:32px 16px;text-align:center;color:#65738b}.login-shell{min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at top left,#e0e9fc,transparent 65%),#f3f5fa}.login-box{width:min(960px,100%);display:grid;grid-template-columns:1fr 1fr;border-radius:24px;overflow:hidden;box-shadow:0 25px 100px #142a5518;background:white}.login-art{background:linear-gradient(145deg,#172c59,#315591);color:white;padding:48px;display:flex;flex-direction:column;justify-content:space-between;min-height:540px}.login-art h1{font-size:3rem;margin:28px 0 20px}.login-art p{color:#cfdbef}.login-form{padding:48px;align-self:center}.login-form .primary{width:100%;margin:24px 0 12px}.error{color:#aa3434;margin-top:12px}.error:empty{display:none}.banner{font-size:.875rem;color:#5c6f8e;margin:24px 0 0}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}.tabs .active{background:#254fa3;color:white}dialog{width:min(500px,calc(100% - 32px));border:0;border-radius:18px;padding:28px;color:#1d2c4b;box-shadow:0 30px 100px #182d5a33}dialog::backdrop{background:#0d1c3b80}dialog .actions{margin-top:24px;justify-content:flex-end}dialog img{width:220px;height:220px;display:block;margin:auto}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:14px 12px;border-bottom:1px solid #edf0f5;white-space:nowrap}th{font-size:.875rem;color:#65738b}#toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#172e5c;color:#fff;padding:12px 24px;border-radius:10px;max-width:90%;display:none;z-index:10}#toast.visible{display:block}.rank-number{width:34px;height:34px;display:grid;place-items:center;border-radius:50%;background:#eaf0fc;font-weight:800}.rank-number.top{background:#ffe7ad;color:#845a11}.timeline{border-left:2px solid #dfe6f3;padding-left:24px}.timeline div{margin:20px 0}.timeline strong{display:block}video{width:100%;border-radius:12px}.game-options{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.game-options .active{background:#254fa3;color:white}.page-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px}.page-heading h1{margin:0}.note{background:#fff6e5;border:1px solid #f1dfb9;padding:14px 18px;border-radius:10px;color:#795920;font-size:.875rem;margin-bottom:20px}@media(max-width:760px){.shell{padding:18px}.layout{grid-template-columns:1fr;gap:18px}.sidebar{position:static;display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.sidebar button{text-align:center;padding:10px 4px;font-size:.875rem;margin:0}.hero{padding:24px}.grid{gap:14px}.card{padding:20px}.stats{gap:8px}.stat{padding:12px}.stat strong{font-size:1.5rem}.login-box{grid-template-columns:1fr}.login-art{min-height:auto;padding:28px}.login-art h1{font-size:2.4rem;margin:20px 0 12px}.login-form{padding:28px}.topbar{margin-bottom:18px}.row{align-items:flex-start}.prize-art{height:90px}}@media(max-width:430px){.grid{grid-template-columns:1fr}.stats .stat{padding:10px;font-size:.875rem}.hero h1{font-size:1.8rem}}\n.grow{flex:1}.center{text-align:center}.prewrap{white-space:pre-wrap}.section-gap{margin-top:24px}#badge{display:block;margin:auto;width:232px;height:232px}\r\n","type":"text/css;charset=utf-8"}};

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
