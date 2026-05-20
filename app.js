// Emergency escape hatch — fires after 6s regardless of anything else
(function(){
  var t = setTimeout(function(){
    var loader = document.getElementById('app-loader');
    var auth   = document.getElementById('auth-screen');
    if (loader) loader.style.display = 'none';
    if (auth)   auth.classList.add('visible');
  }, 6000);
  window._clearEmergencyTimeout = function(){ clearTimeout(t); };
})();// ═══════════════════════════════════════════════════════════
// COLLECTIVE — clean build
// ═══════════════════════════════════════════════════════════

// ── CONFIG ───────────────────────────────────────────────
const SUPA_URL = 'https://oqzlymsbyovakuoihech.supabase.co';
const SUPA_KEY = 'sb_publishable_md7xJ3qCDVUq0eYFVa3O9A_v6teCbOi';
const TCG_KEY  = '1a8d6c4f-a131-4507-85c1-781809ca5767';

// ── STATE ────────────────────────────────────────────────
var sb = null;
var currentUser = null;
var col = [], wish = [], binder = [Array(9).fill(null)], folders = [];
var trades = [], caughtSet = new Set();
var curPage = 1, totalCount = 0, activeType = '';
var activeCard = null, selSlot = null, binderPage = 0;
var searchCache = [], folderSearchCache = [];
var authMode = 'login', activeFolder = null, pdexFilter = 'all';
var wishPending = null, folderPickerCardId = null, folderPickerMode = null;

// ── INIT ─────────────────────────────────────────────────
window.addEventListener('load', function() {
  // Hard timeout — always escape the loader within 5 seconds no matter what
  var loaderTimeout = setTimeout(function() {
    hideLoader(); showAuthScreen();
  }, 5000);

  function safeHideLoader() {
    clearTimeout(loaderTimeout);
    if (window._clearEmergencyTimeout) window._clearEmergencyTimeout();
    hideLoader();
  }

  // Supabase CDN is async - wait for it then continue
  function waitForSupabase(tries, callback) {
    if (typeof supabase !== 'undefined' && supabase.createClient) {
      try { sb = supabase.createClient(SUPA_URL, SUPA_KEY); } catch(e) { console.warn('Supabase init failed:', e); }
      callback();
    } else if (tries > 0) {
      setTimeout(function(){ waitForSupabase(tries-1, callback); }, 150);
    } else {
      console.warn('Supabase not available — offline mode');
      callback(); // continue without Supabase
    }
  }

  waitForSupabase(20, function() {

  // Safe key listeners (null-checked)
  function addKey(id, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('keydown', function(e){ if(e.key==='Enter') fn(); });
  }
  addKey('add-friend-input', sendFriendRequest);
  addKey('auth-email', doAuth);
  addKey('auth-password', doAuth);
  addKey('auth-username', doAuth);
  addKey('search-input', function(){ doSearch(1); });
  addKey('folder-search-input', folderSearch);
  addKey('new-folder-name', createFolder);
  addKey('bs-tcg-q', function(){ binderTcgSearch(1); });

  if (!sb) {
    safeHideLoader(); showAuthScreen(); return;
  }

  var sessionHandled = false;

  sb.auth.onAuthStateChange(function(event, session) {
    if (session && session.user) {
      sessionHandled = true;
      currentUser = session.user;
      var meta = session.user.user_metadata || {};
      var uname = meta.username || session.user.email.split('@')[0];
      document.getElementById('sb-name').textContent = uname;
      document.getElementById('sb-avatar').textContent = uname[0].toUpperCase();
      safeHideLoader();
      document.getElementById('auth-screen').classList.remove('visible');
      loadAll().then(function() {
      // Also check for pending friend requests (by matching email)
      matchPendingFriendRequests().then(function() {
        showPage('dashboard');
      });
    });
    } else if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') {
      if (!session) {
        sessionHandled = true;
        col=[]; wish=[]; binder=[Array(9).fill(null)]; folders=[]; trades=[]; caughtSet=new Set();
        currentUser = null;
        safeHideLoader(); showAuthScreen();
      }
    }
  });

  // Fallback: getSession in case onAuthStateChange doesn't fire
  sb.auth.getSession().then(function(res) {
    if (!sessionHandled) {
      if (!res.data || !res.data.session) {
        safeHideLoader(); showAuthScreen();
      }
    }
  }).catch(function() {
    if (!sessionHandled) { safeHideLoader(); showAuthScreen(); }
  });

  }); // end waitForSupabase callback
});  // end window load

function hideLoader() { document.getElementById('app-loader').style.display = 'none'; }
function showAuthScreen() { document.getElementById('auth-screen').classList.add('visible'); }

// ── AUTH ─────────────────────────────────────────────────
function switchAuthTab(mode) {
  authMode = mode;
  document.getElementById('tab-login').classList.toggle('active', mode === 'login');
  document.getElementById('tab-register').classList.toggle('active', mode === 'register');
  document.getElementById('username-field').style.display = mode === 'register' ? 'block' : 'none';
  document.getElementById('auth-btn').textContent = mode === 'login' ? 'Sign In' : 'Create Account';
  document.getElementById('auth-err').textContent = '';
}

function doAuth() {
  var email = document.getElementById('auth-email').value.trim();
  var pass  = document.getElementById('auth-password').value;
  var uname = document.getElementById('auth-username').value.trim();
  var btn   = document.getElementById('auth-btn');
  var err   = document.getElementById('auth-err');
  err.style.color = 'var(--red)';
  if (!email || !pass) { err.textContent = 'Please enter email and password.'; return; }
  btn.disabled = true;
  btn.textContent = authMode === 'login' ? 'Signing in…' : 'Creating account…';
  err.textContent = '';
  if (authMode === 'login') {
    sb.auth.signInWithPassword({ email: email, password: pass }).then(function(r) {
      if (r.error) { err.textContent = r.error.message; btn.disabled = false; btn.textContent = 'Sign In'; }
    });
  } else {
    if (!uname) { err.textContent = 'Please enter a username.'; btn.disabled = false; btn.textContent = 'Create Account'; return; }
    sb.auth.signUp({ email: email, password: pass, options: { data: { username: uname } } }).then(function(r) {
      if (r.error) { err.textContent = r.error.message; btn.disabled = false; btn.textContent = 'Create Account'; return; }
      if (r.data.user && !r.data.session) {
        err.style.color = 'var(--green)';
        err.textContent = 'Check your email to confirm, then sign in!';
        btn.disabled = false; btn.textContent = 'Create Account';
      }
    });
  }
}

function signOut() {
  if (sb) sb.auth.signOut();
}

// ── LOAD DATA ────────────────────────────────────────────
function loadAll() {
  if (!sb || !currentUser) {
    loadBinder(); loadTrades(); loadPokedex(); loadProfile();
    folders = JSON.parse(localStorage.getItem('csq_folders_' + (currentUser&&currentUser.id||'')) || '[]');
    updateStats(); return Promise.resolve();
  }
  return Promise.all([
    sb.from('collections').select('card_data').eq('user_id', currentUser.id),
    sb.from('wishlists').select('card_data').eq('user_id', currentUser.id)
  ]).then(function(results) {
    console.log('loadAll: collections raw:', results[0]);
    console.log('loadAll: wishlists raw:', results[1]);
    col  = (results[0].data || []).map(function(r) { return r.card_data; });
    wish = (results[1].data || []).map(function(r) { return r.card_data; });
    console.log('loadAll: loaded', col.length, 'cards,', wish.length, 'wishlist items');
    loadBinder(); loadTrades(); loadPokedex(); loadFriends(); loadProfile();
    folders = JSON.parse(localStorage.getItem('csq_folders_' + currentUser.id) || '[]');
    updateStats();
  }).catch(function(e) { console.error('loadAll', e); loadBinder(); loadTrades(); loadPokedex(); loadFriends(); loadProfile(); updateStats(); });
}

function dbAddCol(card) {
  if (!currentUser || !sb) { console.warn('dbAddCol: no user or sb'); return Promise.resolve(); }
  console.log('dbAddCol: saving', card.id, 'for user', currentUser.id);
  // Try upsert first, fall back to delete+insert if constraint missing
  return sb.from('collections')
    .upsert({ user_id: currentUser.id, card_id: card.id, card_data: card }, { onConflict: 'user_id,card_id' })
    .then(function(res) {
      if (res.error) {
        console.error('dbAddCol upsert error:', res.error.message, '| code:', res.error.code, '| details:', res.error.details);
        showToast('Sync error: ' + res.error.message.slice(0,50), 'tr');
      } else {
        console.log('dbAddCol: saved OK', card.id);
      }
      return res;
    });
}
function dbRemoveCol(id) {
  if (!currentUser || !sb) return Promise.resolve();
  return sb.from('collections').delete().eq('user_id', currentUser.id).eq('card_id', id)
    .then(function(res){ if(res.error) console.error('dbRemoveCol error:', res.error.message); return res; });
}
function dbAddWish(card) {
  if (!currentUser || !sb) return Promise.resolve();
  return sb.from('wishlists')
    .upsert({ user_id: currentUser.id, card_id: card.id, card_data: card }, { onConflict: 'user_id,card_id' })
    .then(function(res) {
      if (res.error) {
        console.error('dbAddWish error:', res.error.message, res.error.code);
        if (res.error.code === '23505') {
          return sb.from('wishlists').update({ card_data: card }).eq('user_id', currentUser.id).eq('card_id', card.id);
        }
      }
      return res;
    });
}
function dbRemoveWish(id) {
  if (!currentUser || !sb) return Promise.resolve();
  return sb.from('wishlists').delete().eq('user_id', currentUser.id).eq('card_id', id)
    .then(function(res){ if(res.error) console.error('dbRemoveWish error:', res.error.message); return res; });
}
function saveBinder() { try { if (currentUser) localStorage.setItem('binder2_' + currentUser.id, JSON.stringify(binder)); } catch(e){} }
function loadBinder() {
  try {
    var raw = currentUser ? localStorage.getItem('binder2_' + currentUser.id) : null;
    binder = raw ? JSON.parse(raw) : [Array(9).fill(null)];
  } catch(e) { binder = [Array(9).fill(null)]; }
}
function saveTrades() { try { if (currentUser) localStorage.setItem('trades_' + currentUser.id, JSON.stringify(trades)); } catch(e){} }
function loadTrades() { try { trades = currentUser ? JSON.parse(localStorage.getItem('trades_' + currentUser.id) || '[]') : []; } catch(e){ trades=[]; } }
function savePokedex() { try { if (currentUser) localStorage.setItem('pokedex_' + currentUser.id, JSON.stringify(Array.from(caughtSet))); } catch(e){} }
function loadPokedex() { try { caughtSet = currentUser ? new Set(JSON.parse(localStorage.getItem('pokedex_' + currentUser.id) || '[]')) : new Set(); } catch(e){ caughtSet=new Set(); } }
function saveFolders() { try { if (currentUser) localStorage.setItem('csq_folders_' + currentUser.id, JSON.stringify(folders)); } catch(e){} }

// ── NAVIGATION ───────────────────────────────────────────
function showPage(id) {
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
  document.getElementById('page-' + id).classList.add('active');
  var nav = document.getElementById('nav-' + id);
  if (nav) nav.classList.add('active');
  var renders = { dashboard: renderDash, collection: renderCol, wishlist: renderWish, friends: renderFriends, binder: renderBinder, trade: renderTrade, pokedex: renderPokedex, profile: renderProfile, events: renderEvents };
  if (renders[id]) renders[id]();
}

// ── TOAST ────────────────────────────────────────────────
function showToast(msg, type) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + (type || 'tg');
  clearTimeout(t._t);
  t._t = setTimeout(function() { t.classList.remove('show'); }, 2800);
}

// ── HELPERS ──────────────────────────────────────────────
function getPrice(card) {
  try {
    var p = card.tcgplayer && card.tcgplayer.prices;
    if (!p) return null;
    var t = p.holofoil || p.normal || p.reverseHolofoil || Object.values(p)[0];
    return (t && (t.market || t.mid)) || null;
  } catch(e) { return null; }
}
function fp(p) { return p != null ? '£' + p.toFixed(2) : '—'; }
function tc(t) {
  var map = {fire:'#f08040',water:'#5aaced',grass:'#4acf8a',lightning:'#e8c84a',psychic:'#9b7eff',dragon:'#6a7aee',darkness:'#aaaacc',metal:'#aabbcc',fighting:'#e05040',colorless:'#888896'};
  return map[(t||'').toLowerCase()] || '#888896';
}

// ── TCG API ──────────────────────────────────────────────
function tcgGet(params) {
  var url;
  if (params.cardId) {
    url = 'https://api.pokemontcg.io/v2/cards/' + params.cardId;
  } else {
    var p = Object.assign({}, params);
    delete p.path;
    url = 'https://api.pokemontcg.io/v2' + (params.path || '/cards') + '?' + new URLSearchParams(p).toString();
  }
  return fetch(url, { headers: { 'X-Api-Key': TCG_KEY } }).then(function(r) {
    if (!r.ok) throw new Error('TCG ' + r.status);
    return r.json();
  });
}

