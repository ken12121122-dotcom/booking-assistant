const $ = (id) => document.getElementById(id);

function show(id) {
  ['setup', 'admin'].forEach((name) => $(name).classList.toggle('hidden', name !== id));
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
  setTimeout(() => location.reload(), 300);
});

$('resetSetup').addEventListener('click', () => {
  if (confirm('要清除目前的交機設定嗎？')) {
    window.BookingNative.resetSetup();
    location.reload();
  }
});

boot();
