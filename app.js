'use strict';
const root=document.querySelector('#app');
const modal=document.querySelector('#modal');
const apiOrigin=window.WEIYA_API_ORIGIN || location.origin;
const crossOriginAPI=new URL(apiOrigin).origin!==location.origin;
const tokenKey='weiya-session:'+apiOrigin;
let state=null, needsSetup=false, adminTab='employees', selectedEmployee='', selectedGame='', pollTimer;
let cameraStream=null, cameraFrame=null, retryRequest=null;
const titles={home:'活动首页',points:'我的积分',ranking:'排行榜',auction:'竞标中心',announcements:'活动公告',bids:'我的出价',results:'得标结果',game:'关主加分',admin:'管理员后台'};
const icons={home:'◈',points:'▤',ranking:'★',auction:'◆',announcements:'☷',bids:'▣',results:'✦',game:'◎',admin:'⚙'};
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const date=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const roleName=role=>({admin:'管理员',gamemaster:'关主',employee:'员工'}[role]);
const currentPage=()=>location.hash.slice(1)||'home';
const person=id=>state.employees.find(row=>row.id===id);
const prize=id=>state.products.find(row=>row.id===id);
const available=person=>person.points-person.frozen;
const productStatus=product=>product.status==='closed'?'已结标':product.start>state.serverTime?'未开始':'竞标中';
function toast(message) {
  const node=document.querySelector('#toast'); node.textContent=message; node.classList.add('visible');
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>node.classList.remove('visible'),4500);
}
async function api(path,body) {
  const headers=body?{'Content-Type':'application/json'}:{};
  const token=crossOriginAPI?sessionStorage.getItem(tokenKey):null;
  if(token)headers.Authorization='Bearer '+token;
  const response=await fetch(apiOrigin+'/api/'+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,credentials:crossOriginAPI?'omit':'same-origin'});
  const data=await response.json();
  if(!response.ok) { const error=new Error(data.error||'请求失败'); error.status=response.status; throw error; }
  if(crossOriginAPI && path==='login' && data.token)sessionStorage.setItem(tokenKey,data.token);
  if(crossOriginAPI && path==='logout')sessionStorage.removeItem(tokenKey);
  return data;
}
async function refresh(renderPage=true) {
  state=await api('state');
  if(renderPage) render();
}
function field(label,name,type='text',extra='') {return `<label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" ${extra} required>`;}
function formError(error,target) { const node=target?.querySelector('.error'); if(node) node.textContent=error.message; else toast(error.message); }
function renderLogin() {
  root.innerHTML=`<main class="login-shell"><div class="login-box"><section class="login-art"><div class="eyebrow">2027 · 年终相聚</div><div><h1>闯关积好礼<br>竞标迎新年</h1><p>尾牙积分竞技暨竞标平台</p></div><small>积分闯关 / 奖品竞标 / 得标揭晓</small></section><section class="login-form"><h2>${needsSetup?'初始化管理员':'欢迎参加尾牙'}</h2><p>${needsSetup?'设置首位管理员 EMP001，开启活动筹备。':'使用管理员分配的工号和登录凭证。'}</p><form data-form="${needsSetup?'setup':'login'}">${needsSetup?field('管理员姓名','name','text','maxlength="50"')+field('部门','department','text','maxlength="50"'):field('员工工号','id','text','autocomplete="username" maxlength="16" placeholder="EMP001"')}${field(needsSetup?'设置管理员凭证（至少8位）':'登录凭证','password','password','minlength="8" maxlength="128" autocomplete="'+(needsSetup?'new-password':'current-password')+'"')}<p class="error" role="alert"></p><button class="primary">${needsSetup?'初始化平台':'登录平台'}</button></form><small>工号和凭证由活动管理员统一分配。</small></section></div></main>`;
}
function render() {
  if(!state) return renderLogin();
  const page=titles[currentPage()]?currentPage():'home';
  const nav=Object.keys(titles).filter(key=>key!=='admin'||state.me.role==='admin').filter(key=>key!=='game'||['admin','gamemaster'].includes(state.me.role));
  root.innerHTML=`<div class="shell"><header class="topbar"><div class="brand"><span>2027</span> 尾牙积分平台</div><button data-action="logout">退出登录</button></header><div class="layout"><nav class="sidebar" aria-label="功能导航">${nav.map(key=>`<button data-page="${key}" class="${page===key?'active':''}" ${page===key?'aria-current="page"':''}>${icons[key]} ${titles[key]}</button>`).join('')}</nav><main><div class="page-heading"><h1>${titles[page]}</h1><span class="tag">${escape(roleName(state.me.role))}</span></div>${content(page)}<p class="banner">${escape(state.me.name)} · ${escape(state.me.id)} · 数据保存于云端<br>页面时间统一使用北京时间</p></main></div></div>`;
}
function stats(user,hero=false) {return `<div class="stats"><div class="stat">总积分<strong>${user.points}</strong></div><div class="stat">已冻结<strong>${user.frozen}</strong></div><div class="stat">可用积分<strong>${available(user)}</strong></div></div>`;}
function notices() {return state.notices.map(row=>`<article class="card"><h3>${escape(row.title)}</h3><p class="prewrap">${escape(row.body)}</p></article>`).join('')||empty('暂无活动公告');}
function empty(message) {return `<div class="card empty">${message}</div>`;}
function rowsLedger(rows) {return rows.map(row=>`<div class="row"><div><strong>${escape(row.reason)}</strong><small>${escape(person(row.employeeId)?.name||row.employeeId)} · ${date(row.time)}<br>操作人 ${escape(row.actor)}</small></div><strong class="${row.amount>0?'positive':'negative'}">${row.amount>0?'+':''}${row.amount}</strong></div>`).join('')||'<p class="empty">暂无积分记录</p>';}
function content(page) {
  if(page==='home') return `<section class="card hero"><div class="eyebrow">2027 尾牙积分竞技暨竞标</div><h1>${escape(state.me.name)}，欢迎参加</h1><p>${escape(state.me.department)} · ${escape(state.me.id)} · 当前排名 #${state.employees.findIndex(row=>row.id===state.me.id)+1}</p>${stats(state.me,true)}<button class="gold" data-action="badge">出示我的工号二维码</button></section><div class="grid"><section class="card"><h3>闯关赢积分</h3><p>向关主出示工号，完成游戏后获得积分。每项游戏可记录一次。</p><button data-page="points">查看积分明细</button></section><section class="card"><h3>积分竞好礼</h3><p>使用可用积分出价，结标后揭晓得标结果。</p><button class="primary" data-page="auction">进入竞标中心</button></section></div><h2>活动公告</h2>${notices()}`;
  if(page==='points') return `${stats(state.me)}<section class="card"><h2>积分明细</h2>${rowsLedger(state.ledger.filter(row=>row.employeeId===state.me.id))}</section>`;
  if(page==='ranking') return `<section class="card"><p>按总积分排序，同分按工号排序。</p>${state.employees.map((row,index)=>`<div class="row"><div class="rank-number ${index<3?'top':''}">${index+1}</div><div class="grow"><strong>${escape(row.name)} ${row.id===state.me.id?'<span class="tag">我</span>':''}</strong><small>${escape(row.department)}</small></div><strong>${row.points} 分</strong></div>`).join('')}</section>`;
  if(page==='announcements') return notices();
  if(page==='auction') return `<div class="note">出价额度会冻结。可提高已有出价，结标后按出价从高到低得标，同价以出价时间优先。每人每种奖品最多得标一件。</div>${stats(state.me)}<div class="grid">${state.products.map(product=>`<article class="card prize"><div class="prize-art" aria-hidden="true">🎁</div><div><span class="tag ${productStatus(product)==='竞标中'?'live':''}">${productStatus(product)}</span><h3>${escape(product.name)}</h3><p>${escape(product.description)}</p><p class="small">起标 ${product.minimum} 分 · 数量 ${product.quantity}<br>开始 ${date(product.start)}<br>结束 ${date(product.end)}</p></div><button class="primary" data-action="bid" data-id="${product.id}" ${productStatus(product)!=='竞标中'?'disabled':''}>${productStatus(product)==='竞标中'?'提交 / 提高出价':productStatus(product)}</button></article>`).join('')}</div>${!state.products.length?empty('奖品尚未发布，请留意活动公告。'):''}`;
  if(page==='bids') {
    const mine=state.bids.filter(row=>row.employeeId===state.me.id);
    return mine.length?`<section class="card">${mine.map(row=>`<div class="row"><div><strong>${escape(prize(row.productId)?.name)}</strong><small>${date(row.time)}</small><p>${row.status==='active'?'竞标中 · 额度已冻结':row.status==='won'?'已得标 · 积分已扣除':'未得标 · 冻结已释放'}</p></div><strong>${row.amount} 分</strong></div>`).join('')}</section>`:empty('你还没有提交出价，去竞标中心看看吧。');
  }
  if(page==='results') {
    const closed=state.products.filter(row=>row.status==='closed');
    return closed.length?closed.map(product=>`<section class="card"><h2>${escape(product.name)}</h2><p>结标时间 ${date(product.closedAt)}</p>${state.bids.filter(row=>row.productId===product.id&&row.status==='won').map(row=>`<div class="row"><div><strong>${escape(person(row.employeeId)?.name)}</strong><small>${escape(person(row.employeeId)?.department)}</small></div><strong>${row.amount} 分</strong></div>`).join('')||'<p>本奖品无人出价。</p>'}</section>`).join(''):empty('竞标结束后，得标结果会显示在这里。');
  }
  if(page==='game') return gamePage();
  if(page==='admin') return adminPage();
  return '';
}
function gamePage() {
  if(!['admin','gamemaster'].includes(state.me.role)) return empty('当前账号无此权限');
  const target=person(selectedEmployee);
  if(!target) return `<section class="card"><h2>查询员工</h2><button data-action="camera">打开相机扫码</button><form data-form="lookup">${field('员工工号（支持扫码枪输入）','employeeId','text','maxlength="16" placeholder="EMP001"')}<p class="error" role="alert"></p><button class="primary">查询员工</button></form></section>`;
  const logs=state.ledger.filter(row=>row.employeeId===target.id);
  return `<section class="card"><h2>${escape(target.name)}</h2><p>${escape(target.department)} · ${escape(target.id)}</p>${stats(target)}<div class="actions"><button data-action="checkin" ${logs.some(row=>row.kind==='checkin')?'disabled':''}>${logs.some(row=>row.kind==='checkin')?'已签到':'签到 +100分'}</button><button data-action="next">查询下一位</button></div></section><section class="card"><h2>选择游戏</h2><div class="game-options">${state.games.map(game=>`<button data-action="game" data-id="${escape(game)}" ${logs.some(row=>row.game===game)?'disabled':''} class="${selectedGame===game?'active':''}">${escape(game)} ${logs.some(row=>row.game===game)?'✓':''}</button>`).join('')}</div>${selectedGame?`<h3 class="section-gap">${escape(selectedGame)} · 选择加分</h3><div class="actions">${[10,20,30,50,100].map(amount=>`<button class="primary" data-action="award" data-id="${amount}">+${amount} 分</button>`).join('')}</div>`:''}</section>`;
}
function adminPage() {
  if(state.me.role!=='admin') return empty('当前账号无此权限');
  const tabs={employees:'员工管理',products:'商品管理',notices:'公告管理',ledger:'积分记录'};
  let body='';
  if(adminTab==='employees') body=`<section class="card"><div class="actions"><button class="primary" data-action="newEmployee">新增员工</button><button data-action="import">批量导入 CSV</button><button data-action="exportEmployees">导出员工积分</button></div>${state.employees.map(row=>`<div class="row"><div><strong>${escape(row.name)} · ${escape(row.id)}</strong><small>${escape(row.department)} · ${roleName(row.role)}<br>总积分 ${row.points} · 冻结 ${row.frozen}</small></div><button data-action="adjust" data-id="${escape(row.id)}">调整积分</button></div>`).join('')}</section>`;
  if(adminTab==='products') body=`<section class="card"><button class="primary" data-action="newProduct">新增奖品</button>${state.products.map(product=>`<div class="row"><div><strong>${escape(product.name)}</strong><small>${productStatus(product)} · 起标 ${product.minimum} 分 · 数量 ${product.quantity}<br>结束 ${date(product.end)}</small></div>${product.status!=='closed'?`<button class="danger" data-action="settle" data-id="${product.id}">提前结标</button>`:''}</div>`).join('')||'<p>暂无奖品</p>'}</section>`;
  if(adminTab==='notices') body=`<section class="card"><button class="primary" data-action="newNotice">发布公告</button></section>${notices()}`;
  if(adminTab==='ledger') body=`<section class="card"><button data-action="exportLedger">导出积分记录 CSV</button>${rowsLedger(state.ledger)}</section>`;
  return `<div class="tabs">${Object.entries(tabs).map(([key,title])=>`<button data-tab="${key}" class="${key===adminTab?'active':''}">${title}</button>`).join('')}</div>${body}`;
}
function closeModal() {
  if(cameraFrame) cancelAnimationFrame(cameraFrame);
  cameraFrame=null;
  if(cameraStream) cameraStream.getTracks().forEach(track=>track.stop());
  cameraStream=null;
  modal.close();
}
modal.addEventListener('close',()=>{if(cameraStream) closeModal();});
function showModal(title,body,form,button='确认提交') {
  modal.innerHTML=`<h2>${title}</h2>${form?`<form data-form="${form}">${body}<p class="error" role="alert"></p><div class="actions"><button type="button" data-action="close">取消</button><button class="primary">${button}</button></div></form>`:`${body}<div class="actions"><button data-action="close">关闭</button></div>`}`;
  modal.showModal();
}
async function action(name,data) {
  const payload=JSON.stringify({action:name,data});
  if(!retryRequest || retryRequest.payload!==payload) retryRequest={payload,requestId:crypto.randomUUID()};
  const result=await api('action',{action:name,data,requestId:retryRequest.requestId});
  retryRequest=null;
  closeModal();
  await refresh();
  toast(result.message);
  return result;
}
function csvDownload(filename,rows) {
  const csv='\uFEFF'+rows.map(row=>row.map(cell=>'"'+String(cell??'').replaceAll('"','""').replace(/^[=+@\-]/,"'$&")+'"').join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a'); link.href=url; link.download=filename; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function parseCSV(source) {
  const rows=[]; let row=[],cell='',quoted=false;
  source=source.replace(/^\uFEFF/,'');
  for(let index=0;index<source.length;index++) {
    const char=source[index];
    if(char==='"') {if(quoted&&source[index+1]==='"'){cell+='"';index++;}else quoted=!quoted;}
    else if(char===','&&!quoted){row.push(cell);cell='';}
    else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&source[index+1]==='\n')index++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}
    else cell+=char;
  }
  if(quoted) throw new Error('CSV 引号未闭合');
  row.push(cell);if(row.some(Boolean)) rows.push(row);
  const header=rows.shift()?.map(value=>value.trim());
  const aliases={id:['工号','id'],name:['姓名','name'],department:['部门','department'],role:['角色','role'],password:['登录凭证','password']};
  const indices=Object.fromEntries(Object.entries(aliases).map(([key,names])=>[key,header?.findIndex(value=>names.includes(value))??-1]));
  if(['id','name','department'].some(key=>indices[key]===-1)) throw new Error('CSV 需包含工号、姓名、部门三列');
  return rows.map(values=>Object.fromEntries(Object.entries(indices).map(([key,index])=>[key,index>=0?values[index]?.trim():undefined])));
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('button'); if(!button) return;
  if(button.dataset.page){closeModal();location.hash=button.dataset.page;return;}
  if(button.dataset.tab){adminTab=button.dataset.tab;render();return;}
  const name=button.dataset.action,id=button.dataset.id;
  if(!name)return;
  try {
    if(name==='close')return closeModal();
    if(name==='logout'){await api('logout',{});state=null;location.hash='';render();return;}
    if(name==='badge') {showModal('我的工号二维码',`<canvas id="badge" width="232" height="232" aria-label="工号 ${escape(state.me.id)} 的二维码"></canvas><p class="center">${escape(state.me.name)} · ${escape(state.me.id)}</p><p>向关主出示此码，用于查询员工和登记积分。</p>`); drawQR(document.querySelector('#badge'),state.me.id);return;}
    if(name==='bid'){
      const product=prize(id),bid=state.bids.find(row=>row.productId===id&&row.employeeId===state.me.id&&row.status==='active');
      showModal(escape(product.name),`<p>可用于此奖品的额度 ${available(state.me)+(bid?.amount||0)} 分。结标前可以提高出价。</p><input type="hidden" name="productId" value="${id}">${field('出价积分','amount','number',`min="${bid?bid.amount+1:product.minimum}" step="1" max="${available(state.me)+(bid?.amount||0)}"`)}`,'bid','确认出价');return;
    }
    if(name==='newEmployee')return showModal('新增员工',field('工号','id','text','maxlength="16"')+field('姓名','name','text','maxlength="50"')+field('部门','department','text','maxlength="50"')+'<label for="role">角色</label><select id="role" name="role"><option value="employee">员工</option><option value="gamemaster">关主</option><option value="admin">管理员</option></select><p class="small">系统将生成登录凭证，提交后请下载并私下发给本人。</p>','employee');
    if(name==='import')return showModal('批量导入员工','<p>UTF-8 CSV 需包含工号、姓名、部门。可选角色列填写 employee、gamemaster 或 admin。每批最多1000位。</p><label for="file">CSV 文件</label><input id="file" name="file" type="file" accept=".csv,text/csv" required><p class="small">导入后会提供新员工登录凭证下载。</p>','import','导入员工');
    if(name==='adjust')return showModal('调整积分',`<p>${escape(person(id).name)} · 可用积分 ${available(person(id))}</p><input type="hidden" name="employeeId" value="${escape(id)}">${field('调整分数（负数为扣分）','amount','number','min="-1000000" max="1000000" step="1"')}${field('调整原因','reason','text','maxlength="200"')}`,'adjust');
    if(name==='newProduct')return showModal('新增竞标奖品',field('奖品名称','name','text','maxlength="80"')+field('奖品说明','description','text','maxlength="500"')+field('起标积分','minimum','number','min="1" max="1000000" step="1"')+field('数量','quantity','number','min="1" max="1000" step="1" value="1"')+field('开始时间（本机时区）','start','datetime-local')+field('结束时间（本机时区）','end','datetime-local'),'product','发布奖品');
    if(name==='settle')return showModal('确认提前结标',`<p>结标后将立即按出价排序产生得标结果，扣除得标积分并释放其余冻结额度。</p><p>奖品 ${escape(prize(id).name)}</p><input type="hidden" name="productId" value="${id}">`,'settle','确认结标');
    if(name==='newNotice')return showModal('发布活动公告',field('标题','title','text','maxlength="80"')+'<label for="body">公告内容</label><textarea id="body" name="body" maxlength="2000" required></textarea>','notice','发布公告');
    if(name==='next'){selectedEmployee='';selectedGame='';render();return;}
    if(name==='game'){selectedGame=id;render();return;}
    if(name==='award'||name==='checkin') {
      button.disabled=true;
      await action(name,name==='award'?{employeeId:selectedEmployee,game:selectedGame,amount:Number(id)}:{employeeId:selectedEmployee});
      selectedGame='';render();return;
    }
    if(name==='exportEmployees')return csvDownload('员工积分.csv',[['工号','姓名','部门','角色','总积分','冻结积分'],...state.employees.map(row=>[row.id,row.name,row.department,row.role,row.points,row.frozen])]);
    if(name==='exportLedger')return csvDownload('积分记录.csv',[['工号','原因','分数','操作人','时间'],...state.ledger.map(row=>[row.employeeId,row.reason,row.amount,row.actor,date(row.time)])]);
    if(name==='camera') await scanCamera();
  }catch(error){button.disabled=false;toast(error.message);}
});
document.addEventListener('submit',async event=>{
  const form=event.target.closest('form[data-form]');if(!form)return;
  event.preventDefault();
  const button=form.querySelector('button[type="submit"],button.primary');button.disabled=true;
  const data=Object.fromEntries(new FormData(form));
  try {
    const type=form.dataset.form;
    if(type==='setup'){await api('setup',data);needsSetup=false;renderLogin();toast('初始化成功，请使用 EMP001 登录');return;}
    if(type==='login'){await api('login',data);await refresh();return;}
    if(type==='lookup'){
      const id=data.employeeId.trim().toUpperCase();
      if(!person(id))throw new Error('未找到该员工');
      selectedEmployee=id;selectedGame='';render();return;
    }
    if(type==='employee'||type==='import'){
      const rows=type==='employee'?[data]:parseCSV(await data.file.text());
      if(rows.some(row=>row.role==='admin')&&!confirm('本批员工包含管理员，将获得积分调整、员工导入和结标权限。确认继续？'))return;
      const result=await action('employees',{rows});
      if(result.credentials) {
        showModal('员工导入完成','<p>请下载新员工登录凭证，妥善分发。关闭后无法再次查看。</p><button class="primary" id="downloadCredentials">下载登录凭证 CSV</button>');
        document.querySelector('#downloadCredentials').addEventListener('click',()=>csvDownload('新员工登录凭证.csv',[['工号','姓名','登录凭证'],...result.credentials.map(row=>[row.id,row.name,row.password])]));
      }
      return;
    }
    if(type==='product'){data.start=new Date(data.start).toISOString();data.end=new Date(data.end).toISOString();}
    await action(type,data);
  }catch(error){formError(error,form);}
  finally{button.disabled=false;}
});
async function scanCamera() {
  if(!('BarcodeDetector' in window))throw new Error('此浏览器暂不支持相机识码，请使用工号或扫码枪查询。');
  showModal('扫描工号二维码','<video id="camera" autoplay playsinline muted></video><p>将员工二维码置于画面中。</p>');
  try {
    cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    if(!modal.open){cameraStream.getTracks().forEach(track=>track.stop());cameraStream=null;return;}
    const video=document.querySelector('#camera');video.srcObject=cameraStream;await video.play();
    const detector=new BarcodeDetector({formats:['qr_code']});
    const scan=async()=>{
      if(!cameraStream)return;
      try {
        const codes=await detector.detect(video);
        const id=codes[0]?.rawValue.trim().toUpperCase();
        if(id){if(!person(id))throw new Error('未找到二维码对应员工');selectedEmployee=id;selectedGame='';closeModal();render();return;}
      }catch(error){closeModal();toast(error.message);return;}
      cameraFrame=requestAnimationFrame(scan);
    };
    cameraFrame=requestAnimationFrame(scan);
  }catch(error){closeModal();throw new Error('相机未能启动，请检查权限，或手动输入工号。');}
}
window.addEventListener('hashchange',()=>{closeModal();render();window.scrollTo(0,0);});
async function start() {
  try {
    const status=await api('status');needsSetup=status.needsSetup;
    if(!needsSetup){try{await refresh();}catch(error){if(error.status!==401)throw error;renderLogin();}}
    else renderLogin();
    pollTimer=setInterval(async()=>{
      if(!state||document.hidden||modal.open||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;
      try{await refresh();}catch(error){if(error.status===401){state=null;renderLogin();}else toast(error.message);}
    },15000);
  }catch(error){root.innerHTML=`<main class="login-shell"><section class="card"><h1>连接暂时不可用</h1><p>${escape(error.message)}</p><button data-action="retry">重新连接</button></section></main>`;root.querySelector('button').addEventListener('click',start,{once:true});}
}
start();