// ── CARD TILE ────────────────────────────────────────────
function tile(card) {
  var owned  = col.some(function(c) { return c.id === card.id; });
  var wanted = wish.some(function(c) { return c.id === card.id; });
  var p = getPrice(card);
  return '<div class="pokemon-card" onclick="openModal(\'' + card.id + '\')">' +
    '<img src="' + (card.images && card.images.small || '') + '" alt="' + card.name + '" loading="lazy">' +
    (owned  ? '<span class="card-badge badge-own">✓ Owned</span>' : '') +
    (!owned && wanted ? '<span class="card-badge badge-want">⭐</span>' : '') +
    '<div class="cb2"><div class="card-name">' + card.name + '</div>' +
    '<div class="card-set">' + ((card.set && card.set.name) || '') + ' · ' + (card.number || '') + '</div>' +
    '<div class="card-price">' + fp(p) + '</div></div></div>';
}

function colTile(card) {
  var p = getPrice(card);
  return '<div class="pokemon-card" onclick="openModal(\'' + card.id + '\')">' +
    '<img src="' + (card.images && card.images.small || '') + '" alt="' + card.name + '" loading="lazy">' +
    '<span class="card-badge badge-own">✓ Owned</span>' +
    '<div class="cb2"><div class="card-name">' + card.name + '</div>' +
    '<div class="card-set">' + ((card.set && card.set.name) || '') + ' · ' + (card.number || '') + '</div>' +
    '<div class="card-price">' + fp(p) + '</div></div>' +
    '<div style="padding:0 8px 8px"><button class="btn" style="width:100%;font-size:11px;padding:4px" onclick="event.stopPropagation();openFolderModal(\'' + card.id + '\',\'move\')">📁 Move to Folder</button></div>' +
    '</div>';
}

// ── MODAL ────────────────────────────────────────────────
function openModal(id) {
  var card = col.find(function(c){return c.id===id;}) || wish.find(function(c){return c.id===id;}) || searchCache.find(function(c){return c.id===id;});
  document.getElementById('modal').classList.add('open');
  document.getElementById('m-name').textContent = 'Loading…';
  document.getElementById('m-sub').innerHTML = '';
  document.getElementById('m-stats').innerHTML = '';
  document.getElementById('m-actions').innerHTML = '';

  var load = card && card.images && card.images.large ? Promise.resolve(card) : tcgGet({ cardId: id }).then(function(d){ return d.data; });
  load.then(function(c) {
    activeCard = c;
    var owned  = col.some(function(x){return x.id===id;});
    var wanted = wish.some(function(x){return x.id===id;});
    var p = getPrice(c);
    var types = (c.types||[]).map(function(t){ return '<span style="background:'+tc(t)+'22;color:'+tc(t)+';padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600">'+t+'</span>'; }).join(' ');
    var atk = (c.attacks||[]).slice(0,1).map(function(a){ return a.name+' ('+(a.damage||'—')+')'; }).join('');
    document.getElementById('m-img').src = (c.images && (c.images.large || c.images.small)) || '';
    document.getElementById('m-name').textContent = c.name;
    document.getElementById('m-sub').textContent = ((c.set && c.set.name)||'') + ' · ' + (c.number||'') + ' · ' + (c.rarity||'');
    document.getElementById('m-stats').innerHTML =
      '<div class="m-stat"><div class="lbl">HP</div><div class="val">'+(c.hp||'—')+'</div></div>' +
      '<div class="m-stat"><div class="lbl">Type</div><div class="val">'+(types||'—')+'</div></div>' +
      '<div class="m-stat"><div class="lbl">Attack</div><div class="val" style="font-size:12px">'+(atk||'—')+'</div></div>' +
      '<div class="m-stat"><div class="lbl">Market</div><div class="val" style="color:var(--accent)">'+fp(p)+'</div></div>' +
      (c.artist ? '<div class="m-stat" style="grid-column:span 2"><div class="lbl">Artist</div><div class="val" style="color:var(--purple);font-size:13px">✏️ '+c.artist+'</div></div>' : '');
    if (owned) {
      document.getElementById('m-actions').innerHTML =
        '<button class="btn danger" onclick="removeCard(\''+id+'\')">Remove from Collection</button>' +
        '<button class="btn" onclick="openFolderModal(\''+id+'\',\'move\')">📁 Move to Folder</button>';
    } else {
      document.getElementById('m-actions').innerHTML =
        '<button class="btn primary" onclick="addCard()">+ Add to Collection</button>' +
        '<button class="btn" onclick="openFolderModal(\''+id+'\',\'search\')">📁 Add to Folder</button>' +
        '<button class="btn" onclick="openWishModal()">'+(wanted?'✓ Remove from Wishlist':'⭐ Add to Wishlist')+'</button>';
    }
  }).catch(function() { showToast('Could not load card','tr'); closeModal(); });
}

function closeModal() { document.getElementById('modal').classList.remove('open'); activeCard = null; }

function addCard() {
  if (!activeCard) return;
  var card = activeCard; // capture before closeModal nulls activeCard
  if (!col.some(function(c){return c.id===card.id;})) col.push(card);
  wish = wish.filter(function(c){return c.id!==card.id;});
  closeModal(); updateStats();
  Promise.all([dbAddCol(card), dbRemoveWish(card.id)]).then(function() {
    showToast('Added to collection 📦');
  }).catch(function(e) {
    console.error('addCard save error:', e);
    showToast('Added locally — sync may have failed', 'tr');
  });
}

function removeCard(id) {
  col = col.filter(function(c){return c.id!==id;});
  binder = binder.map(function(pg){ return pg.map(function(s){return s===id?null:s;}); });
  saveBinder(); closeModal(); updateStats();
  dbRemoveCol(id).then(function(){ showToast('Removed','tr'); });
}

// ── WISH MODAL ───────────────────────────────────────────
function openWishModal() {
  if (!activeCard) return;
  var id = activeCard.id;
  var cardSnap = activeCard; // capture before any close
  if (wish.some(function(c){return c.id===id;})) {
    wish = wish.filter(function(c){return c.id!==id;});
    closeModal(); updateStats();
    dbRemoveWish(id).then(function(){ showToast('Removed from wishlist'); });
    return;
  }
  wishPending = activeCard;
  document.getElementById('wish-modal-name').textContent = activeCard.name;
  document.getElementById('wish-budget').value = '';
  document.getElementById('wish-notes').value = '';
  document.getElementById('wish-confirm-btn').textContent = '⭐ Add to Wishlist';
  document.getElementById('wish-confirm-btn').onclick = confirmWish;
  document.getElementById('wish-modal').classList.add('open');
}

function closeWishModal() { document.getElementById('wish-modal').classList.remove('open'); wishPending = null; }

function confirmWish() {
  if (!wishPending) return;
  var card = Object.assign({}, wishPending);
  card._budget = parseFloat(document.getElementById('wish-budget').value) || null;
  card._notes  = document.getElementById('wish-notes').value.trim() || null;
  wish.push(card);
  closeWishModal(); closeModal(); updateStats();
  dbAddWish(card).then(function(){ showToast('Added to wishlist ⭐'); });
}

function openEditWish(id) {
  var card = wish.find(function(c){return c.id===id;}); if (!card) return;
  wishPending = card;
  document.getElementById('wish-modal-name').textContent = card.name;
  document.getElementById('wish-budget').value = card._budget || '';
  document.getElementById('wish-notes').value = card._notes || '';
  document.getElementById('wish-confirm-btn').textContent = '💾 Save Changes';
  document.getElementById('wish-confirm-btn').onclick = function() {
    card._budget = parseFloat(document.getElementById('wish-budget').value) || null;
    card._notes  = document.getElementById('wish-notes').value.trim() || null;
    closeWishModal(); renderWish(); showToast('Updated ✓'); dbAddWish(card);
  };
  document.getElementById('wish-modal').classList.add('open');
}

// ── FOLDER MODAL ─────────────────────────────────────────
function openFolderModal(cardId, mode) {
  folderPickerCardId = cardId; folderPickerMode = mode;
  var list = document.getElementById('folder-pick-list');
  document.getElementById('folder-new-name').value = '';
  list.innerHTML = '';
  if (!folders.length) {
    list.innerHTML = '<p style="color:var(--muted);font-size:13px;padding:8px">No folders yet — create one below</p>';
  } else {
    folders.forEach(function(f) {
      var div = document.createElement('div');
      div.className = 'pick-item';
      div.innerHTML = '📁 ' + f.name + '<span style="margin-left:auto;font-size:11px;color:var(--muted)">' + f.cardIds.length + ' cards</span>';
      div.addEventListener('click', function(){ folderPickerSelect(f.id); });
      list.appendChild(div);
    });
  }
  document.getElementById('folder-modal').classList.add('open');
}

function closeFolderModal() { document.getElementById('folder-modal').classList.remove('open'); folderPickerCardId = null; folderPickerMode = null; }

function folderPickerSelect(folderId) {
  if (!folderPickerCardId) return;
  if (folderPickerMode === 'search') {
    var card = searchCache.find(function(c){return c.id===folderPickerCardId;});
    if (card && !col.some(function(c){return c.id===folderPickerCardId;})) { col.push(card); dbAddCol(card); updateStats(); }
  }
  var f = folders.find(function(x){return x.id===folderId;});
  if (f && !f.cardIds.includes(folderPickerCardId)) {
    f.cardIds.push(folderPickerCardId); saveFolders();
    showToast('Added to "' + f.name + '" 📁');
  } else if (f) { showToast('Already in "' + f.name + '"'); }
  closeFolderModal();
  if (folderPickerMode === 'move') { closeModal(); renderCol(); }
}

function folderPickerCreate() {
  var name = document.getElementById('folder-new-name').value.trim();
  if (!name) { showToast('Enter a folder name','tr'); return; }
  if (folders.find(function(f){return f.name.toLowerCase()===name.toLowerCase();})) { showToast('Folder already exists','tr'); return; }
  var nf = { id: Date.now().toString(), name: name, cardIds: [] };
  folders.push(nf); saveFolders();
  folderPickerSelect(nf.id);
}

// ── STATS ────────────────────────────────────────────────
function updateStats() {
  document.getElementById('st-owned').textContent = col.length;
  document.getElementById('st-wish').textContent  = wish.length;
  var v = col.reduce(function(s,c){return s+(getPrice(c)||0);},0);
  document.getElementById('st-val').textContent   = '£'+v.toFixed(0);
  document.getElementById('st-sets').textContent  = new Set(col.map(function(c){return c.set&&c.set.id;})).size;
}

// ── DASHBOARD ────────────────────────────────────────────
function renderDash() {
  updateStats();
  // Show pending friend request notification
  var pending = _pendingCache || [];
  var notifEl = document.getElementById('friend-request-notif');
  if (!notifEl) {
    notifEl = document.createElement('div');
    notifEl.id = 'friend-request-notif';
    var dashPage = document.getElementById('page-dashboard');
    if (dashPage) dashPage.insertBefore(notifEl, dashPage.firstChild);
  }
  if (pending.length > 0) {
    var names = pending.map(function(r){ return r.from_username || r.from_email; }).join(', ');
    notifEl.innerHTML = '';
    var notifDiv = document.createElement('div');
    notifDiv.style.cssText = 'background:rgba(232,200,74,0.1);border:1px solid rgba(232,200,74,0.3);border-radius:12px;padding:12px 16px;margin-bottom:20px;display:flex;align-items:center;gap:12px;cursor:pointer;';
    notifDiv.innerHTML =
      '<span style="font-size:22px;">👥</span>' +
      '<div style="flex:1"><div style="font-weight:600;font-size:14px;">'+pending.length+' pending friend request'+(pending.length>1?'s':'')+'</div>' +
      '<div style="font-size:12px;color:var(--muted);">From: '+names+' — click to view</div></div>' +
      '<span style="color:var(--accent);font-size:13px;">View →</span>';
    notifDiv.addEventListener('click', function(){ showPage('friends'); });
    notifEl.appendChild(notifDiv);
  } else {
    notifEl.innerHTML = '';
  }
  var recent = col.slice(-8).reverse();
  document.getElementById('recent-cards').innerHTML = recent.length
    ? '<div class="cards-grid">'+recent.map(tile).join('')+'</div>'
    : '<div class="empty"><div class="em">🃏</div><p>No cards yet</p><small>Search for cards to start your collection</small></div>';
  renderDashFriendsWishlists();
}

