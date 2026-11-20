export const games = ['套圈圈','飞镖','九宫格投球','神射手','趣味闯关'];
export const initialState = () => ({ employees:[], products:[], bids:[], ledger:[], notices:[{id:'welcome',title:'欢迎参加 2027 尾牙',body:'签到后参与闯关，用获得的积分竞标心仪奖品。'},{id:'schedule',title:'活动流程',body:'18:00 签到 · 18:30 闯关游戏 · 20:00 积分竞标 · 21:00 结标'}], sessions:[], attempts:{}, receipts:[] });
export function fail(message, status=400) { throw Object.assign(new Error(message), {status}); }
export function text(value, max=100) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail('请检查必填文字和长度');
  return value.trim();
}
export function integer(value, min=0, max=1000000) {
  const number = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isSafeInteger(number) || number < min || number > max) fail('积分或数量超出允许范围');
  return number;
}
export function employeeId(value) {
  const id = text(value,16).toUpperCase();
  if (!/^[A-Z0-9_-]+$/.test(id)) fail('工号须为不超过16位的字母、数字、下划线或连字符');
  return id;
}
export function requireRole(user, roles) { if (!user || !roles.includes(user.role)) fail('当前账号无此操作权限',403); }
export function employee(state,id) {
  const found = state.employees.find(row => row.id === id);
  if (!found) fail('未找到该员工',404);
  return found;
}
export function frozen(state,id) {
  return state.bids.filter(bid => bid.employeeId===id && bid.status==='active').reduce((sum,bid)=>sum+bid.amount,0);
}
export function available(state,id) { return employee(state,id).points - frozen(state,id); }
export function addPoints(state,id,amount,reason,actor,now) {
  const target=employee(state,id);
  target.points += amount;
  state.ledger.unshift({id:crypto.randomUUID(),employeeId:id,amount,reason,actor,time:now});
}
export function settle(state,product,actor,now) {
  if (product.status==='closed') return;
  const bids=state.bids.filter(bid=>bid.productId===product.id && bid.status==='active').sort((a,b)=>b.amount-a.amount || a.time-b.time || (a.order||0)-(b.order||0));
  for (const [index,bid] of bids.entries()) {
    bid.status=index<product.quantity ? 'won':'lost';
    if (bid.status==='won') addPoints(state,bid.employeeId,-bid.amount,`竞标得标 · ${product.name}`,actor,now);
  }
  product.status='closed';
  product.closedAt=now;
}
export function expireAuctions(state,now) {
  for (const product of state.products) {
    if (product.status==='open' && product.end<=now) settle(state,product,'系统结标',now);
  }
}
export function mutate(state,user,action,data,now=Date.now()) {
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
export function publicState(state,user,now=Date.now()) {
  const manager=['admin','gamemaster'].includes(user.role);
  const rows=state.employees.map(({id,name,department,role,points})=>({id,name,department,role,points,frozen:frozen(state,id)})).sort((a,b)=>b.points-a.points||a.id.localeCompare(b.id));
  const me=rows.find(row=>row.id===user.id);
  return {me,employees:rows,products:state.products,notices:state.notices,games,
    bids:state.bids.filter(row=>row.employeeId===user.id || user.role==='admin' || row.status==='won'),
    ledger:state.ledger.filter(row=>manager || row.employeeId===user.id),serverTime:now};
}
