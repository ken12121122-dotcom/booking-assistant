const $ = (id) => document.getElementById(id);
const STORE_KEY = 'booking_assistant_v02';

function show(id) {
  ['setup', 'admin'].forEach((name) => $(name).classList.toggle('hidden', name !== id));
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || { customers: [], classes: [], checkins: [] };
  } catch (_) {
    return { customers: [], classes: [], checkins: [] };
  }
}

let state = loadState();

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  renderAll();
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function esc(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function isToday(value) {
  if (!value) return false;
  const d = new Date(value);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function fmt(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('zh-TW', { hour12: false });
}

function renderCounts() {
  $('customerCount').textContent = state.customers.length;
  $('todayClassCount').textContent = state.classes.filter(x => isToday(x.time)).length;
  $('checkinCount').textContent = state.checkins.filter(x => isToday(x.time)).length;
}

function renderCustomers() {
  $('customerList').innerHTML = state.customers.length ? state.customers.map(c => `
    <div class="listItem">
      <div><strong>${esc(c.name)}</strong><small>${esc(c.phone || '未填電話')}</small></div>
      <button data-delete-customer="${c.id}">刪除</button>
    </div>`).join('') : '<div class="empty">尚無客戶</div>';

  $('checkinCustomer').innerHTML = state.customers.length
    ? state.customers.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')
    : '<option value="">尚無客戶</option>';
}

function renderClasses() {
  const items = [...state.classes].sort((a,b) => new Date(a.time) - new Date(b.time));
  $('classList').innerHTML = items.length ? items.map(c => `
    <div class="listItem">
      <div><strong>${esc(c.name)}</strong><small>${fmt(c.time)}</small></div>
      <button data-delete-class="${c.id}">刪除</button>
    </div>`).join('') : '<div class="empty">尚無課程</div>';
}

function renderCheckins() {
  const items = [...state.checkins].sort((a,b) => new Date(b.time) - new Date(a.time)).slice(0, 30);
  $('checkinList').innerHTML = items.length ? items.map(x => {
    const customer = state.customers.find(c => c.id === x.customerId);
    return `<div class="listItem"><div><strong>${esc(customer?.name || x.customerName || '已刪除客戶')}</strong><small>${fmt(x.time)}</small></div></div>`;
  }).join('') : '<div class="empty">尚無簽到紀錄</div>';
}

function renderAll() {
  renderCounts();
  renderCustomers();
  renderClasses();
  renderCheckins();
}

function boot() {
  const native = window.BookingNative;
  if (!native) {
    document.body.innerHTML = '<p style="padding:24px">Native bridge unavailable.</p>';
    return;
  }

  $('version').textContent = `v${native.getVersion()}`;
  if (native.isInitialized()) {
    $('businessTitle').textContent = native.getBusinessName() || 'Booking Assistant';
    show('admin');
    renderAll();
  } else {
    show('setup');
  }
}

$('startSetup').addEventListener('click', () => {
  const businessName = $('businessName').value.trim();
  const adminPin = $('adminPin').value.trim();
  const ok = window.BookingNative.saveSetup(businessName, adminPin);
  if (!ok) {
    $('setupStatus').textContent = '請填店家名稱，PIN 至少 4 碼。';
    return;
  }
  $('setupStatus').textContent = '初始化完成。';
  setTimeout(() => location.reload(), 250);
});

$('updateApp').addEventListener('click', () => {
  const result = window.BookingNative.startUpdate();
  if (result === 'permission_required') {
    $('updateStatus').textContent = '請允許此 App 安裝未知應用程式，返回後再按一次更新。';
  } else if (result === 'downloading') {
    $('updateStatus').textContent = '正在下載最新版本，完成後會跳出 Android 安裝畫面。';
  } else {
    $('updateStatus').textContent = `更新啟動失敗：${result}`;
  }
});

$('addCustomer').addEventListener('click', () => {
  const name = $('customerName').value.trim();
  const phone = $('customerPhone').value.trim();
  if (!name) return;
  state.customers.push({ id: uid('cus'), name, phone, createdAt: new Date().toISOString() });
  $('customerName').value = '';
  $('customerPhone').value = '';
  saveState();
});

$('addClass').addEventListener('click', () => {
  const name = $('className').value.trim();
  const time = $('classTime').value;
  if (!name || !time) return;
  state.classes.push({ id: uid('cls'), name, time: new Date(time).toISOString() });
  $('className').value = '';
  $('classTime').value = '';
  saveState();
});

$('addCheckin').addEventListener('click', () => {
  const customerId = $('checkinCustomer').value;
  const customer = state.customers.find(c => c.id === customerId);
  if (!customer) return;
  state.checkins.push({ id: uid('chk'), customerId, customerName: customer.name, time: new Date().toISOString() });
  saveState();
});

$('customerList').addEventListener('click', (e) => {
  const id = e.target?.dataset?.deleteCustomer;
  if (!id) return;
  state.customers = state.customers.filter(x => x.id !== id);
  saveState();
});

$('classList').addEventListener('click', (e) => {
  const id = e.target?.dataset?.deleteClass;
  if (!id) return;
  state.classes = state.classes.filter(x => x.id !== id);
  saveState();
});

document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === btn));
  ['customers','classes','checkins'].forEach(id => $(id).classList.toggle('hidden', id !== btn.dataset.tab));
}));

$('resetSetup').addEventListener('click', () => {
  if (confirm('要清除目前的交機設定嗎？本機客戶、課程與簽到資料不會一起刪除。')) {
    window.BookingNative.resetSetup();
    location.reload();
  }
});

boot();