function renderDashFriendsWishlists() {
  var el = document.getElementById('dash-friends-wishlists');
  if (!el) return;

  var friends = (_friendsCache || []).map(function(f) {
    var isMe = f.from_user_id === currentUser.id;
    var name  = isMe ? (f.to_username || f.to_email) : (f.from_username || f.from_email);
    var uid   = isMe ? f.to_user_id : f.from_user_id;
    var color = FRIEND_COLORS[Math.abs(hashStr((f.id || '').toString())) % FRIEND_COLORS.length];
    return { id: f.id, username: name, displayName: name, color: color, userId: uid };
  }).filter(function(f) { return !!f.userId; }); // skip friends who haven't logged in yet

  if (!friends.length) {
    el.innerHTML = '<div class="empty" style="padding:30px 20px"><div class="em">👥</div><p>No friends wishlist items yet</p><small>Add friends to see what they are looking for</small></div>';
    return;
  }

  el.innerHTML = '<div class="loading"><span class="spinner"></span>Loading friends\' wishlists…</div>';

  // Fetch wishlists for all friends in parallel
  var fetches = friends.map(function(f) {
    return sb.from('wishlists').select('card_data').eq('user_id', f.userId)
      .then(function(res) {
        if (res.error) { console.error('dash wishlist fetch error for', f.username, res.error.message); return []; }
        return (res.data || []).map(function(r) { return r.card_data; });
      })
      .then(function(cards) { return { friend: f, cards: cards }; });
  });

  Promise.all(fetches).then(function(results) {
    // Group by card ID so if two friends want the same card, it shows once with two badges
    var cardMap = {};
    results.forEach(function(r) {
      var f        = r.friend;
      var initials = (f.displayName || '?').slice(0, 2).toUpperCase();
      r.cards.forEach(function(card) {
        if (!cardMap[card.id]) cardMap[card.id] = { card: card, friends: [] };
        cardMap[card.id].friends.push({ name: f.displayName, color: f.color, initials: initials, budget: card._budget });
      });
    });

    var entries = Object.values(cardMap);
    if (!entries.length) {
      el.innerHTML = '<div class="empty" style="padding:30px 20px"><div class="em">👥</div><p>No friends wishlist items yet</p><small>Your friends haven\'t added any cards to their wishlists</small></div>';
      return;
    }

    el.innerHTML = '';
    var grid = document.createElement('div');
    grid.className = 'friends-card-grid';
    entries.forEach(function(entry) {
      var card = entry.card;
      var have = col.some(function(c) { return c.id === card.id; });
      var p    = getPrice(card);
      var wrap = document.createElement('div');
      wrap.className = 'fw-card-wrap pokemon-card';
      wrap.style.cursor = 'pointer';
      wrap.addEventListener('click', function() { openModal(card.id); });
      var img = document.createElement('img');
      img.src = (card.images && card.images.small) || '';
      img.alt = card.name; img.loading = 'lazy';
      wrap.appendChild(img);
      if (have) {
        var ownBadge = document.createElement('span');
        ownBadge.className = 'card-badge badge-own';
        ownBadge.textContent = '✓ Owned';
        wrap.appendChild(ownBadge);
      }
      var badgesWrap = document.createElement('div');
      badgesWrap.className = 'fw-friend-badges';
      entry.friends.forEach(function(fr) {
        var badge = document.createElement('div');
        badge.className = 'fw-friend-badge';
        badge.innerHTML =
          '<div class="fb-av" style="background:' + fr.color + '33;color:' + fr.color + '">' + fr.initials + '</div>' +
          '<span class="fb-name">' + fr.name + '</span>' +
          (fr.budget ? '<span class="fb-budget">£' + fr.budget.toFixed(0) + '</span>' : '');
        badgesWrap.appendChild(badge);
      });
      wrap.appendChild(badgesWrap);
      var info = document.createElement('div');
      info.className = 'cb2';
      info.innerHTML =
        '<div class="card-name">' + card.name + '</div>' +
        '<div class="card-set">' + ((card.set && card.set.name) || '') + '</div>' +
        '<div class="card-price">' + (p ? '£' + p.toFixed(2) : '—') + '</div>';
      wrap.appendChild(info);
      grid.appendChild(wrap);
    });
    el.appendChild(grid);
  });
}
// ── SEARCH ───────────────────────────────────────────────
function setType(t, el) {
  activeType = t;
  document.querySelectorAll('.filter-row .chip').forEach(function(c){c.classList.remove('active');});
  el.classList.add('active');
  if (document.getElementById('search-input').value.trim() || t) doSearch(1);
}

function doSearch(page) {
  curPage = page || 1;
  var q   = document.getElementById('search-input').value.trim();
  var art = document.getElementById('artist-input').value.trim();
  var el  = document.getElementById('search-results');
  var pag = document.getElementById('pager');
  if (!q && !activeType && !art) {
    el.innerHTML = '<div class="empty"><div class="em">🔍</div><p>Enter a name or artist to search</p></div>';
    pag.style.display = 'none'; return;
  }
  el.innerHTML = '<div class="loading"><span class="spinner"></span>Searching…</div>';
  pag.style.display = 'none';
  var qStr = '';
  if (q) qStr += 'name:"' + q + '*"';
  if (activeType) qStr += (qStr?' ':'') + 'types:' + activeType;
  if (art) qStr += (qStr?' ':'') + 'artist:"' + art + '*"';
  tcgGet({ path:'/cards', q:qStr, page:curPage, pageSize:20, orderBy:'-set.releaseDate' }).then(function(data) {
    var cards = data.data || [];
    totalCount = data.totalCount || 0;
    searchCache = cards;
    if (!cards.length) { el.innerHTML='<div class="empty"><div class="em">😢</div><p>No cards found</p></div>'; return; }
    el.innerHTML = '<div class="cards-grid">'+cards.map(tile).join('')+'</div>';
    var tp = Math.ceil(totalCount/20);
    if (tp > 1) {
      pag.style.display='flex';
      document.getElementById('page-info').textContent = 'Page '+curPage+' of '+tp+' ('+totalCount.toLocaleString()+' cards)';
      document.getElementById('prev-btn').disabled = curPage<=1;
      document.getElementById('next-btn').disabled = curPage>=tp;
    }
  }).catch(function() {
    el.innerHTML = '<div class="empty"><div class="em">⚠️</div><p>Search failed — please try again</p></div>';
  });
}

// ── FOLDERS ──────────────────────────────────────────────
function createFolder() {
  var input = document.getElementById('new-folder-name');
  var name = input.value.trim();
  if (!name) { showToast('Enter a folder name','tr'); return; }
  if (folders.find(function(f){return f.name.toLowerCase()===name.toLowerCase();})) { showToast('Folder already exists','tr'); return; }
  folders.push({ id: Date.now().toString(), name: name, cardIds: [] });
  saveFolders(); input.value = ''; renderCol(); showToast('Folder "'+name+'" created 📁');
}

function deleteFolder(id) {
  folders = folders.filter(function(f){return f.id!==id;});
  if (activeFolder === id) activeFolder = null;
  saveFolders(); renderCol(); showToast('Folder deleted');
}

function setActiveFolder(id) {
  activeFolder = id;
  document.getElementById('col-all-view').style.display = id ? 'none' : 'block';
  document.getElementById('col-folder-view').style.display = id ? 'block' : 'none';
  document.getElementById('folder-results').innerHTML = '';
  document.getElementById('folder-search-input').value = '';
  renderFolderTabs(); renderFolderCards();
}

function renderFolderTabs() {
  var html = '<button class="folder-tab '+(activeFolder?'':'active')+'" onclick="setActiveFolder(null)">📦 All Cards <span class="tab-count">'+col.length+'</span></button>';
  html += folders.map(function(f) {
    var count = f.cardIds.filter(function(id){return col.some(function(c){return c.id===id;});}).length;
    return '<button class="folder-tab '+(activeFolder===f.id?'active':'')+'" onclick="setActiveFolder(\''+f.id+'\')">'+
      '📁 '+f.name+' <span class="tab-count">'+count+'</span>'+
      '<span class="tab-del" onclick="event.stopPropagation();deleteFolder(\''+f.id+'\')" title="Delete">✕</span></button>';
  }).join('');
  html += '<button class="folder-tab" onclick="document.getElementById(\'new-folder-name\').focus()" style="border-style:dashed">+ New</button>';
  document.getElementById('folder-tabs').innerHTML = html;
}

function renderFolderCards() {
  if (!activeFolder) return;
  var f = folders.find(function(x){return x.id===activeFolder;}); if (!f) return;
  var cards = f.cardIds.map(function(id){return col.find(function(c){return c.id===id;});}).filter(Boolean);
  document.getElementById('folder-cards-label').textContent = cards.length + ' card'+(cards.length!==1?'s':'')+' in this folder';
  document.getElementById('folder-cards-grid').innerHTML = cards.length
    ? '<div class="cards-grid">'+cards.map(function(card){
        var p=getPrice(card);
        return '<div class="pokemon-card" onclick="openModal(\''+card.id+'\')">'+
          '<img src="'+(card.images&&card.images.small||'')+'" alt="'+card.name+'" loading="lazy">'+
          '<span class="card-badge" style="color:var(--green)">✓ In folder</span>'+
          '<div class="cb2"><div class="card-name">'+card.name+'</div>'+
          '<div class="card-set">'+((card.set&&card.set.name)||'')+' · '+(card.number||'')+'</div>'+
          '<div class="card-price">'+fp(p)+'</div></div>'+
          '<div style="padding:0 8px 8px"><button class="btn danger" style="width:100%;font-size:11px;padding:4px" onclick="event.stopPropagation();removeFromFolder(\''+card.id+'\')">Remove</button></div>'+
          '</div>';
      }).join('')+'</div>'
    : '<div class="empty"><div class="em">📁</div><p>No cards yet</p><small>Search above to add cards</small></div>';
}

function addToFolder(cardId) {
  var f = folders.find(function(x){return x.id===activeFolder;}); if (!f) return;
  if (!f.cardIds.includes(cardId)) { f.cardIds.push(cardId); saveFolders(); updateStats(); showToast('Added to folder 📁'); }
  renderFolderCards();
}

function removeFromFolder(cardId) {
  var f = folders.find(function(x){return x.id===activeFolder;}); if (!f) return;
  f.cardIds = f.cardIds.filter(function(id){return id!==cardId;});
  saveFolders(); renderFolderCards(); showToast('Removed from folder');
}

