const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LearnAdmin — 题库管理</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f5f5f5;color:#333}
.header{background:#1a1a2e;color:#fff;padding:12px 24px;display:flex;align-items:center;justify-content:space-between}
.header h1{font-size:18px;font-weight:600}
.header .key-status{font-size:12px;opacity:.7}
.login-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:999}
.login-box{background:#fff;border-radius:8px;padding:32px;width:380px;box-shadow:0 4px 24px rgba(0,0,0,.2)}
.login-box h2{font-size:16px;margin-bottom:16px}
.login-box input{width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;margin-bottom:12px}
.login-box button{width:100%;padding:10px;background:#1a1a2e;color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer}
.login-box .error{color:#e74c3c;font-size:12px;margin-top:8px}
.container{max-width:1200px;margin:0 auto;padding:20px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px}
.card{background:#fff;border-radius:8px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.card .label{font-size:12px;color:#888;margin-bottom:4px}
.card .value{font-size:28px;font-weight:700}
.card.green .value{color:#27ae60}
.card.blue .value{color:#2980b9}
.card.orange .value{color:#e67e22}
.card.red .value{color:#e74c3c}
.tabs{display:flex;gap:0;margin-bottom:20px;background:#fff;border-radius:8px;padding:4px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.tab{padding:8px 20px;border:none;background:none;font-size:14px;cursor:pointer;border-radius:6px;color:#666}
.tab.active{background:#1a1a2e;color:#fff}
.panel{background:#fff;border-radius:8px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
table{width:100%;border-collapse:collapse}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #eee;font-size:13px}
th{font-weight:600;color:#888;font-size:12px}
tr:hover{background:#fafafa}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
.badge-trial{background:#e8f4fd;color:#2980b9}
.badge-monthly{background:#fef9e7;color:#e67e22}
.badge-lifetime{background:#eafaf1;color:#27ae60}
.badge-banned{background:#fdecea;color:#e74c3c}
.btn{padding:6px 14px;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-weight:500}
.btn-danger{background:#e74c3c;color:#fff}
.btn-success{background:#27ae60;color:#fff}
.btn-default{background:#eee;color:#333}
.btn-primary{background:#1a1a2e;color:#fff}
.btn-sm{padding:4px 10px;font-size:11px}
.actions{display:flex;gap:8px;flex-wrap:wrap}
.mt-16{margin-top:16px}
.gap-8{display:flex;gap:8px;align-items:center}
select,input[type=number]{padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px}
.toast{position:fixed;top:20px;right:20px;padding:12px 20px;border-radius:8px;color:#fff;font-size:13px;z-index:1000;opacity:0;transition:opacity .3s}
.toast.show{opacity:1}
.toast.success{background:#27ae60}
.toast.error{background:#e74c3c}
.loading{text-align:center;padding:40px;color:#888}
</style>
</head>
<body>
<div class="login-overlay" id="loginOverlay">
  <div class="login-box">
    <h2>LearnAdmin 登录</h2>
    <input type="password" id="keyInput" placeholder="输入 Admin Key">
    <button onclick="login()">登录</button>
    <div class="error" id="loginError"></div>
  </div>
</div>
<div class="header">
  <h1>LearnAdmin — 题库管理后台</h1>
  <span class="key-status">DB: <span id="dbStatus">-</span></span>
</div>
<div class="container">
  <div class="cards" id="cards"></div>
  <div class="tabs">
    <button class="tab active" data-tab="questions">题库</button>
    <button class="tab" data-tab="api">API 用量</button>
    <button class="tab" data-tab="users">用户管理</button>
    <button class="tab" data-tab="cardkeys">卡密管理</button>
  </div>
  <div class="panel" id="panel"><div class="loading">加载中…</div></div>
</div>
<div class="toast" id="toast"></div>
<script>
const A = { key: localStorage.getItem('admin_key') || '' };
function api(p, opts) {
  return fetch(p, { headers: { 'X-Admin-Key': A.key, 'Content-Type': 'application/json' }, ...opts })
    .then(r => { if (!r.ok) throw new Error(r.status + ': ' + r.statusText); return r.json(); });
}
function t(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'toast ' + (type || 'success') + ' show';
  setTimeout(() => el.classList.remove('show'), 2500);
}
function login() {
  A.key = document.getElementById('keyInput').value.trim();
  if (!A.key) return;
  api('/admin/api/stats').then(() => {
    localStorage.setItem('admin_key', A.key);
    document.getElementById('loginOverlay').style.display = 'none';
    loadAll();
  }).catch(() => document.getElementById('loginError').textContent = 'Key 无效');
}
if (A.key) { document.getElementById('loginOverlay').style.display = 'none'; loadAll(); }

document.querySelectorAll('.tab').forEach(el => el.onclick = function() {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  this.classList.add('active');
  loadTab(this.dataset.tab);
});

async function loadAll() {
  document.getElementById('dbStatus').textContent = '已连接';
  try {
    const s = await api('/admin/api/stats');
    document.getElementById('cards').innerHTML =
      '<div class="card green"><div class="label">题库总数</div><div class="value">' + s.questions_total + '</div></div>' +
      '<div class="card blue"><div class="label">24h 命中率</div><div class="value">' + Math.round(s.hit_rate_24h*100) + '%</div></div>' +
      '<div class="card orange"><div class="label">待审核队列</div><div class="value">' + s.pending_count + '</div></div>' +
      '<div class="card"><div class="label">错题待处理</div><div class="value" style="color:#e74c3c">' + s.questions_wrong + '</div></div>' +
      '<div class="card"><div class="label">注册用户</div><div class="value">' + s.users_total + '</div></div>' +
      '<div class="card"><div class="label">信心分布</div><div class="value" style="font-size:14px;display:flex;gap:8px;align-items:end">' +
        '<span style="color:#e74c3c">' + s.confidence_distribution.low + '</span> / ' +
        '<span style="color:#e67e22">' + s.confidence_distribution.mid + '</span> / ' +
        '<span style="color:#27ae60">' + s.confidence_distribution.high + '</span></div></div>';
  } catch(e) { document.getElementById('dbStatus').textContent = '连接失败'; }
  loadTab('questions');
}

async function loadTab(tab) {
  const p = document.getElementById('panel');
  p.innerHTML = '<div class="loading">加载中…</div>';
  try {
    if (tab === 'questions') await loadQuestions(p);
    else if (tab === 'api') await loadApiUsage(p);
    else if (tab === 'users') await loadUsers(p);
    else if (tab === 'cardkeys') await loadCardKeys(p);
  } catch(e) { p.innerHTML = '<div style="color:#e74c3c;text-align:center;padding:20px">加载失败: ' + e.message + '</div>'; }
}

async function loadQuestions(p) {
  const s = await api('/admin/api/stats');
  let h = '<h3 style="margin-bottom:12px">题目分布</h3>';
  h += '<table><tr><th>平台</th><th>数量</th><th>题型</th><th>数量</th></tr>';
  const plats = Object.entries(s.platforms || {});
  const types = Object.entries(s.types || {});
  const max = Math.max(plats.length, types.length);
  for (let i = 0; i < max; i++)
    h += '<tr><td>' + (plats[i]?.[0] || '') + '</td><td>' + (plats[i]?.[1] || '') + '</td><td>' + (types[i]?.[0] || '') + '</td><td>' + (types[i]?.[1] || '') + '</td></tr>';
  h += '</table>';
  h += '<div class="mt-16" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">' +
    '<div style="padding:12px;background:#eafaf1;border-radius:6px"><strong>已验证正确</strong><br>' + s.questions_verified + '</div>' +
    '<div style="padding:12px;background:#fdecea;border-radius:6px"><strong>已确认错误</strong><br>' + s.questions_wrong + '</div>' +
    '<div style="padding:12px;background:#fef9e7;border-radius:6px"><strong>待排队</strong><br>' + s.pending_count + '</div>' +
    '</div>';
  p.innerHTML = h;
}

async function loadApiUsage(p) {
  const d = await api('/admin/api/deepseek-usage');
  let h = '<h3 style="margin-bottom:12px">DeepSeek API 用量（30天）</h3>';
  h += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">' +
    '<div style="padding:12px;background:#f5f5f5;border-radius:6px"><strong>本月调用</strong><br>' + d.this_month_calls + '</div>' +
    '<div style="padding:12px;background:#eafaf1;border-radius:6px"><strong>成功率</strong><br>' + Math.round(d.this_month_success_rate*100) + '%</div>' +
    '<div style="padding:12px;background:#e8f4fd;border-radius:6px"><strong>平均延迟</strong><br>' + d.avg_latency_ms + 'ms</div>' +
    '<div style="padding:12px;background:#fef9e7;border-radius:6px"><strong>成功数</strong><br>' + d.this_month_accepted + '</div>' +
    '</div>';
  h += '<table><tr><th>日期</th><th>调用</th><th>成功</th><th>成功率</th></tr>';
  (d.daily || []).forEach(r => {
    h += '<tr><td>' + r.date + '</td><td>' + r.calls + '</td><td>' + r.accepted + '</td><td>' + (r.calls > 0 ? Math.round(r.accepted/r.calls*100) : 0) + '%</td></tr>';
  });
  h += '</table>';
  p.innerHTML = h;
}

async function loadUsers(p) {
  const d = await api('/admin/api/users');
  let h = '<h3 style="margin-bottom:12px">用户列表 (' + d.total + ' 人)</h3>';
  h += '<table><tr><th>ID</th><th>Plan</th><th>设备</th><th>到期</th><th>状态</th><th>操作</th></tr>';
  d.users.forEach(u => {
    const planBadge = u.plan === 'lifetime' ? 'badge-lifetime' : u.plan === 'monthly' ? 'badge-monthly' : 'badge-trial';
    h += '<tr><td style="font-family:monospace;font-size:11px">' + u.id.slice(0,8) + '…</td>' +
      '<td><span class="badge ' + planBadge + '">' + u.plan + '</span></td>' +
      '<td>' + u.device_count + '</td>' +
      '<td>' + (u.monthly_exp ? new Date(u.monthly_exp).toLocaleDateString('zh-CN') : '永久') + '</td>' +
      '<td>' + (u.is_banned ? '<span class="badge badge-banned">封禁</span>' : '<span style="color:#27ae60">正常</span>') + '</td>' +
      '<td class="actions">' +
        '<button class="btn ' + (u.is_banned ? 'btn-success' : 'btn-danger') + ' btn-sm" onclick="toggleBan(\\'' + u.id + '\\', ' + !u.is_banned + ')">' + (u.is_banned ? '解封' : '封禁') + '</button>' +
        '<button class="btn btn-default btn-sm" onclick="unbindAll(\\'' + u.id + '\\')">解绑设备</button>' +
      '</td></tr>';
  });
  h += '</table>';
  p.innerHTML = h;
}

async function loadCardKeys(p) {
  const d = await api('/admin/api/cardkeys');
  let h = '<div class="gap-8" style="margin-bottom:16px;justify-content:space-between">' +
    '<h3>卡密列表 (' + d.total + ' 个)</h3>' +
    '<div class="gap-8">' +
      '<select id="genPlan"><option value="trial">试用 7天</option><option value="monthly">月订 30天</option><option value="lifetime">永久</option></select>' +
      '<input type="number" id="genCount" value="1" min="1" max="50" style="width:60px">' +
      '<button class="btn btn-primary" onclick="generateKeys()">生成卡密</button>' +
    '</div></div>';
  h += '<table><tr><th>ID</th><th>Plan</th><th>到期</th><th>状态</th><th>操作</th></tr>';
  d.cardkeys.forEach(k => {
    const planBadge = k.plan === 'lifetime' ? 'badge-lifetime' : k.plan === 'monthly' ? 'badge-monthly' : 'badge-trial';
    h += '<tr><td style="font-family:monospace;font-size:11px">' + k.id.slice(0,8) + '…</td>' +
      '<td><span class="badge ' + planBadge + '">' + k.plan + '</span></td>' +
      '<td>' + (k.monthly_exp ? new Date(k.monthly_exp).toLocaleDateString('zh-CN') : '永久') + '</td>' +
      '<td>' + (k.is_banned ? '<span class="badge badge-banned">已作废</span>' : '<span style="color:#27ae60">正常</span>') + '</td>' +
      '<td class="actions">' +
        (k.plan !== 'lifetime' ? '<button class="btn btn-success btn-sm" onclick="renewKey(\\'' + k.id + '\\')">续期 +30天</button>' : '') +
        '<button class="btn btn-danger btn-sm" onclick="revokeKey(\\'' + k.id + '\\')">' + (k.is_banned ? '已作废' : '作废') + '</button>' +
      '</td></tr>';
  });
  h += '</table>';
  p.innerHTML = h;
}

window.toggleBan = function(id, ban) {
  api('/admin/api/users/' + id + '/toggle-ban', { method: 'POST' }).then(() => { t(ban ? '已封禁' : '已解封'); loadTab('users'); }).catch(e => t(e.message, 'error'));
};
window.unbindAll = function(id) {
  if (!confirm('确定清空该用户所有设备绑定？')) return;
  api('/admin/api/users/' + id + '/unbind-all', { method: 'POST' }).then(() => { t('已解绑'); loadTab('users'); }).catch(e => t(e.message, 'error'));
};
window.generateKeys = function() {
  const plan = document.getElementById('genPlan').value;
  const count = parseInt(document.getElementById('genCount').value) || 1;
  api('/admin/api/cardkeys/generate', { method: 'POST', body: JSON.stringify({ plan, count }) }).then(d => {
    t('已生成 ' + d.count + ' 个卡密');
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:1001';
    modal.innerHTML = '<div style="background:#fff;border-radius:8px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow:auto"><h3>新卡密 (' + plan + ' ×' + count + ')</h3><div style="margin:12px 0;font-family:monospace;font-size:13px;line-height:2;background:#f5f5f5;padding:12px;border-radius:6px;max-height:300px;overflow:auto">' + d.generated.join('<br>') + '</div><button class="btn btn-primary" onclick="this.closest(\\'div[style]\\').parentElement.remove();loadTab(\\'cardkeys\\')">关闭</button></div>';
    document.body.appendChild(modal);
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
  }).catch(e => t(e.message, 'error'));
};
window.renewKey = function(id) {
  api('/admin/api/cardkeys/' + id + '/renew', { method: 'POST' }).then(() => { t('已续期'); loadTab('cardkeys'); }).catch(e => t(e.message, 'error'));
};
window.revokeKey = function(id) {
  api('/admin/api/cardkeys/' + id + '/revoke', { method: 'POST' }).then(() => { t('已作废'); loadTab('cardkeys'); }).catch(e => t(e.message, 'error'));
};
</script>
</body></html>`;

export default DASHBOARD_HTML;
