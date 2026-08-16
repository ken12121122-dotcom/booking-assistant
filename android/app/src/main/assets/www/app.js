const $ = (id) => document.getElementById(id);
const STORE_KEY = 'booking_assistant_v02';
let gatewayTimer = null;

function show(id) {
  ['setup', 'admin'].forEach((name) => $(name).classList.toggle('hidden', name !== id));
}

function loadState() {
  try {
    const loaded = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    return {
      customers: loaded.customers || [],
      classes: loaded.classes || [],
      checkins: loaded.checkins || [],
      lineInbox: loaded.lineInbox || []
    };
  } catch (_) {
    return { customers: [], classes: [], checkins: [], lineInbox: [] };
  }
}

let state = loadState();
function saveState() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); renderAll(); }
function uid(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`; }
function esc(value) { return String(value || '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }
function isToday(value) { if (!value) return false; const d=new Date(value), n=new Date(); return d.getFullYear()===n.getFullYear()&&d.getMonth()===n.getMonth()&&d.getDate()===n.getDate(); }
function fmt(value) { return value ? new Date(value).toLocaleString('zh-TW',{hour12:false}) : ''; }
function parseNative(value) { try { return JSON.parse(value); } catch (_) { return {ok:false,error:'invalid_response',raw:value}; } }
function setLineBadge(text, mode='neutral') { $('lineBadge').textContent=text; $('lineBadge').className=`statusBadge ${mode}`; }

function renderCounts() {
  $('customerCount').textContent=state.customers.length;
  $('todayClassCount').textContent=state.classes.filter(x=>isToday(x.time)).length;
  $('checkinCount').textContent=state.checkins.filter(x=>isToday(x.time)).length;
}

function renderCustomers() {
  $('customerList').innerHTML=state.customers.length?state.customers.map(c=>`<div class="listItem"><div><strong>${esc(c.name)}</strong><small>${esc(c.phone||'未填電話')}</small></div><button data-delete-customer="${c.id}">刪除</button></div>`).join(''):'<div class="empty">尚無客戶</div>';
  $('checkinCustomer').innerHTML=state.customers.length?state.customers.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join(''):'<option value="">尚無客戶</option>';
}

function renderClasses() {
  const items=[...state.classes].sort((a,b)=>new Date(a.time)-new Date(b.time));
  $('classList').innerHTML=items.length?items.map(c=>`<div class="listItem"><div><strong>${esc(c.name)}</strong><small>${fmt(c.time)}</small></div><button data-delete-class="${c.id}">刪除</button></div>`).join(''):'<div class="empty">尚無課程</div>';
}

function renderCheckins() {
  const items=[...state.checkins].sort((a,b)=>new Date(b.time)-new Date(a.time)).slice(0,30);
  $('checkinList').innerHTML=items.length?items.map(x=>{const c=state.customers.find(c=>c.id===x.customerId);return `<div class="listItem"><div><strong>${esc(c?.name||x.customerName||'已刪除客戶')}</strong><small>${fmt(x.time)}</small></div></div>`;}).join(''):'<div class="empty">尚無簽到紀錄</div>';
}

function renderInbox() {
  const box=$('lineInbox'); if(!box) return;
  const items=[...state.lineInbox].sort((a,b)=>new Date(b.receivedAt)-new Date(a.receivedAt)).slice(0,30);
  box.innerHTML=items.length?items.map(m=>{
    const summary=m.plan?.summary?`<small>AI：${esc(m.plan.summary)}</small>`:'';
    return `<div class="inboxItem"><div><strong>${esc(m.text)}</strong><small>${fmt(m.receivedAt)}｜${esc(m.sourceType||'LINE')}</small>${summary}</div></div>`;
  }).join(''):'<div class="empty">尚未收到 LINE 訊息</div>';
}

function renderLineConfig() {
  const cfg=parseNative(window.BookingNative.getLineConfig());
  $('lineSecretHint').textContent=cfg.secretSet?'已加密儲存；重新貼上可更新':'尚未儲存';
  $('lineTokenHint').textContent=cfg.tokenSet?'已加密儲存；重新貼上可更新':'尚未儲存';
  $('lineWebhook').value=cfg.webhook||'';
  $('deviceId').textContent=cfg.deviceId||window.BookingNative.getDeviceId();
  if(cfg.botName||cfg.basicId){$('lineBotInfo').innerHTML=`<strong>${esc(cfg.botName||'LINE Bot')}</strong><small>${esc(cfg.basicId||'')}</small>`;setLineBadge('已驗證','ok');$('tokenHealth').textContent='✅ 已驗證';}
  else if(cfg.tokenSet)setLineBadge('已儲存','warn'); else setLineBadge('未設定','neutral');
  renderInbox();
}

function renderAll(){renderCounts();renderCustomers();renderClasses();renderCheckins();renderLineConfig();}

function boot(){
  const native=window.BookingNative;
  if(!native){document.body.innerHTML='<p style="padding:24px">Native bridge unavailable.</p>';return;}
  $('version').textContent=`v${native.getVersion()}`;
  if(native.isInitialized()){$('businessTitle').textContent=native.getBusinessName()||'Booking Assistant';show('admin');renderAll();}else show('setup');
}

function mergeGatewayMessages(messages){
  if(!Array.isArray(messages)||!messages.length)return 0;
  const ids=new Set(state.lineInbox.map(x=>x.id));
  let added=0;
  for(const m of messages){if(!ids.has(m.id)){state.lineInbox.push(m);ids.add(m.id);added++;}}
  if(state.lineInbox.length>100)state.lineInbox=state.lineInbox.slice(-100);
  if(added){localStorage.setItem(STORE_KEY,JSON.stringify(state));renderInbox();}
  return added;
}

function pollGateway(showStatus=false){
  if(showStatus)$('lineStatus').textContent='正在同步 LINE Gateway…';
  setTimeout(()=>{
    const result=parseNative(window.BookingNative.pollLineGateway());
    const body=result.body||{};
    if(result.ok&&body.ok){
      const added=mergeGatewayMessages(body.messages||[]);
      $('messageHealth').textContent='✅ 接收中';
      setLineBadge('Gateway 已連線','ok');
      if(showStatus)$('lineStatus').textContent=added?`✅ 收到 ${added} 則新 LINE 訊息。`:`✅ Gateway 正常，暫無新訊息。裝置：${body.deviceId||''}`;
    }else{
      $('messageHealth').textContent=`❌ ${result.status||result.error||body.error||'失敗'}`;
      if(showStatus)$('lineStatus').textContent=`Gateway 連線失敗：${body.error||result.error||result.status||'unknown'}`;
    }
  },30);
}

function startGateway(){
  if(gatewayTimer)clearInterval(gatewayTimer);
  pollGateway(true);
  gatewayTimer=setInterval(()=>pollGateway(false),4000);
  $('messageHealth').textContent='連線中…';
}

$('startSetup').addEventListener('click',()=>{const ok=window.BookingNative.saveSetup($('businessName').value.trim(),$('adminPin').value.trim());$('setupStatus').textContent=ok?'初始化完成。':'請填店家名稱，PIN 至少 4 碼。';if(ok)setTimeout(()=>location.reload(),250);});

$('updateApp').addEventListener('click',()=>{const r=window.BookingNative.startUpdate();$('updateStatus').textContent=r==='permission_required'?'請允許此 App 安裝未知應用程式，返回後再按一次更新。':r==='downloading'?'正在下載最新版本，完成後會跳出 Android 安裝畫面。':`更新啟動失敗：${r}`;});

$('addCustomer').addEventListener('click',()=>{const name=$('customerName').value.trim(),phone=$('customerPhone').value.trim();if(!name)return;state.customers.push({id:uid('cus'),name,phone,createdAt:new Date().toISOString()});$('customerName').value='';$('customerPhone').value='';saveState();});
$('addClass').addEventListener('click',()=>{const name=$('className').value.trim(),time=$('classTime').value;if(!name||!time)return;state.classes.push({id:uid('cls'),name,time:new Date(time).toISOString()});$('className').value='';$('classTime').value='';saveState();});
$('addCheckin').addEventListener('click',()=>{const customerId=$('checkinCustomer').value,customer=state.customers.find(c=>c.id===customerId);if(!customer)return;state.checkins.push({id:uid('chk'),customerId,customerName:customer.name,time:new Date().toISOString()});saveState();});
$('customerList').addEventListener('click',e=>{const id=e.target?.dataset?.deleteCustomer;if(!id)return;state.customers=state.customers.filter(x=>x.id!==id);saveState();});
$('classList').addEventListener('click',e=>{const id=e.target?.dataset?.deleteClass;if(!id)return;state.classes=state.classes.filter(x=>x.id!==id);saveState();});

document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===btn));['customers','classes','checkins','line'].forEach(id=>$(id).classList.toggle('hidden',id!==btn.dataset.tab));if(btn.dataset.tab==='line')renderLineConfig();}));

$('saveLine').addEventListener('click',()=>{
  const result=parseNative(window.BookingNative.saveLineConfig($('lineSecret').value.trim(),$('lineToken').value.trim(),$('lineWebhook').value.trim()));
  if(result.ok){$('lineStatus').textContent='✅ LINE 設定已儲存。';$('lineSecret').value='';$('lineToken').value='';renderLineConfig();}
  else $('lineStatus').textContent=result.error==='https_required'?'Webhook 必須使用 https://':'請先輸入 Channel Access Token。';
});

$('testLine').addEventListener('click',()=>{ $('lineStatus').textContent='正在向 LINE 驗證 Token…'; setTimeout(()=>{const r=parseNative(window.BookingNative.testLineToken()),b=r.body||{};if(r.ok){$('tokenHealth').textContent='✅ 正常';$('lineBotInfo').innerHTML=`<strong>${esc(b.displayName||'LINE Bot')}</strong><small>${esc(b.basicId||b.userId||'')}</small>`;$('lineStatus').textContent=`✅ LINE Token 驗證成功（HTTP ${r.status}）。`;setLineBadge('已連線','ok');}else{$('tokenHealth').textContent=`❌ ${r.status||r.error||'失敗'}`;$('lineStatus').textContent=`LINE Token 驗證失敗：${r.status||r.error||'unknown'}`;setLineBadge('驗證失敗','bad');}},30); });

$('setWebhook').addEventListener('click',()=>{const cfg=parseNative(window.BookingNative.getLineConfig());if($('lineWebhook').value.trim()!==cfg.webhook){$('lineStatus').textContent='Webhook 有變更，請先按「儲存 LINE 設定」。';return;}$('lineStatus').textContent='正在設定 LINE Webhook…';setTimeout(()=>{const r=parseNative(window.BookingNative.configureLineWebhook());$('webhookHealth').textContent=r.ok?'✅ 已設定':`❌ ${r.status||r.error||'失敗'}`;$('lineStatus').textContent=r.ok?'✅ Webhook URL 已送至 LINE。':`Webhook 設定失敗：${r.status||r.error||'unknown'}`;},30);});

$('testWebhook').addEventListener('click',()=>{ $('lineStatus').textContent='正在要求 LINE 測試 Webhook…'; setTimeout(()=>{const r=parseNative(window.BookingNative.testLineWebhook()),b=r.body||{};if(r.ok&&b.success!==false){$('webhookHealth').textContent='✅ 可達';$('lineStatus').textContent='✅ LINE 已成功連到這個 Webhook。';}else{$('webhookHealth').textContent=`❌ ${b.statusCode||r.status||r.error||'失敗'}`;$('lineStatus').textContent=`Webhook 測試失敗：${b.reason||b.detail||r.status||r.error||'unknown'}`;}},30); });

$('startGateway').addEventListener('click',startGateway);
$('pollGateway').addEventListener('click',()=>pollGateway(true));
$('resetSetup').addEventListener('click',()=>{if(confirm('要清除目前的交機設定嗎？本機客戶、課程、簽到與 LINE 設定不會一起刪除。')){window.BookingNative.resetSetup();location.reload();}});

boot();