function folderSearch() {
  var q = document.getElementById('folder-search-input').value.trim();
  var el = document.getElementById('folder-results');
  if (!q) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span>Searching…</div>';
  tcgGet({ path:'/cards', q:'name:"'+q+'*"', page:1, pageSize:12, orderBy:'-set.releaseDate' }).then(function(data) {
    var cards = data.data || [];
    if (!cards.length) { el.innerHTML='<div class="empty"><div class="em">😢</div><p>No cards found</p></div>'; return; }
    var f = folders.find(function(x){return x.id===activeFolder;});
    el.innerHTML = '<div class="cards-grid">'+cards.map(function(card){
      var inF = f && f.cardIds.includes(card.id);
      var p = getPrice(card);
      var cardJson = JSON.stringify(card).replace(/"/g,'&quot;');
      return '<div class="pokemon-card">'+
        '<img src="'+(card.images&&card.images.small||'')+'" loading="lazy" onclick="openModal(\''+card.id+'\')">'+
        (inF?'<span class="card-badge" style="color:var(--green)">✓ Added</span>':'')+
        '<div class="cb2"><div class="card-name">'+card.name+'</div>'+
        '<div class="card-set">'+((card.set&&card.set.name)||'')+'</div>'+
        '<div class="card-price">'+fp(p)+'</div></div>'+
        '<div style="padding:0 8px 8px">'+(inF
          ? '<button class="btn danger" style="width:100%;font-size:11px;padding:4px" onclick="removeFromFolder(\''+card.id+'\');renderFolderCards()">Remove</button>'
          : '<button class="btn primary" style="width:100%;font-size:11px;padding:4px" onclick="addFromFolderSearch('+cardJson+',this)">+ Add to folder</button>'
        )+'</div></div>';
    }).join('')+'</div>';
  }).catch(function() { el.innerHTML='<div class="empty"><div class="em">⚠️</div><p>Search failed</p></div>'; });
}

function addFromFolderSearch(card, btn) {
  if (!col.some(function(c){return c.id===card.id;})) { col.push(card); dbAddCol(card); }
  addToFolder(card.id);
  btn.textContent='✓ Added'; btn.className='btn danger'; btn.style.cssText='width:100%;font-size:11px;padding:4px';
  btn.onclick=function(){removeFromFolder(card.id);btn.textContent='+ Add to folder';btn.className='btn primary';btn.onclick=function(){addFromFolderSearch(card,btn);};};
}

// ── COLLECTION ───────────────────────────────────────────
function renderCol() {
  folders = JSON.parse(localStorage.getItem('csq_folders_' + (currentUser&&currentUser.id||'')) || '[]');
  renderFolderTabs();
  if (activeFolder) {
    document.getElementById('col-all-view').style.display='none';
    document.getElementById('col-folder-view').style.display='block';
    renderFolderCards();
  } else {
    document.getElementById('col-all-view').style.display='block';
    document.getElementById('col-folder-view').style.display='none';
    document.getElementById('col-grid').innerHTML = col.length
      ? '<div class="cards-grid">'+col.map(colTile).join('')+'</div>'
      : '<div class="empty"><div class="em">📦</div><p>Your collection is empty</p></div>';
  }
}

function filterCol(q) {
  q = q.toLowerCase();
  var cards = col.filter(function(c){return c.name&&c.name.toLowerCase().includes(q)||c.set&&c.set.name&&c.set.name.toLowerCase().includes(q);});
  document.getElementById('col-grid').innerHTML = cards.length
    ? '<div class="cards-grid">'+cards.map(colTile).join('')+'</div>'
    : '<div class="empty"><div class="em">🔍</div><p>No matches</p></div>';
}

// ── WISHLIST ─────────────────────────────────────────────
function renderWish() {
  var el = document.getElementById('wish-content');
  if (!wish.length) { el.innerHTML='<div class="empty"><div class="em">⭐</div><p>Your wishlist is empty</p></div>'; return; }
  var rows = wish.map(function(card) {
    var bb = card._budget ? '<span class="wish-note-badge wish-budget-badge">💰 £'+card._budget.toFixed(2)+'</span>' : '';
    var nb = card._notes  ? '<span class="wish-note-badge" title="'+String(card._notes).replace(/"/g,'&quot;')+'">📝 '+(card._notes.length>30?card._notes.slice(0,30)+'…':card._notes)+'</span>' : '';
    return '<tr><td><img class="wish-thumb" src="'+(card.images&&card.images.small||'')+'" alt="'+card.name+'"></td>'+
      '<td><div style="font-weight:600">'+card.name+'</div><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">'+bb+nb+'</div></td>'+
      '<td style="color:var(--muted);font-size:12px">'+((card.set&&card.set.name)||'')+'</td>'+
      '<td style="color:var(--accent);font-weight:600">'+fp(getPrice(card))+'</td>'+
      '<td style="white-space:nowrap">'+
        '<button class="btn" style="padding:5px 8px;font-size:11px;margin-right:4px" onclick="openEditWish(\''+card.id+'\')">✏️</button>'+
        '<button class="btn primary" style="padding:5px 10px;font-size:12px" onclick="quickOwn(\''+card.id+'\')">+ Own it</button>'+
        '<button class="btn danger" style="padding:5px 10px;font-size:12px;margin-left:4px" onclick="delWish(\''+card.id+'\')">✕</button>'+
      '</td></tr>';
  }).join('');
  el.innerHTML='<table class="wish-table"><thead><tr><th></th><th>Card</th><th>Set</th><th>Price</th><th>Actions</th></tr></thead><tbody>'+rows+'</tbody></table>';
}

function delWish(id) { wish=wish.filter(function(c){return c.id!==id;}); renderWish(); updateStats(); showToast('Removed'); dbRemoveWish(id); }
function quickOwn(id) {
  var card=wish.find(function(c){return c.id===id;}); if(!card)return;
  if(!col.some(function(c){return c.id===id;})) col.push(card);
  wish=wish.filter(function(c){return c.id!==id;});
  renderWish(); updateStats();
  Promise.all([dbAddCol(card), dbRemoveWish(id)]).then(function(){
    showToast('Added to collection 📦');
  }).catch(function(e){ console.error('quickOwn error:',e); showToast('Added locally — sync may have failed','tr'); });
}

// ── FRIENDS ──────────────────────────────────────────────
var FRIENDS = []; // Demo friends removed

// ── FRIENDS ──────────────────────────────────────────────
var activeFriendId  = null;
var FRIEND_COLORS   = ['#5aaced','#4acf8a','#e85a6a','#9b7eff','#f0a030','#e8c84a'];
var _friendsCache   = null;   // accepted friends
var _pendingCache   = null;   // received requests (pending)
var _sentCache      = null;   // sent requests (pending)

function hashStr(s) {
  var h=0; for(var i=0;i<s.length;i++) h=(Math.imul(31,h)+s.charCodeAt(i))|0; return h;
}

// ── DB helpers ────────────────────────────────────────────
function dbFriendReq() { return sb && sb.from('friend_requests'); }

// Load all friend data from Supabase
function loadFriends() {
  if (!sb || !currentUser) { _friendsCache=[]; _pendingCache=[]; _sentCache=[]; return Promise.resolve(); }
  var myEmail = currentUser.email.toLowerCase();
  var myId    = currentUser.id;
  // Run two queries and merge: by user_id and by email
  var q1 = sb.from('friend_requests').select('*')
    .or('from_user_id.eq.'+myId+',to_user_id.eq.'+myId);
  var q2 = sb.from('friend_requests').select('*')
    .eq('to_email', myEmail).eq('status', 'pending');
  return Promise.all([q1, q2]).then(function(results) {
    var r1 = results[0].error ? [] : (results[0].data || []);
    var r2 = results[1].error ? [] : (results[1].data || []);
    // Merge and deduplicate by id
    var seen = {};
    var rows = [];
    r1.concat(r2).forEach(function(r) {
      if (!seen[r.id]) { seen[r.id] = true; rows.push(r); }
    });
    if (results[0].error) console.error('loadFriends q1:', results[0].error.message);
    if (results[1].error) console.error('loadFriends q2:', results[1].error.message);
    _friendsCache = rows.filter(function(r){ return r.status==='accepted'; });
    _pendingCache = rows.filter(function(r){
      return r.status==='pending' &&
        (r.to_user_id===myId || r.to_email===myEmail) &&
        r.from_user_id!==myId;
    });
    _sentCache = rows.filter(function(r){ return r.status==='pending' && r.from_user_id===myId; });
    console.log('loadFriends: accepted='+_friendsCache.length+' pending='+_pendingCache.length+' sent='+_sentCache.length);
  });
}

// Link pending requests sent to my email to my user_id, then reload
function matchPendingFriendRequests() {
  if (!sb || !currentUser) return Promise.resolve();
  var myEmail = currentUser.email.toLowerCase();
  var myUname = (profileData && profileData.username) || '';
  // First: upsert this user into user_profiles so others can find them by username
  if (myUname) {
    sb.from('user_profiles').upsert({
      user_id:  currentUser.id,
      email:    myEmail,
      username: myUname
    }, { onConflict: 'user_id' }).then(function(r){
      if (r.error) console.warn('upsert profile:', r.error.message);
    });
  }
  // Update any pending requests sent to my email OR my username
  var updateByEmail = sb.from('friend_requests')
    .update({ to_user_id: currentUser.id })
    .eq('to_email', myEmail).is('to_user_id', null);
  var updateByUsername = myUname
    ? sb.from('friend_requests')
        .update({ to_user_id: currentUser.id, to_email: myEmail })
        .eq('to_username', myUname).is('to_user_id', null)
    : Promise.resolve();
  return Promise.all([updateByEmail, updateByUsername]).then(function(results) {
    results.forEach(function(r){ if(r && r.error) console.warn('matchPending error:', r.error.message); });
    return loadFriends();
  });
}

// Send a friend request by email
function sendFriendRequest() {
  var input    = document.getElementById('add-friend-input').value.trim();
  var statusEl = document.getElementById('add-friend-status');
  statusEl.style.color = 'var(--muted)';
  statusEl.textContent = '';

  if (!input) { statusEl.style.color='var(--red)'; statusEl.textContent='Enter a username or email.'; return; }
  if (!sb)    { statusEl.style.color='var(--red)'; statusEl.textContent='Not connected to server.'; return; }

  var myEmail = currentUser.email.toLowerCase();
  var myUname = profileData.username || myEmail.split('@')[0];

  // Check not adding yourself
  if (input.toLowerCase() === myEmail || input.toLowerCase() === (profileData.username||'').toLowerCase()) {
    statusEl.style.color='var(--red)'; statusEl.textContent='You can not add yourself!'; return;
  }

  statusEl.textContent = 'Looking up user…';

  // If it looks like an email, use it directly
  if (input.includes('@')) {
    doSendRequest(input.toLowerCase(), null, myUname, statusEl);
  } else {
    // Look up username in user_profiles table
    sb.from('user_profiles').select('email,username').ilike('username', input)
      .then(function(res) {
        if (res.error || !res.data || !res.data.length) {
          // Username not found in profiles - still send by username so they see it on login
          statusEl.style.color='var(--muted)';
          statusEl.textContent = 'Username not found yet — sending request anyway. They will see it when they next open the app.';
          doSendRequestByUsername(input, myUname, statusEl);
          return;
        }
        var found = res.data[0];
        doSendRequest(found.email.toLowerCase(), found.username, myUname, statusEl);
      });
  }
}

function doSendRequest(toEmail, toUsername, fromUsername, statusEl) {
  // Check not already sent
  sb.from('friend_requests').select('id')
    .eq('from_user_id', currentUser.id).eq('to_email', toEmail)
    .then(function(res) {
      if (res.data && res.data.length > 0) {
        statusEl.style.color='var(--muted)'; statusEl.textContent='Request already sent.'; return;
      }
      sb.from('friend_requests').insert({
        from_user_id:   currentUser.id,
        from_email:     currentUser.email.toLowerCase(),
        from_username:  fromUsername,
        to_email:       toEmail,
        to_username:    toUsername || null,
        to_user_id:     null,
        status:         'pending',
        created_at:     new Date().toISOString()
      }).then(function(ins) {
        if (ins.error) {
          statusEl.style.color='var(--red)'; statusEl.textContent='Error: '+ins.error.message; return;
        }
        document.getElementById('add-friend-input').value = '';
        loadFriends().then(renderFriends);
        showFriendRequestSentPanel(toUsername||toEmail, fromUsername);
      });
    });
}

function doSendRequestByUsername(toUsername, fromUsername, statusEl) {
  // Send without an email - store by username, they will claim it on login
  sb.from('friend_requests').select('id')
    .eq('from_user_id', currentUser.id).eq('to_username', toUsername)
    .then(function(res) {
      if (res.data && res.data.length > 0) {
        statusEl.style.color='var(--muted)'; statusEl.textContent='Request already sent.'; return;
      }
      sb.from('friend_requests').insert({
        from_user_id:   currentUser.id,
        from_email:     currentUser.email.toLowerCase(),
        from_username:  fromUsername,
        to_email:       null,
        to_username:    toUsername,
        to_user_id:     null,
        status:         'pending',
        created_at:     new Date().toISOString()
      }).then(function(ins) {
        if (ins.error) {
          statusEl.style.color='var(--red)'; statusEl.textContent='Error: '+ins.error.message; return;
        }
        document.getElementById('add-friend-input').value = '';
        loadFriends().then(renderFriends);
        showFriendRequestSentPanel(toUsername, fromUsername);
      });
    });
}


// Accept a friend request
function acceptFriendRequest(reqId, fromEmail, fromUsername) {
  if (!sb) return;
  // Update the request to accepted + fill in to_user_id
  sb.from('friend_requests').update({ status: 'accepted', to_user_id: currentUser.id }).eq('id', reqId)
    .then(function(res) {
      if (res.error) { showToast('Error accepting request', 'tr'); return; }
      showToast('You and ' + fromUsername + ' are now friends! 👥');
      loadFriends().then(renderFriends);
    });
}

// Decline / cancel a friend request
function declineFriendRequest(reqId) {
  if (!sb) return;
  sb.from('friend_requests').delete().eq('id', reqId)
    .then(function(res) {
      if (res.error) { showToast('Error', 'tr'); return; }
      showToast('Request removed');
      loadFriends().then(renderFriends);
    });
}

// Remove an accepted friend
function removeFriend(reqId) {
  if (!sb) return;
  sb.from('friend_requests').delete().eq('id', reqId)
    .then(function(res) {
      if (res.error) { showToast('Error', 'tr'); return; }
      if (activeFriendId === reqId) {
        activeFriendId = null;
        document.getElementById('friend-detail-wrap').innerHTML = '<div class="empty" style="padding:60px 20px"><div class="em">👥</div><p>Select a friend to view their wishlist</p></div>';
      }
      showToast('Friend removed');
      loadFriends().then(renderFriends);
    });
}

// Show copyable message after sending a friend request
function showFriendRequestSentPanel(toEmail, fromUsername) {
  var msg = 'Hey! I just sent you a friend request on Collective (my Pokemon card collection app). Open the app with your email address ('+toEmail+') to accept it and see my collection. My username is: '+fromUsername;
  var statusEl = document.getElementById('add-friend-status');
  if (!statusEl) return;
  statusEl.style.color = 'var(--green)';
  statusEl.innerHTML = 'Request saved! Copy the message below and send it to your friend:';
  var existingBox = document.getElementById('invite-msg-box');
  if (existingBox) existingBox.remove();
  var box = document.createElement('div');
  box.id = 'invite-msg-box';
  box.style.cssText = 'margin-top:10px;background:var(--bg3);border:1px solid var(--border2);border-radius:10px;padding:12px;font-size:12px;color:var(--text);line-height:1.6;';
  box.textContent = msg;
  var copyBtn = document.createElement('button');
  copyBtn.className = 'btn primary';
  copyBtn.style.cssText = 'width:100%;margin-top:8px;font-size:12px;padding:7px;';
  copyBtn.textContent = 'Copy message to send to friend';
  copyBtn.addEventListener('click', function() {
    var doCopy = function() {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(msg).then(function(){ copyBtn.textContent='Copied!'; setTimeout(function(){ copyBtn.textContent='Copy message to send to friend'; },3000); });
      } else {
        var ta=document.createElement('textarea'); ta.value=msg; ta.style.position='fixed'; ta.style.left='-9999px';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); copyBtn.textContent='Copied!'; setTimeout(function(){ copyBtn.textContent='Copy message to send to friend'; },3000); } catch(e){}
        document.body.removeChild(ta);
      }
    };
    doCopy();
  });
  box.appendChild(copyBtn);
  statusEl.parentNode.insertBefore(box, statusEl.nextSibling);
}

// Main render
function renderFriends() {
  // Always reload from Supabase to get latest requests
  loadFriends().then(function() {
    renderPendingRequests();
    renderFriendsList();
  });
}

function renderPendingRequests() {
  var pending = _pendingCache || [];
  var sent    = _sentCache    || [];
  var badge   = document.getElementById('pending-badge');
  var listEl  = document.getElementById('pending-list');
  if (!listEl) return;
  // Badge on the panel header
  if (badge) {
    if (pending.length > 0) { badge.style.display='inline-block'; badge.textContent=pending.length; }
    else { badge.style.display='none'; }
  }
  listEl.innerHTML = '';
  if (!pending.length && !sent.length) {
    listEl.innerHTML = '<p style="font-size:12px;color:var(--muted);padding:4px 0;">No pending requests</p>';
    return;
  }
  // Incoming requests
  pending.forEach(function(req) {
    var row = document.createElement('div');
    row.className = 'pending-row';
    var initials = (req.from_username||req.from_email||'?').slice(0,2).toUpperCase();
    row.innerHTML =
      '<div class="p-av">'+initials+'</div>'+
      '<div class="p-info">'+
        '<div class="p-email">'+(req.from_username||req.from_email)+'</div>'+
        '<div class="p-sub">'+req.from_email+' wants to be your friend</div>'+
      '</div>'+
      '<div class="p-actions">'+
        '<button class="btn primary" style="padding:4px 10px;font-size:11px;" id="acc-'+req.id+'">✓ Accept</button>'+
        '<button class="btn danger" style="padding:4px 8px;font-size:11px;" id="dec-'+req.id+'">✕</button>'+
      '</div>';
    row.querySelector('#acc-'+req.id).addEventListener('click', function(){ acceptFriendRequest(req.id, req.from_email, req.from_username||req.from_email); });
    row.querySelector('#dec-'+req.id).addEventListener('click', function(){ declineFriendRequest(req.id); });
    listEl.appendChild(row);
  });
  // Sent / outgoing requests
  if (sent.length) {
    var sentHeader = document.createElement('p');
    sentHeader.style.cssText = 'font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:10px 0 6px;';
    sentHeader.textContent = 'Sent';
    listEl.appendChild(sentHeader);
    sent.forEach(function(req) {
      var row = document.createElement('div');
      row.className = 'sent-row';
      row.innerHTML =
        '<div class="s-info">Waiting for <strong>'+req.to_email+'</strong> to accept…</div>'+
        '<button class="s-cancel" id="cancel-'+req.id+'">Cancel</button>';
      row.querySelector('#cancel-'+req.id).addEventListener('click', function(){ declineFriendRequest(req.id); });
      listEl.appendChild(row);
    });
  }
}

function renderFriendsList() {
  var friends = _friendsCache || [];
  var allFriends = friends.slice();
  var listEl = document.getElementById('friend-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!allFriends.length) {
    listEl.innerHTML = '<p style="font-size:12px;color:var(--muted);padding:4px 0;">No friends yet — send a request above</p>';
    return;
  }
  allFriends.forEach(function(f) {
    var isMe    = f.from_user_id === currentUser.id;
    var name    = f._demo ? f.displayName : (isMe ? (f.to_username||f.to_email) : (f.from_username||f.from_email));
    var color   = f.color || FRIEND_COLORS[Math.abs(hashStr((f.id||'').toString()))%FRIEND_COLORS.length];
    var initials= (name||'?').slice(0,2).toUpperCase();
    var row = document.createElement('div');
    row.className = 'friend-row' + (activeFriendId===f.id?' active':'');
    row.innerHTML =
      '<div class="f-av-sm" style="background:'+color+'22;color:'+color+'">'+initials+'</div>'+
      '<div class="f-info"><div class="fname">'+name+'</div>'+
      '<div class="floc">'+(f._demo ? 'Demo friend' : 'Friend')+'</div></div>';
    row.addEventListener('click', function(){ viewFriend(f); });
    if (!f._demo) {
      var del = document.createElement('button');
      del.className='f-del'; del.title='Remove'; del.textContent='✕';
      del.addEventListener('click', function(e){ e.stopPropagation(); removeFriend(f.id); });
      row.appendChild(del);
    }
    listEl.appendChild(row);
  });
}

function viewFriend(f) {
  activeFriendId = f.id;
  renderFriendsList();
  var isMe     = f.from_user_id === currentUser.id;
  var name     = f._demo ? f.displayName : (isMe ? (f.to_username||f.to_email) : (f.from_username||f.from_email));
  var color    = f.color || FRIEND_COLORS[Math.abs(hashStr((f.id||'').toString()))%FRIEND_COLORS.length];
  var initials = (name||'?').slice(0,2).toUpperCase();
    // Get the friend's user ID - could be null if they haven't logged in yet to claim request
  var friendUserId = f._demo ? null : (isMe ? f.to_user_id : f.from_user_id);
  console.log("CURRENT USER:", currentUser.id);
console.log("FROM USER:", f.from_user_id);
console.log("TO USER:", f.to_user_id);
console.log("IS ME:", isMe);
console.log("FRIEND USER ID:", friendUserId);
  var friendEmail  = f._demo ? null : (isMe ? f.to_email : f.from_email);
  var wrap = document.getElementById('friend-detail-wrap');
if (!wrap) return;
  wrap.innerHTML = '<div class="loading"><span class="spinner"></span>Loading wishlist...</div>';

  var cardsPromise;
  if (friendUserId && sb) {
    // Fetch by user_id
    cardsPromise = sb.from('wishlists').select('card_data').eq('user_id', friendUserId)
      .then(function(res) {
        if (res.error) {
          console.error('viewFriend wishlist error:', res.error.message);
          if (res.error.message.includes('policy') || res.error.code === '42501') {
            // RLS is blocking - show SQL fix instruction
            var rlsDiv = document.createElement('div');
            rlsDiv.className = 'friend-detail';
            rlsDiv.innerHTML = '<div style="padding:30px 20px;text-align:center;"><div style="font-size:36px;margin-bottom:12px">🔒</div><p style="font-weight:600;color:var(--red);">Wishlist access blocked</p><p style="font-size:12px;color:var(--muted);margin-top:8px;line-height:1.6;">Run this SQL in Supabase to fix:<br><br><code style="background:var(--bg3);padding:6px 10px;border-radius:6px;font-size:11px;display:block;text-align:left;margin-top:6px;">create policy \"Friends can view wishlists\" on wishlists for select using (auth.uid() is not null);</code></p></div>';
            wrap.innerHTML = ''; wrap.appendChild(rlsDiv);
          }
          console.log("Wishlist raw rows:", res.data);
          return [];
        }
        var cards = (res.data||[]).map(function(r){ return r.card_data; });
        console.log('viewFriend: loaded', cards.length, 'wishlist cards for', name);
        return cards;
      });
  } else if (!friendUserId && !f._demo) {
    // to_user_id is null - friend hasn't logged in yet to claim the request
    wrap.innerHTML = '<div class="friend-detail"><div style="padding:40px 20px;text-align:center;color:var(--muted)"><div style="font-size:40px;margin-bottom:12px">⏳</div><p style="font-weight:600;">'+name+' has not signed in yet</p><p style="font-size:12px;margin-top:8px;">Their wishlist will appear once they open Collective and log in with their account.</p></div></div>';
    return;
  } else {
    cardsPromise = Promise.resolve([]);
  }

  cardsPromise.then(function(cards) {
    function buildWishHtml(cards) {
      if (!cards.length) return '<div class="empty" style="padding:30px 0"><div class="em">⭐</div><p style="font-size:13px">No wishlist items yet</p></div>';
      return cards.map(function(card) {
        var have   = col.some(function(c){return c.id===card.id;});
        var budget = card._budget ? '<span class="wish-note-badge wish-budget-badge">💰 £'+card._budget.toFixed(2)+'</span>' : '';
        var notes  = card._notes  ? '<div style="font-size:11px;color:var(--muted);margin-top:3px">📝 '+card._notes+'</div>' : '';
        return '<div class="fw-item">' +
          '<img src="'+(card.images&&card.images.small||'')+'" style="width:36px;border-radius:4px" onerror="this.style.opacity=0">' +
          '<div style="flex:1"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span style="font-weight:600">'+card.name+'</span>'+budget+'</div>' +
          (card.set ? '<div style="font-size:11px;color:var(--muted)">'+card.set.name+'</div>' : '')+notes+'</div>' +
          '<span class="fw-tag" style="background:'+(have?'rgba(74,207,138,0.15)':'rgba(136,136,150,0.15)')+';color:'+(have?'var(--green)':'var(--muted)')+'">'+
          (have?'✓ You have it':'Wanted')+'</span></div>';
      }).join('');
    }
    wrap.innerHTML =
      '<div class="friend-detail">' +
      '<div class="friend-detail-header">' +
        '<div class="friend-detail-av" style="background:'+color+'22;color:'+color+'">'+initials+'</div>' +
        '<div><div style="font-weight:700;font-size:18px">'+name+'</div>' +
        '<div style="font-size:12px;color:var(--muted)">'+(f._demo?'Demo account':'Friend')+'</div></div>' +
      '</div>' +
      '<p style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:14px">Wishlist · '+cards.length+' cards</p>' +
      buildWishHtml(cards) + '</div>';
  });
}


// ── PROFILE ───────────────────────────────────────────────
var profileData = {};

function loadProfile() {
  if (!currentUser) return;
  var raw = localStorage.getItem('profile_'+currentUser.id);
  profileData = raw ? JSON.parse(raw) : {};
  var meta = currentUser.user_metadata || {};
  profileData.username    = profileData.username    || meta.username    || currentUser.email.split('@')[0];
  profileData.displayName = profileData.displayName || '';
  profileData.location    = profileData.location    || '';
  profileData.bio         = profileData.bio         || '';
  profileData.avatar      = profileData.avatar      || '';
  document.getElementById('sb-name').textContent = profileData.username;
  var locEl = document.getElementById('sb-location');
  if (locEl) locEl.textContent = profileData.location || '';
  updateSidebarAvatar();
}
function saveProfileData() {
  if (currentUser) localStorage.setItem('profile_'+currentUser.id, JSON.stringify(profileData));
}
function updateSidebarAvatar() {
  var av = document.getElementById('sb-avatar');
  if (profileData.avatar) {
    av.innerHTML='<img src="'+profileData.avatar+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
  } else {
    av.textContent = (profileData.username||'?')[0].toUpperCase();
  }
}
function renderProfile() {
  loadProfile();
  document.getElementById('pf-username').value    = profileData.username    || '';
  document.getElementById('pf-displayname').value = profileData.displayName || '';
  document.getElementById('pf-location').value    = profileData.location    || '';
  document.getElementById('pf-bio').value         = profileData.bio         || '';
  var avEl = document.getElementById('profile-avatar-display');
  if (profileData.avatar) {
    avEl.innerHTML='<img src="'+profileData.avatar+'" style="width:100%;height:100%;object-fit:cover;">';
  } else {
    avEl.textContent = (profileData.username||'?')[0].toUpperCase();
  }
}
function saveProfile() {
  profileData.username    = document.getElementById('pf-username').value.trim()    || profileData.username;
  profileData.displayName = document.getElementById('pf-displayname').value.trim();
  profileData.location    = document.getElementById('pf-location').value.trim();
  profileData.bio         = document.getElementById('pf-bio').value.trim();
  saveProfileData(); loadProfile();
  showToast('Profile saved ✓');
}
function handleAvatarUpload(input) {
  var file=input.files[0]; if(!file) return;
  if(file.size > 2*1024*1024) { showToast('Image too large — please use a smaller photo (under 2MB)','tr'); return; }
  var reader=new FileReader();
  reader.onload=function(e){ profileData.avatar=e.target.result; saveProfileData(); loadProfile(); renderProfile(); showToast('Profile picture updated ✓'); };
  reader.readAsDataURL(file);
}

// ── CONFIRM / DELETE ACCOUNT ──────────────────────────────
var _confirmCb = null;
function showConfirm(title, msg, label, cb) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent   = msg;
  document.getElementById('confirm-yes-btn').textContent = label||'Yes';
  _confirmCb = cb;
  document.getElementById('confirm-overlay').classList.add('open');
}
function closeConfirm() { document.getElementById('confirm-overlay').classList.remove('open'); _confirmCb=null; }
function confirmYes() { closeConfirm(); if(_confirmCb) _confirmCb(); }
function confirmDeleteAccount() {
  showConfirm('Delete Account','This permanently deletes your account and all data. This cannot be undone.','🗑 Delete Everything', function() {
    if (!currentUser||!sb) return;
    var uid = currentUser.id;
    Promise.all([
      sb.from('collections').delete().eq('user_id',uid),
      sb.from('wishlists').delete().eq('user_id',uid)
    ]).finally(function(){
      ['binder2_','trades_','pokedex_','csq_folders_','friends_','profile_'].forEach(function(k){ localStorage.removeItem(k+uid); });
      showToast('Data cleared. Signing out…');
      setTimeout(function(){ sb.auth.signOut(); }, 1500);
    });
  });
}


// ── BINDER ───────────────────────────────────────────────
var binderUndoStack = [];   // stack of page snapshots before each change
var binderDirty = false;    // unsaved changes flag

function markBinderDirty() {
  binderDirty = true;
  var dot   = document.getElementById('binder-save-dot');
  var label = document.getElementById('binder-save-label');
  var ind   = document.getElementById('binder-save-indicator');
  if (dot)   dot.classList.add('unsaved');
  if (label) label.textContent = 'Unsaved changes';
  if (ind)   ind.classList.add('unsaved');
  var undoBtn = document.getElementById('binder-undo-btn');
  if (undoBtn) undoBtn.disabled = binderUndoStack.length === 0;
}

function markBinderClean() {
  binderDirty = false;
  var dot   = document.getElementById('binder-save-dot');
  var label = document.getElementById('binder-save-label');
  var ind   = document.getElementById('binder-save-indicator');
  if (dot)   dot.classList.remove('unsaved');
  if (label) label.textContent = 'All changes saved';
  if (ind)   ind.classList.remove('unsaved');
}

function pushBinderUndo() {
  // Save a deep copy of current page state before making a change
  binderUndoStack.push(JSON.parse(JSON.stringify(binder[binderPage])));
  if (binderUndoStack.length > 30) binderUndoStack.shift(); // cap at 30 steps
  var undoBtn = document.getElementById('binder-undo-btn');
  if (undoBtn) undoBtn.disabled = false;
}

function saveBinderManual() {
  saveBinder();
  markBinderClean();
  showToast('Binder saved 💾');
}

function undoBinder() {
  if (!binderUndoStack.length) return;
  binder[binderPage] = binderUndoStack.pop();
  renderBinderEdit();
  renderBinderCardList();
  markBinderDirty();
  if (!binderUndoStack.length) {
    var undoBtn = document.getElementById('binder-undo-btn');
    if (undoBtn) undoBtn.disabled = true;
  }
  showToast('Undone ↩');
}

var bsSource = 'collection';  // 'collection' or 'tcg'
var bsColType = '';
var bsTcgPage = 1;
var bsTcgCache = [];

function renderBinder() { showBinderOverview(); }

function setBsSource(src, el) {
  bsSource = src;
  document.querySelectorAll('.bs-source-tab[id^="bs-tab"]').forEach(function(t){t.classList.remove('active');});
  el.classList.add('active');
  document.getElementById('bs-col-filters').style.display = src==='collection' ? 'block' : 'none';
  document.getElementById('bs-tcg-filters').style.display = src==='tcg' ? 'block' : 'none';
  document.getElementById('bs-pager').style.display = 'none';
  if (src==='collection') renderBinderCardList();
  else { document.getElementById('bs-results').innerHTML = '<p style="color:var(--muted);font-size:13px;padding:8px 0">Enter a name above and click Search</p>'; }
}

function setBsType(t, el) {
  bsColType = t;
  document.querySelectorAll('#bs-col-types .bs-source-tab').forEach(function(c){c.classList.remove('active');});
  el.classList.add('active');
  renderBinderCardList();
}

function populateBsSetDropdown() {
  var sets = {};
  col.forEach(function(c){ if (c.set && c.set.name) sets[c.set.id||c.set.name] = c.set.name; });
  var sel = document.getElementById('bs-col-set');
  var current = sel.value;
  sel.innerHTML = '<option value="">All Sets</option>';
  Object.keys(sets).sort().forEach(function(k){
    var o = document.createElement('option');
    o.value = k; o.textContent = sets[k];
    sel.appendChild(o);
  });
  if (current) sel.value = current;
}

function renderBinderCardList() {
  populateBsSetDropdown();
  var q = (document.getElementById('bs-col-q').value||'').toLowerCase();
  var setFilter = document.getElementById('bs-col-set').value;
  var allPlaced = binder.flat();
  var cards = col.filter(function(c){
    if (q && !(c.name||'').toLowerCase().includes(q)) return false;
    if (setFilter && (c.set&&(c.set.id||c.set.name))!==setFilter) return false;
    if (bsColType && !(c.types||[]).includes(bsColType)) return false;
    return true;
  });
  var el = document.getElementById('bs-results');
  if (!col.length) { el.innerHTML='<p style="color:var(--muted);font-size:13px;padding:8px 0">Add cards to your collection to place them here.</p>'; return; }
  if (!cards.length) { el.innerHTML='<p style="color:var(--muted);font-size:13px;padding:8px 0">No cards match these filters.</p>'; return; }
  var grid = document.createElement('div');
  grid.className = 'bs-results';
  cards.forEach(function(card) {
    var inB = allPlaced.includes(card.id);
    var div = document.createElement('div');
    div.className = 'bs-card' + (inB?' in-binder':'');
    div.innerHTML = '<img src="'+(card.images&&card.images.small||'')+'" alt="'+card.name+'" loading="lazy">'+(inB?'<span class="bs-placed">✓</span>':'')+'<div class="bs-name">'+card.name+'</div>';
    if (!inB) div.addEventListener('click', function(){ bsPlaceCard(card.id); });
    grid.appendChild(div);
  });
  el.innerHTML = '';
  el.appendChild(grid);
}


function binderTcgSearch(page) {
  bsTcgPage = page || 1;
  var q      = document.getElementById('bs-tcg-q').value.trim();
  var type   = document.getElementById('bs-tcg-type').value;
  var rarity = document.getElementById('bs-tcg-rarity').value;
  var sub    = document.getElementById('bs-tcg-subtype').value;
  var set    = document.getElementById('bs-tcg-set').value.trim();
  var artist = document.getElementById('bs-tcg-artist').value.trim();
  var el     = document.getElementById('bs-results');
  if (!q && !type && !rarity && !sub && !set && !artist) {
    el.innerHTML='<p style="color:var(--muted);font-size:13px;padding:8px 0">Enter at least one filter above and click Search.</p>'; return;
  }
  el.innerHTML='<div style="padding:20px;text-align:center;color:var(--muted)"><span class="spinner"></span>Searching…</div>';
  var qParts = [];
  if (q)      qParts.push('name:"'+q+'*"');
  if (type)   qParts.push('types:'+type);
  if (rarity) qParts.push('rarity:"'+rarity+'"');
  if (sub)    qParts.push('subtypes:"'+sub+'"');
  if (set)    qParts.push('set.name:"'+set+'*"');
  if (artist) qParts.push('artist:"'+artist+'*"');
  tcgGet({ path:'/cards', q:qParts.join(' '), page:bsTcgPage, pageSize:20, orderBy:'-set.releaseDate' }).then(function(data){
    var cards = data.data || [];
    bsTcgCache = cards;
    var total  = data.totalCount || 0;
    var allPlaced = binder.flat();
    if (!cards.length) { el.innerHTML='<p style="color:var(--muted);font-size:13px;padding:8px 0">No cards found.</p>'; document.getElementById('bs-pager').style.display='none'; return; }
    var grid = document.createElement('div');
    grid.className = 'bs-results';
    cards.forEach(function(card) {
      var inB   = allPlaced.includes(card.id);
      var inCol = col.some(function(c){return c.id===card.id;});
      var div = document.createElement('div');
      div.className = 'bs-card' + (inB?' in-binder':'');
      div.innerHTML = '<img src="'+(card.images&&card.images.small||'')+'" alt="'+card.name+'" loading="lazy">'+(inB?'<span class="bs-placed">✓</span>':'')+(inCol&&!inB?'<span class="bs-placed" style="top:auto;bottom:4px;color:var(--blue)">📦</span>':'')+'<div class="bs-name">'+card.name+'</div>';
      if (!inB) div.addEventListener('click', function(){ bsPlaceCard(card.id); });
      grid.appendChild(div);
    });
    el.innerHTML=''; el.appendChild(grid);
    var tp = Math.ceil(total/20);
    if (tp>1) {
      document.getElementById('bs-pager').style.display='flex';
      document.getElementById('bs-page-info').textContent='Page '+bsTcgPage+' of '+tp;
      document.getElementById('bs-prev').disabled=bsTcgPage<=1;
      document.getElementById('bs-next').disabled=bsTcgPage>=tp;
    } else { document.getElementById('bs-pager').style.display='none'; }
  }).catch(function(){
    el.innerHTML='<p style="color:var(--red);font-size:13px;padding:8px 0">Search failed — please try again.</p>';
  });
}


function bsPlaceCard(id) {
  if (selSlot===null) { showToast('Select a binder slot first ↑','tr'); return; }
  var card = col.find(function(c){return c.id===id;}) || bsTcgCache.find(function(c){return c.id===id;});
  if (!card) return;
  pushBinderUndo();
  if (!col.some(function(c){return c.id===id;})) {
    col.push(card); dbAddCol(card).then(function(){ updateStats(); });
  }
  binder[binderPage][selSlot]=id; selSlot=null;
  renderBinderEdit(); renderBinderCardList();
  markBinderDirty();
  showToast('Card placed — save when ready 🗂️');
}

function showBinderOverview() {
  document.getElementById('binder-overview-view').style.display='block';
  document.getElementById('binder-edit-view').style.display='none';
  selSlot=null;
  if (!binder.length) binder=[Array(9).fill(null)];
  document.getElementById('binder-overview').innerHTML = binder.map(function(page,pi){
    var filled=page.filter(Boolean).length;
    var slots=page.map(function(id){
      var card=id?col.find(function(c){return c.id===id;}):null;
      return '<div class="pc-slot">'+(card?'<img src="'+(card.images&&card.images.small||'')+'" alt="'+card.name+'">':'·')+'</div>';
    }).join('');
    return '<div class="binder-page-card" onclick="openBinderPage('+pi+')">'+
      '<div class="pc-title">Page '+(pi+1)+' <span style="font-size:11px;color:var(--muted);font-weight:400">'+filled+'/9</span></div>'+
      '<div class="pc-sub">'+(filled===0?'Empty':filled===9?'Full':(9-filled)+' slots free')+'</div>'+
      '<div class="pc-grid">'+slots+'</div></div>';
  }).join('');
}

function openBinderPage(pi) {
  binderPage=pi;
  binderUndoStack=[];
  binderDirty=false;
  bsSource='collection'; bsTcgPage=1;
  document.getElementById('binder-overview-view').style.display='none';
  document.getElementById('binder-edit-view').style.display='block';
  document.getElementById('binder-edit-title').textContent='Page '+(pi+1);
  document.getElementById('bs-col-filters').style.display='block';
  document.getElementById('bs-tcg-filters').style.display='none';
  document.getElementById('bs-pager').style.display='none';
  document.getElementById('bs-tab-col').classList.add('active');
  document.getElementById('bs-tab-tcg').classList.remove('active');
  renderBinderEdit();
  renderBinderCardList();
}

function renderBinderEdit() {
  var page=binder[binderPage]||Array(9).fill(null);
  document.getElementById('binder-grid').innerHTML=page.map(function(id,i){
    var card=id?col.find(function(c){return c.id===id;}):null;
    return '<div class="binder-slot '+(card?'filled':'')+' '+(selSlot===i?'sel':'')+'" onclick="selectSlot('+i+')">'+
      (card?'<img src="'+(card.images&&card.images.small||'')+'" alt="'+card.name+'"><button class="rm-btn" onclick="event.stopPropagation();clearSlot('+i+')">✕</button>':'+')+'</div>';
  }).join('');
  var list=document.getElementById('binder-list');
  if (!col.length) { list.innerHTML='<p style="color:var(--muted);font-size:13px">Add cards to your collection first.</p>'; return; }
  var allPlaced=binder.flat();
  list.innerHTML=col.map(function(card){
    var inB=allPlaced.includes(card.id);
    return '<div class="bp-item '+(inB?'in-binder':'')+'" onclick="'+(inB?'':'placeCard(\''+card.id+'\')')+'">'+
      '<img src="'+(card.images&&card.images.small||'')+'" alt="'+card.name+'">'+
      '<div><div class="bp-name">'+card.name+'</div><div class="bp-set">'+((card.set&&card.set.name)||'')+'</div></div>'+
      '<span style="font-size:11px;color:var(--muted)">'+(inB?'Placed':'Place')+'</span></div>';
  }).join('');
}

function addBinderPage() { binder.push(Array(9).fill(null)); saveBinder(); showBinderOverview(); showToast('New page added 🗂️'); }
function deleteBinderPage() {
  if (binder.length<=1) { showToast('You need at least one page','tr'); return; }
  binder.splice(binderPage,1); saveBinder(); showBinderOverview(); showToast('Page deleted');
}
function selectSlot(i) { selSlot=i; renderBinderEdit(); if(bsSource==='collection')renderBinderCardList(); }
function placeCard(id) {
  if (selSlot===null) { showToast('Select a slot first','tr'); return; }
  pushBinderUndo();
  binder[binderPage][selSlot]=id; selSlot=null;
  renderBinderEdit();
  if (bsSource==='collection') renderBinderCardList();
  markBinderDirty();
  showToast('Card placed — save when ready 🗂️');
}
function clearSlot(i) {
  pushBinderUndo();
  binder[binderPage][i]=null;
  renderBinderEdit();
  if (bsSource==='collection') renderBinderCardList();
  markBinderDirty();
}

// ── TRADE ZONE ───────────────────────────────────────────────────────────
var tradeTab = 'mine';

function setTradeTab(tab, el) {
  tradeTab = tab;
  document.querySelectorAll('.trade-tab').forEach(function(t){ t.classList.remove('active'); });
  el.classList.add('active');
  renderTrade();
}

function dbSaveTrade(t) {
  if (!sb || !currentUser) return Promise.resolve();
  var uname = profileData.username || currentUser.email.split('@')[0];
  return sb.from('trades').upsert({
    id: t.id, user_id: currentUser.id, username: uname,
    card_id: t.cardId||t.card_id, card_data: t.cardSnap||t.card_data, status: t.status
  }, { onConflict: 'id' }).then(function(res){ if (res.error) console.error('dbSaveTrade:', res.error.message); return res; });
}
function dbDeleteTrade(id) {
  if (!sb || !currentUser) return Promise.resolve();
  return sb.from('trades').delete().eq('id', id);
}
function dbLoadMyTrades() {
  if (!sb || !currentUser) return Promise.resolve([]);
  return sb.from('trades').select('*').eq('user_id', currentUser.id)
    .then(function(r){ return r.error ? [] : (r.data||[]); });
}
function dbLoadAllTrades() {
  if (!sb || !currentUser) return Promise.resolve([]);
  return sb.from('trades').select('*').eq('status','available')
    .then(function(r){ return r.error ? [] : (r.data||[]); });
}
function dbLoadOffersToMe() {
  if (!sb || !currentUser) return Promise.resolve([]);
  return sb.from('trade_offers').select('*').eq('to_user_id', currentUser.id).eq('status','pending')
    .then(function(r){ return r.error ? [] : (r.data||[]); });
}

function saveTrades() {
  trades.forEach(function(t){ dbSaveTrade(t); });
  try { if (currentUser) localStorage.setItem('trades_'+currentUser.id, JSON.stringify(trades)); } catch(e){}
}
function loadTrades() {
  try { trades = currentUser ? JSON.parse(localStorage.getItem('trades_'+currentUser.id)||'[]') : []; } catch(e){ trades=[]; }
}

function renderTrade() {
  var el = document.getElementById('trade-content');
  el.innerHTML = '<div class="loading"><span class="spinner"></span>Loading...</div>';
  if (tradeTab==='mine') renderMyTrades(el);
  else if (tradeTab==='all') renderAllTrades(el);
  else renderTradeOffers(el);
}

function renderMyTrades(el) {
  dbLoadMyTrades().then(function(rows) {
    var list = rows.length ? rows : trades;
    if (!list.length) { el.innerHTML='<div class="empty"><div class="em">🔄</div><p>No cards listed</p><small>Click "+ List a Card" to get started</small></div>'; return; }
    var grid = document.createElement('div'); grid.className='trade-grid';
    list.forEach(function(t) {
      var card = t.card_data || col.find(function(c){return c.id===(t.cardId||t.card_id);}) || t.cardSnap;
      if (!card) return;
      var p = getPrice(card); var isTraded = t.status==='traded';
      var div = document.createElement('div'); div.className='trade-card'; div.style.opacity=isTraded?'.5':'1';
      div.innerHTML = '<img src="'+(card.images&&card.images.small||'')+'" alt="'+card.name+'">' +
        '<span class="trade-status '+(isTraded?'ts-traded':'ts-available')+'">'+(isTraded?'✓ Traded':'Available')+'</span>' +
        '<div class="tc-info">' +
          '<div style="font-weight:600;font-size:13px">'+card.name+'</div>' +
          '<div style="font-size:11px;color:var(--muted)">'+((card.set&&card.set.name)||'')+'</div>' +
          '<div style="font-size:12px;color:var(--accent);margin-top:2px">'+(p?'£'+p.toFixed(2):'—')+'</div>' +
          '<div style="display:flex;gap:6px;margin-top:8px" id="tc-btns-'+t.id+'"></div>' +
        '</div>';
      var btnsEl = div.querySelector('#tc-btns-'+t.id);
      if (isTraded) {
        var rb = document.createElement('button'); rb.className='btn danger'; rb.style.cssText='flex:1;font-size:11px;padding:5px'; rb.textContent='Remove';
        rb.addEventListener('click', function(){ removeTrade(t.id); }); btnsEl.appendChild(rb);
      } else {
        var mb = document.createElement('button'); mb.className='btn primary'; mb.style.cssText='flex:1;font-size:11px;padding:5px'; mb.textContent='Mark Traded';
        mb.addEventListener('click', function(){ markTraded(t.id); }); btnsEl.appendChild(mb);
        var xb = document.createElement('button'); xb.className='btn danger'; xb.style.cssText='font-size:11px;padding:5px'; xb.textContent='✕';
        xb.addEventListener('click', function(){ removeTrade(t.id); }); btnsEl.appendChild(xb);
      }
      grid.appendChild(div);
    });
    el.innerHTML=''; el.appendChild(grid);
  });
}

function renderAllTrades(el) {
  dbLoadAllTrades().then(function(rows) {
    var others = rows.filter(function(r){ return r.user_id!==currentUser.id; });
    if (!others.length) { el.innerHTML='<div class="empty"><div class="em">🔄</div><p>No friends have listed cards for trade yet</p></div>'; return; }
    var grid = document.createElement('div'); grid.className='trade-grid';
    others.forEach(function(t) {
      var card = t.card_data; if (!card) return;
      var p = getPrice(card); var iOwnIt = col.some(function(c){return c.id===(card.id||t.card_id);});
      var div = document.createElement('div'); div.className='trade-card';
      div.innerHTML = '<img src="'+(card.images&&card.images.small||'')+'" alt="'+card.name+'">' +
        '<span class="trade-status ts-available">Available</span>' +
        (iOwnIt?'<span class="offer-badge">You have this!</span>':'')+
        '<div class="tc-info">' +
          '<div class="tc-owner">👤 '+(t.username||'Trainer')+'</div>' +
          '<div style="font-weight:600;font-size:13px">'+card.name+'</div>' +
          '<div style="font-size:11px;color:var(--muted)">'+((card.set&&card.set.name)||'')+'</div>' +
          '<div style="font-size:12px;color:var(--accent);margin-top:2px">'+(p?'£'+p.toFixed(2):'—')+'</div>' +
          '<div id="offer-btn-'+t.id+'" style="margin-top:8px"></div>' +
        '</div>';
      var ob = document.createElement('button'); ob.className='btn primary'; ob.style.cssText='width:100%;font-size:11px;padding:5px'; ob.textContent='🤝 Offer Trade';
      ob.addEventListener('click', function(){ openOfferModal(t.id, t.user_id, t.username||'Trainer', card.name); });
      div.querySelector('#offer-btn-'+t.id).appendChild(ob);
      grid.appendChild(div);
    });
    el.innerHTML=''; el.appendChild(grid);
  });
}

function renderTradeOffers(el) {
  dbLoadOffersToMe().then(function(offers) {
    var badge = document.getElementById('trade-offers-badge');
    if (badge) { badge.style.display=offers.length?'inline':'none'; badge.textContent=offers.length; }
    if (!offers.length) { el.innerHTML='<div class="empty"><div class="em">🤝</div><p>No pending trade offers</p></div>'; return; }
    el.innerHTML='';
    offers.forEach(function(offer) {
      var div = document.createElement('div'); div.className='trade-offer-card';
      div.innerHTML = '<div class="to-info">' +
        '<div style="font-weight:600;font-size:13px">🤝 Trade Offer</div>' +
        '<div class="to-from">From: '+(offer.from_username||offer.from_email||'Someone')+'</div>' +
        '<div class="to-from">For your: <strong>'+(offer.for_card_name||'card')+'</strong></div>' +
        (offer.message?'<div class="to-msg">"'+offer.message+'"</div>':'')+
        '<div id="offer-resp-'+offer.id+'" style="display:flex;gap:6px;margin-top:8px"></div>' +
      '</div>';
      var ab=document.createElement('button'); ab.className='btn primary'; ab.style.cssText='flex:1;font-size:11px;padding:5px'; ab.textContent='✓ Accept';
      ab.addEventListener('click', function(){ respondOffer(offer.id,'accepted'); });
      var db=document.createElement('button'); db.className='btn danger'; db.style.cssText='flex:1;font-size:11px;padding:5px'; db.textContent='✕ Decline';
      db.addEventListener('click', function(){ respondOffer(offer.id,'declined'); });
      div.querySelector('#offer-resp-'+offer.id).appendChild(ab);
      div.querySelector('#offer-resp-'+offer.id).appendChild(db);
      el.appendChild(div);
    });
  });
}

var _offerTradeId=null,_offerToUserId=null,_offerToUsername=null,_offerCardName=null;
function openOfferModal(tradeId, toUserId, toUsername, cardName) {
  _offerTradeId=tradeId; _offerToUserId=toUserId; _offerToUsername=toUsername; _offerCardName=cardName;
  document.getElementById('offer-modal-for').textContent = cardName+' from '+toUsername;
  document.getElementById('offer-message').value='';
  document.getElementById('offer-modal').classList.add('open');
}
function closeOfferModal() { document.getElementById('offer-modal').classList.remove('open'); }
function sendTradeOffer() {
  var msg=document.getElementById('offer-message').value.trim();
  if (!sb||!currentUser||!_offerTradeId) return;
  var uname=profileData.username||currentUser.email.split('@')[0];
  sb.from('trade_offers').insert({ trade_id:_offerTradeId, from_user_id:currentUser.id, from_email:currentUser.email, from_username:uname, to_user_id:_offerToUserId, for_card_name:_offerCardName, message:msg||null, status:'pending' })
    .then(function(res){ if(res.error){showToast('Error: '+res.error.message,'tr');return;} closeOfferModal(); showToast('Trade offer sent to '+_offerToUsername+' 🤝'); });
}
function respondOffer(offerId, status) {
  if (!sb) return;
  sb.from('trade_offers').update({status:status}).eq('id',offerId)
    .then(function(res){ if(res.error){showToast('Error','tr');return;} showToast(status==='accepted'?'Offer accepted! 🎉':'Offer declined'); renderTrade(); });
}

function openTradeModal() {
  var listed=trades.map(function(t){return t.cardId||t.card_id;});
  var avail=col.filter(function(c){return !listed.includes(c.id);});
  var listEl=document.getElementById('trade-pick-list');
  listEl.innerHTML='';
  if (!avail.length) { listEl.innerHTML='<p style="color:var(--muted);font-size:13px;padding:8px">No cards available to list.</p>'; }
  avail.forEach(function(card) {
    var div=document.createElement('div'); div.className='pick-item';
    div.innerHTML='<img src="'+(card.images&&card.images.small||'')+'" style="width:32px;border-radius:4px">' +
      '<div><div style="font-weight:600;font-size:13px">'+card.name+'</div><div style="font-size:11px;color:var(--muted)">'+((card.set&&card.set.name)||'')+'</div></div>' +
      '<span style="margin-left:auto;font-size:12px;color:var(--accent)">'+(getPrice(card)?'£'+getPrice(card).toFixed(2):'—')+'</span>';
    div.addEventListener('click', function(){ addTradeCard(card.id); });
    listEl.appendChild(div);
  });
  document.getElementById('trade-modal').classList.add('open');
}
function closeTradeModal() { document.getElementById('trade-modal').classList.remove('open'); }
function addTradeCard(cardId) {
  var card=col.find(function(c){return c.id===cardId;}); if(!card) return;
  var t={id:Date.now().toString(), cardId:cardId, cardSnap:card, status:'available'};
  trades.push(t); dbSaveTrade(t);
  try { if(currentUser) localStorage.setItem('trades_'+currentUser.id,JSON.stringify(trades)); } catch(e){}
  closeTradeModal(); renderTrade(); showToast('Listed for trade 🔄');
}
function markTraded(tradeId) {
  var t=trades.find(function(x){return x.id===tradeId;}); if(!t) return;
  t.status='traded';
  col=col.filter(function(c){return c.id!==t.cardId;});
  binder=binder.map(function(pg){return pg.map(function(s){return s===t.cardId?null:s;});});
  saveBinder(); dbSaveTrade(t); dbRemoveCol(t.cardId);
  try { if(currentUser) localStorage.setItem('trades_'+currentUser.id,JSON.stringify(trades)); } catch(e){}
  updateStats(); renderTrade(); showToast('Marked as traded — removed from collection ✓');
}
function removeTrade(tradeId) {
  dbDeleteTrade(tradeId);
  trades=trades.filter(function(x){return x.id!==tradeId;});
  try { if(currentUser) localStorage.setItem('trades_'+currentUser.id,JSON.stringify(trades)); } catch(e){}
  renderTrade(); showToast('Removed from Trade Zone');
}

// ── EVENTS CALENDAR ──────────────────────────────────────────────────────
var calYear   = new Date().getFullYear();
var calMonth  = new Date().getMonth();
var calSelDay = null;
var calEvents = [];
var calRsvps  = [];
var editingEventId = null;
var pickedEmoji = '';

function renderEvents() {
  loadCalEvents().then(drawCalendar);
}

function loadCalEvents() {
  if (!sb || !currentUser) { calEvents = []; calRsvps = []; return Promise.resolve(); }
  var dStart = new Date(calYear, calMonth - 1, 1).toISOString().slice(0,10);
  var dEnd   = new Date(calYear, calMonth + 2, 1).toISOString().slice(0,10);
  return sb.from('events').select('*').gte('event_date', dStart).lt('event_date', dEnd)
    .then(function(res) {
      if (res.error) { console.error('loadCalEvents:', res.error.message); calEvents = []; return; }
      calEvents = res.data || [];
      if (!calEvents.length) { calRsvps = []; return; }
      var ids = calEvents.map(function(e){ return e.id; });
      return sb.from('event_rsvps').select('*').in('event_id', ids)
        .then(function(r){ calRsvps = r.error ? [] : (r.data||[]); });
    });
}

function drawCalendar() {
  var titleEl = document.getElementById('cal-title');
  var gridEl  = document.getElementById('cal-grid');
  if (!titleEl || !gridEl) return;
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  titleEl.textContent = MONTHS[calMonth] + ' ' + calYear;
  gridEl.innerHTML = '';
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(function(d) {
    var h = document.createElement('div');
    h.className = 'cal-day-header'; h.textContent = d; gridEl.appendChild(h);
  });
  var firstDay = new Date(calYear, calMonth, 1).getDay();
  var blanks   = (firstDay === 0) ? 6 : firstDay - 1;
  var daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  var today = new Date().toISOString().slice(0,10);
  for (var b = 0; b < blanks; b++) {
    var bl = document.createElement('div'); bl.className = 'cal-day cal-empty'; gridEl.appendChild(bl);
  }
  for (var day = 1; day <= daysInMonth; day++) {
    var mm = String(calMonth+1).padStart(2,'0');
    var dd = String(day).padStart(2,'0');
    var ds = calYear+'-'+mm+'-'+dd;
    var evs = calEvents.filter(function(e){ return e.event_date===ds; });
    var cell = document.createElement('div');
    cell.className = 'cal-day'+(ds===today?' today':'')+(ds===calSelDay?' selected':'');
    var numEl = document.createElement('div');
    numEl.className = 'day-num'; numEl.textContent = day; cell.appendChild(numEl);
    var emojiEv = evs.find(function(e){ return e.emoji; });
    if (emojiEv) {
      var ee = document.createElement('div'); ee.className = 'day-emoji'; ee.textContent = emojiEv.emoji; cell.appendChild(ee);
    }
    if (evs.length) {
      var ew = document.createElement('div'); ew.className = 'day-events';
      evs.slice(0,2).forEach(function(ev){
        var lbl = document.createElement('div'); lbl.className = 'day-event-label'; lbl.textContent = ev.title; ew.appendChild(lbl);
      });
      if (evs.length > 2) {
        var more = document.createElement('div'); more.className = 'day-event-label'; more.style.color = 'var(--muted)';
        more.textContent = '+'+(evs.length-2)+' more'; ew.appendChild(more);
      }
      cell.appendChild(ew);
    }
    (function(dateStr){ cell.addEventListener('click', function(){ selectCalDay(dateStr); }); })(ds);
    gridEl.appendChild(cell);
  }
  if (calSelDay) showDayPanel(calSelDay);
}

function selectCalDay(ds) { calSelDay = ds; drawCalendar(); showDayPanel(ds); }

function showDayPanel(ds) {
  var panel = document.getElementById('cal-day-panel');
  if (!panel) return;
  var evs = calEvents.filter(function(e){ return e.event_date === ds; });
  var d   = new Date(ds+'T12:00:00');
  var lbl = d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  panel.innerHTML = '';
  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;';
  hdr.innerHTML = '<span style="font-weight:600;font-size:14px;">'+lbl+'</span>';
  var addBtn = document.createElement('button');
  addBtn.className = 'btn primary'; addBtn.style.cssText = 'font-size:12px;padding:5px 12px;';
  addBtn.textContent = '+ Add Event';
  addBtn.addEventListener('click', function(){ openEventModal(ds); });
  hdr.appendChild(addBtn); panel.appendChild(hdr);
  if (!evs.length) {
    var empty = document.createElement('p');
    empty.style.cssText = 'font-size:13px;color:var(--muted);';
    empty.textContent = 'No events — click + Add Event to create one.';
    panel.appendChild(empty); return;
  }
  evs.forEach(function(ev) {
    var card = document.createElement('div');
    card.className = 'event-card' + (ev.created_by === currentUser.id ? ' editable' : '');
    var titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:4px;';
    if (ev.emoji) {
      var emoSpan = document.createElement('span');
      emoSpan.style.fontSize = '22px'; emoSpan.textContent = ev.emoji; titleRow.appendChild(emoSpan);
    }
    var titleEl = document.createElement('div');
    titleEl.className = 'ev-title'; titleEl.textContent = ev.title; titleRow.appendChild(titleEl);
    if (ev.created_by === currentUser.id) {
      var editBtn = document.createElement('button');
      editBtn.className = 'btn'; editBtn.style.cssText = 'font-size:10px;padding:2px 8px;margin-left:auto;';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', function(e){ e.stopPropagation(); openEventModal(ds, ev); });
      titleRow.appendChild(editBtn);
    }
    card.appendChild(titleRow);
    var meta = document.createElement('div'); meta.className = 'ev-meta';
    var who = ev.created_by_username || ev.created_by_email || 'Someone';
    var creatorBadge = document.createElement('span');
    creatorBadge.className = 'ev-creator'; creatorBadge.innerHTML = '👤 ' + who;
    meta.appendChild(creatorBadge); card.appendChild(meta);
    if (ev.notes) {
      var notesEl = document.createElement('div');
      notesEl.className = 'ev-notes'; notesEl.textContent = ev.notes; card.appendChild(notesEl);
    }
    var rsvpRow = document.createElement('div'); rsvpRow.className = 'ev-rsvp-row';
    var evRsvps   = calRsvps.filter(function(r){ return r.event_id === ev.id; });
    var myRsvp    = evRsvps.find(function(r){ return r.user_id === currentUser.id; });
    var goingList = evRsvps.filter(function(r){ return r.status === 'going'; });
    var goingBtn = document.createElement('button');
    goingBtn.className = 'ev-rsvp-btn' + (myRsvp && myRsvp.status === 'going' ? ' going' : '');
    goingBtn.textContent = myRsvp && myRsvp.status === 'going' ? '✓ Going' : 'Going?';
    goingBtn.addEventListener('click', function(){ toggleRsvp(ev.id, 'going', ds); });
    rsvpRow.appendChild(goingBtn);
    var notGoingBtn = document.createElement('button');
    notGoingBtn.className = 'ev-rsvp-btn' + (myRsvp && myRsvp.status === 'not_going' ? ' not-going' : '');
    notGoingBtn.textContent = myRsvp && myRsvp.status === 'not_going' ? '✗ Not going' : "Can't go";
    notGoingBtn.addEventListener('click', function(){ toggleRsvp(ev.id, 'not_going', ds); });
    rsvpRow.appendChild(notGoingBtn);
    if (goingList.length) {
      var avWrap = document.createElement('div'); avWrap.className = 'ev-attendees';
      goingList.slice(0,5).forEach(function(r) {
        var av = document.createElement('div');
        var col2 = FRIEND_COLORS[Math.abs(hashStr(r.user_id||''))%FRIEND_COLORS.length];
        av.className = 'ev-attendee-av';
        av.style.cssText = 'background:'+col2+'33;color:'+col2+';';
        av.title = r.username || r.email || '';
        av.textContent = (r.username||r.email||'?')[0].toUpperCase();
        avWrap.appendChild(av);
      });
      var countEl = document.createElement('span');
      countEl.className = 'ev-attendee-count'; countEl.textContent = goingList.length+' going';
      avWrap.appendChild(countEl); rsvpRow.appendChild(avWrap);
    }
    card.appendChild(rsvpRow);
    panel.appendChild(card);
  });
}

function toggleRsvp(eventId, status, ds) {
  if (!sb || !currentUser) return;
  var uname  = profileData.username || currentUser.email.split('@')[0];
  var myRsvp = calRsvps.find(function(r){ return r.event_id === eventId && r.user_id === currentUser.id; });
  if (myRsvp && myRsvp.status === status) {
    sb.from('event_rsvps').delete().eq('id', myRsvp.id)
      .then(function(res){ if(res.error){showToast('Error','tr');return;} loadCalEvents().then(function(){drawCalendar();showDayPanel(ds);}); });
    return;
  }
  if (myRsvp) {
    sb.from('event_rsvps').update({status:status}).eq('id', myRsvp.id)
      .then(function(res){ if(res.error){showToast('Error','tr');return;} showToast(status==='going'?'Marked as going ✓':'Marked as not going'); loadCalEvents().then(function(){drawCalendar();showDayPanel(ds);}); });
  } else {
    sb.from('event_rsvps').insert({event_id:eventId, user_id:currentUser.id, email:currentUser.email, username:uname, status:status})
      .then(function(res){ if(res.error){showToast('Error','tr');return;} showToast(status==='going'?'Marked as going ✓':'Marked as not going'); loadCalEvents().then(function(){drawCalendar();showDayPanel(ds);}); });
  }
}

function calPrev() { calMonth--; if(calMonth<0){calMonth=11;calYear--;} loadCalEvents().then(drawCalendar); }
function calNext() { calMonth++; if(calMonth>11){calMonth=0;calYear++;} loadCalEvents().then(drawCalendar); }

function openEventModal(dateStr, ev) {
  editingEventId = ev ? ev.id : null;
  pickedEmoji    = ev ? (ev.emoji||'') : '';
  document.getElementById('event-modal-title').textContent = ev ? 'Edit Event' : 'Add Event';
  document.getElementById('event-save-btn').textContent    = ev ? 'Save Changes' : 'Add Event';
  document.getElementById('event-date').value              = dateStr || calSelDay || new Date().toISOString().slice(0,10);
  document.getElementById('event-title-input').value       = ev ? ev.title : '';
  document.getElementById('event-emoji').value             = ev ? (ev.emoji||'') : '';
  document.getElementById('event-notes').value             = ev ? (ev.notes||'') : '';
  document.getElementById('event-delete-btn').style.display = ev ? 'block' : 'none';
  document.querySelectorAll('.emoji-opt').forEach(function(b){
    b.classList.remove('active');
    if (pickedEmoji && b.textContent === pickedEmoji) b.classList.add('active');
  });
  document.getElementById('event-modal').classList.add('open');
}
function closeEventModal() {
  document.getElementById('event-modal').classList.remove('open');
  editingEventId = null; pickedEmoji = '';
}
function pickEmoji(btn, emoji) {
  pickedEmoji = emoji;
  document.querySelectorAll('.emoji-opt').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  document.getElementById('event-emoji').value = emoji;
}
function saveEvent() {
  var date  = document.getElementById('event-date').value;
  var title = document.getElementById('event-title-input').value.trim();
  var emoji = document.getElementById('event-emoji').value.trim() || pickedEmoji || null;
  var notes = document.getElementById('event-notes').value.trim() || null;
  if (!date)  { showToast('Please pick a date','tr'); return; }
  if (!title) { showToast('Please enter an event name','tr'); return; }
  if (!sb || !currentUser) { showToast('Not connected','tr'); return; }
  var uname   = profileData.username || currentUser.email.split('@')[0];
  var payload = { event_date:date, title:title, emoji:emoji, notes:notes,
    created_by:currentUser.id, created_by_email:currentUser.email, created_by_username:uname };
  var op = editingEventId
    ? sb.from('events').update(payload).eq('id', editingEventId)
    : sb.from('events').insert(payload);
  op.then(function(res){
    if (res.error) { showToast('Error: '+res.error.message,'tr'); return; }
    closeEventModal();
    showToast(editingEventId ? 'Event updated ✓' : 'Event added 📅');
    loadCalEvents().then(function(){ drawCalendar(); if(calSelDay) showDayPanel(calSelDay); });
  });
}
function deleteEvent() {
  if (!editingEventId || !sb) return;
  sb.from('events').delete().eq('id', editingEventId).then(function(res){
    if (res.error) { showToast('Error: '+res.error.message,'tr'); return; }
    closeEventModal(); showToast('Event deleted');
    loadCalEvents().then(function(){ drawCalendar(); if(calSelDay) showDayPanel(calSelDay); });
  });
}


function setPdexFilter(f, el) {
  pdexFilter = f;
  document.querySelectorAll('#page-pokedex .chip').forEach(function(c){c.classList.remove('active');});
  el.classList.add('active');
  renderPokedex();
}

function toggleCaught(num) {
  if (caughtSet.has(num)) caughtSet.delete(num); else caughtSet.add(num);
  savePokedex(); renderPokedex();
}

function renderPokedex() {
  var q = (document.getElementById('pdex-search') ? document.getElementById('pdex-search').value : '').toLowerCase();
  var list = PKMN.filter(function(m) {
    var num=m[0], name=m[1];
    if (q && !name.toLowerCase().includes(q) && !String(num).includes(q)) return false;
    if (pdexFilter==='caught' && !caughtSet.has(num)) return false;
    if (pdexFilter==='missing' && caughtSet.has(num)) return false;
    return true;
  });
  document.getElementById('pdex-progress').textContent = caughtSet.size + ' / ' + PKMN.length + ' caught';
  document.getElementById('pdex-grid').innerHTML = list.map(function(m) {
    var num=m[0], name=m[1];
    var caught = caughtSet.has(num);
    return '<div class="pdex-mon '+(caught?'caught':'')+'" onclick="toggleCaught('+num+')" title="'+(caught?'Caught! Click to uncatch':'Click to mark as caught')+'">'+
      '<img class="sprite" src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/'+num+'.png" alt="'+name+'" loading="lazy">'+
      '<div class="pdex-num">#'+String(num).padStart(4,'0')+'</div>'+
      '<div class="pdex-name">'+name+'</div></div>';
  }).join('');
}