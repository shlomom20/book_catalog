// ============================================================
// קטלוג הספרייה - app.js
// ============================================================

// ---- STATE ----
const state = {
  view: 'grid',        // 'grid' | 'list'
  search: '',
  sort: 'name-asc',   // 'name-asc' | 'name-desc' | 'author-asc' | 'author-desc' | 'location'
  filter: { cabinetId: null, shelfId: null, rowId: null, layerId: null, owner: null },
  mobileTab: 'catalog', // 'catalog' | 'manage'
  editingBookId: null,
  deletingBookId: null,
};

const SORT_LABELS = {
  'name-asc':   'שם ספר (א→ת)',
  'name-desc':  'שם ספר (ת→א)',
  'author-asc': 'שם סופר (א→ת)',
  'author-desc':'שם סופר (ת→א)',
  'location':   'מיקום',
};

// ============================================================
// API LAYER
// ============================================================

let db = { books: [], locations: { cabinets: [], shelves: [], rows: [], layers: [] } };

async function apiFetch(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

async function loadData() {
  const data = await apiFetch('GET', '/api/data');
  db.books     = data.books;
  db.locations = data.locations;
  if (!db.locations.layers) db.locations.layers = [];
}

function showLoadingOverlay(show) {
  document.getElementById('loadingOverlay').classList.toggle('visible', show);
}

// ---- Helpers ----
function getCabinet(id)  { return db.locations.cabinets.find(c => c.id === id); }
function getShelf(id)    { return db.locations.shelves.find(s => s.id === id); }
function getRow(id)      { return db.locations.rows.find(r => r.id === id); }
function getLayer(id)    { return db.locations.layers.find(l => l.id === id); }

function getLocationLabel(book) {
  const parts = [];
  if (book.cabinetId) { const c = getCabinet(book.cabinetId); if (c) parts.push(c.name); }
  if (book.shelfId)   { const s = getShelf(book.shelfId);     if (s) parts.push(s.name); }
  if (book.rowId)     { const r = getRow(book.rowId);          if (r) parts.push(r.name); }
  if (book.layerId)   { const l = getLayer(book.layerId);      if (l) parts.push(l.name); }
  return parts;
}

// ---- Sort ----
function sortBooks(books) {
  const collator = new Intl.Collator('he', { sensitivity: 'base' });
  return [...books].sort((a, b) => {
    switch (state.sort) {
      case 'name-asc':   return collator.compare(a.name,   b.name);
      case 'name-desc':  return collator.compare(b.name,   a.name);
      case 'author-asc': return collator.compare(a.author, b.author);
      case 'author-desc':return collator.compare(b.author, a.author);
      case 'location': {
        const ca = getCabinet(a.cabinetId), cb = getCabinet(b.cabinetId);
        const sa = getShelf(a.shelfId),     sb = getShelf(b.shelfId);
        const ra = getRow(a.rowId),         rb = getRow(b.rowId);
        const la = getLayer(a.layerId),     lb = getLayer(b.layerId);
        return collator.compare(ca?.name ?? '', cb?.name ?? '') ||
               collator.compare(sa?.name ?? '', sb?.name ?? '') ||
               collator.compare(ra?.name ?? '', rb?.name ?? '') ||
               collator.compare(la?.name ?? '', lb?.name ?? '') ||
               collator.compare(a.name,         b.name);
      }
      default: return 0;
    }
  });
}

// ---- Filter & Search ----
function getFilteredBooks() {
  return db.books.filter(book => {
    if (state.filter.owner) {
      const cab = book.cabinetId ? getCabinet(book.cabinetId) : null;
      const bookOwner = (cab && cab.owner) ? cab.owner.trim().toLowerCase() : '';
      if (bookOwner !== state.filter.owner.trim().toLowerCase()) return false;
    }
    if (state.filter.layerId   && book.layerId   !== state.filter.layerId)   return false;
    if (state.filter.rowId     && book.rowId     !== state.filter.rowId)     return false;
    if (state.filter.shelfId   && book.shelfId   !== state.filter.shelfId)   return false;
    if (state.filter.cabinetId && book.cabinetId !== state.filter.cabinetId) return false;
    if (state.search) {
      const q = state.search.toLowerCase();
      const locationParts = getLocationLabel(book).join(' ').toLowerCase();
      if (!book.name.toLowerCase().includes(q) &&
          !book.author.toLowerCase().includes(q) &&
          !locationParts.includes(q)) return false;
    }
    return true;
  });
}

// ---- Count books per location ----
function countBooksFor(type, id) {
  return db.books.filter(b => b[type + 'Id'] === id).length;
}

// ============================================================
// RENDERING
// ============================================================

function render() {
  renderStats();
  renderLocationTree();
  renderBooks();
}

// ---- Stats ----
function renderStats() {
  const filtered = getFilteredBooks();
  document.getElementById('statTotalBooks').textContent    = db.books.length;
  document.getElementById('statTotalCabinets').textContent = db.locations.cabinets.length;
  document.getElementById('statFilteredBooks').textContent = filtered.length;
  document.getElementById('mobileCount').textContent       = `${filtered.length} ספרים`;

  // Filter badge
  const hasFilter = state.filter.cabinetId || state.filter.shelfId || state.filter.rowId ||
                    state.filter.layerId || state.filter.owner || state.search;
  const badge = document.getElementById('filterBadge');
  if (hasFilter) { badge.textContent = ''; badge.classList.add('visible'); }
  else           { badge.classList.remove('visible'); }
}

// ---- Mobile Tab Switching ----
function switchMobileTab(tab) {
  state.mobileTab = tab;
  const isCatalog = tab === 'catalog';

  document.getElementById('catalogView').style.display    = isCatalog ? '' : 'none';
  document.getElementById('managementView').style.display = isCatalog ? 'none' : 'block';
  document.getElementById('statsBar').style.display       = isCatalog ? '' : 'none';

  document.querySelectorAll('.bottom-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  document.body.classList.toggle('tab-manage', !isCatalog);

  // Scroll to top when switching
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---- Sidebar (mobile) ----
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarBackdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('open');
  document.body.style.overflow = '';
}

// ---- Location Tree (Sidebar) ----
function renderLocationTree() {
  const tree = document.getElementById('locationTree');
  const f = state.filter;

  // Owner filter section — only if there are cabinets with owners
  const owners = [...new Set(
    db.locations.cabinets
      .filter(c => c.owner && c.owner.trim())
      .map(c => c.owner.trim())
  )].sort();

  let html = '';
  if (owners.length > 0) {
    const ownerOptions = owners.map(o => {
      const count = db.books.filter(b => {
        const cab = b.cabinetId ? getCabinet(b.cabinetId) : null;
        return cab && cab.owner && cab.owner.trim() === o;
      }).length;
      const active = f.owner === o;
      return `<div class="owner-filter-option ${active ? 'active' : ''}" data-action="filter-owner" data-owner="${esc(o)}">
        👤 ${esc(o)} <span class="tree-count">${count}</span>
      </div>`;
    }).join('');
    html += `<div class="tree-section-title">סינון לפי בעלים</div>
    ${ownerOptions}`;
  }

  html += `<div class="tree-section-title">סינון לפי מיקום</div>
  <div class="tree-all ${!f.cabinetId && !f.shelfId && !f.rowId && !f.layerId && !f.owner ? 'active' : ''}" data-action="filter-all">
    📚 כל הספרים
    <span class="tree-count">${db.books.length}</span>
  </div>`;

  for (const cab of db.locations.cabinets) {
    const cabShelves = db.locations.shelves.filter(s => s.cabinetId === cab.id);
    const cabBooks   = db.books.filter(b => b.cabinetId === cab.id).length;
    const cabActive  = f.cabinetId === cab.id && !f.shelfId;
    const cabOpen    = f.cabinetId === cab.id;

    html += `<div class="tree-cabinet">
      <div class="tree-cabinet-header ${cabActive ? 'active' : ''}" data-action="filter-cabinet" data-id="${cab.id}">
        🗄️ ${cab.name}
        <span class="tree-count">${cabBooks}</span>
        <span class="tree-toggle ${cabOpen ? 'open' : ''}">▶</span>
      </div>
      <div class="tree-shelves ${cabOpen ? 'open' : ''}">`;

    for (const shelf of cabShelves) {
      const shelfRows  = db.locations.rows.filter(r => r.shelfId === shelf.id);
      const shelfBooks = db.books.filter(b => b.shelfId === shelf.id).length;
      const shelfActive = f.shelfId === shelf.id && !f.rowId;
      const shelfOpen   = f.shelfId === shelf.id;

      html += `<div class="tree-shelf">
        <div class="tree-shelf-header ${shelfActive ? 'active' : ''}" data-action="filter-shelf" data-id="${shelf.id}" data-cabinet="${cab.id}">
          📋 ${shelf.name}
          <span class="tree-count">${shelfBooks}</span>
          <span class="tree-toggle ${shelfOpen ? 'open' : ''}">▶</span>
        </div>
        <div class="tree-rows ${shelfOpen ? 'open' : ''}">`;

      for (const row of shelfRows) {
        const rowLayers = db.locations.layers.filter(l => l.rowId === row.id);
        const rowBooks  = db.books.filter(b => b.rowId === row.id).length;
        const rowActive = f.rowId === row.id && !f.layerId;
        const rowOpen   = f.rowId === row.id;

        if (rowLayers.length > 0) {
          html += `<div class="tree-row">
            <div class="tree-row-header ${rowActive ? 'active' : ''}" data-action="filter-row" data-id="${row.id}" data-shelf="${shelf.id}" data-cabinet="${cab.id}">
              · ${row.name} <span class="tree-count">${rowBooks}</span>
              <span class="tree-toggle ${rowOpen ? 'open' : ''}">▶</span>
            </div>
            <div class="tree-layers ${rowOpen ? 'open' : ''}">`;

          for (const layer of rowLayers) {
            const layerBooks  = db.books.filter(b => b.layerId === layer.id).length;
            const layerActive = f.layerId === layer.id;
            html += `<div class="tree-layer-item ${layerActive ? 'active' : ''}" data-action="filter-layer" data-id="${layer.id}" data-row="${row.id}" data-shelf="${shelf.id}" data-cabinet="${cab.id}">
              ‣ ${layer.name} <span class="tree-count">${layerBooks}</span>
            </div>`;
          }

          html += `</div></div>`;
        } else {
          html += `<div class="tree-row-item ${rowActive ? 'active' : ''}" data-action="filter-row" data-id="${row.id}" data-shelf="${shelf.id}" data-cabinet="${cab.id}">
            · ${row.name} <span class="tree-count">${rowBooks}</span>
          </div>`;
        }
      }

      html += `</div></div>`;
    }

    html += `</div></div>`;
  }

  tree.innerHTML = html;
}

// ---- Duplicate Detection ----
function getOwnerGroup(book) {
  if (!book.cabinetId) return null;
  const cab = getCabinet(book.cabinetId);
  if (!cab || !cab.owner) return null;
  return cab.owner.trim().toLowerCase();
}

function getDuplicateGroups() {
  const groups = {};
  for (const book of db.books) {
    const ownerGroup = getOwnerGroup(book);
    if (!ownerGroup) continue; // only check books in cabinets with an owner
    const key = `${ownerGroup}|${book.name.toLowerCase().trim()}|${book.author.toLowerCase().trim()}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(book);
  }
  return Object.values(groups).filter(g => g.length > 1);
}

function renderDuplicateCard(books) {
  const copies = books.map((book, i) => {
    const loc    = getLocationLabel(book);
    const badges = loc.map(l => `<span class="location-badge">${esc(l)}</span>`).join('');
    const shelf  = book.shelfId ? getShelf(book.shelfId) : null;
    const imgBtn = shelf && shelf.image
      ? `<button class="btn-shelf-img" data-action="view-shelf-img" data-shelf-id="${book.shelfId}" title="צפה בתמונת המדף">📷</button>`
      : '';
    return `<div class="duplicate-copy">
      <span class="duplicate-copy-label">עותק ${i + 1}</span>
      <div class="book-card-location">${badges || '<span class="location-badge" style="opacity:.5">ללא מיקום</span>'}${imgBtn}</div>
      <div class="book-card-actions">
        <button class="btn-card-edit" data-action="edit" data-id="${book.id}">✏️ עריכה</button>
        <button class="btn-card-delete" data-action="delete" data-id="${book.id}">🗑️ מחק</button>
      </div>
    </div>`;
  }).join('');
  return `<div class="book-card duplicate-card">
    <div class="duplicate-badge">⚠️ ספר כפול (${books.length} עותקים)</div>
    <div class="book-card-top">
      <span class="book-card-title">${esc(books[0].name)}</span>
      <span class="book-card-author">${esc(books[0].author)}</span>
    </div>
    ${copies}
  </div>`;
}

function renderDuplicateRow(books) {
  const copies = books.map((book, i) => {
    const loc    = getLocationLabel(book);
    const badges = loc.map(l => `<span class="location-badge">${esc(l)}</span>`).join('');
    const shelf  = book.shelfId ? getShelf(book.shelfId) : null;
    const imgBtn = shelf && shelf.image
      ? `<button class="btn-shelf-img" data-action="view-shelf-img" data-shelf-id="${book.shelfId}" title="צפה בתמונת המדף">📷</button>`
      : '';
    return `<div class="duplicate-copy">
      <span class="duplicate-copy-label">עותק ${i + 1}</span>
      <div class="book-row-location">${badges || '<span class="location-badge" style="opacity:.5">ללא מיקום</span>'}${imgBtn}</div>
      <div class="book-row-actions">
        <button class="btn-card-edit" data-action="edit" data-id="${book.id}">✏️</button>
        <button class="btn-card-delete" data-action="delete" data-id="${book.id}">🗑️</button>
      </div>
    </div>`;
  }).join('');
  return `<div class="book-row duplicate-row">
    <div class="book-row-main">
      <div class="duplicate-badge" style="margin-bottom:4px">⚠️ ספר כפול (${books.length} עותקים)</div>
      <div class="book-card-top">
        <span class="book-card-title">${esc(books[0].name)}</span>
        <span class="book-card-author">${esc(books[0].author)}</span>
      </div>
      ${copies}
    </div>
  </div>`;
}

// ---- Books ----
function renderBooks() {
  const books = sortBooks(getFilteredBooks());
  const container = document.getElementById('booksContainer');
  const empty = document.getElementById('emptyState');

  if (books.length === 0) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  container.className = state.view === 'grid' ? 'books-grid' : 'books-list';

  // Build duplicate map based on books visible after filtering
  const allDuplicateGroups = getDuplicateGroups();
  const bookIdSet = new Set(books.map(b => b.id));
  const duplicateMap = new Map(); // bookId → [visible copies in group]
  const secondaryIds = new Set(); // IDs to skip (shown via primary)
  for (const group of allDuplicateGroups) {
    const visibleCopies = group.filter(b => bookIdSet.has(b.id));
    if (visibleCopies.length < 2) continue; // only one copy visible → show normally
    const primary = visibleCopies[0];
    for (const book of visibleCopies) {
      duplicateMap.set(book.id, visibleCopies);
      if (book.id !== primary.id) secondaryIds.add(book.id);
    }
  }

  const displayBooks = books.filter(b => !secondaryIds.has(b.id));

  if (state.view === 'grid') {
    container.innerHTML = displayBooks.map(book => {
      const group = duplicateMap.get(book.id);
      return group ? renderDuplicateCard(group) : renderBookCard(book);
    }).join('');
  } else {
    container.innerHTML = displayBooks.map(book => {
      const group = duplicateMap.get(book.id);
      return group ? renderDuplicateRow(group) : renderBookRow(book);
    }).join('');
  }
}

function renderBookCard(book) {
  const loc = getLocationLabel(book);
  const badges = loc.map(l => `<span class="location-badge">${l}</span>`).join('');
  const shelf  = book.shelfId ? getShelf(book.shelfId) : null;
  const imgBtn = shelf && shelf.image
    ? `<button class="btn-shelf-img" data-action="view-shelf-img" data-shelf-id="${book.shelfId}" title="צפה בתמונת המדף">📷</button>`
    : '';
  return `<div class="book-card">
    <div class="book-card-top">
      <span class="book-card-title">${esc(book.name)}</span>
      <span class="book-card-author">${esc(book.author)}</span>
    </div>
    <div class="book-card-location">${badges || '<span class="location-badge" style="opacity:.5">ללא מיקום</span>'}${imgBtn}</div>
    <div class="book-card-actions">
      <button class="btn-card-edit" data-action="edit" data-id="${book.id}">✏️ עריכה</button>
      <button class="btn-card-delete" data-action="delete" data-id="${book.id}">🗑️ מחק</button>
    </div>
  </div>`;
}

function renderBookRow(book) {
  const loc = getLocationLabel(book);
  const badges = loc.map(l => `<span class="location-badge">${l}</span>`).join('');
  const shelf  = book.shelfId ? getShelf(book.shelfId) : null;
  const imgBtn = shelf && shelf.image
    ? `<button class="btn-shelf-img" data-action="view-shelf-img" data-shelf-id="${book.shelfId}" title="צפה בתמונת המדף">📷</button>`
    : '';
  return `<div class="book-row">
    <div class="book-row-main">
      <div class="book-card-top">
        <span class="book-card-title">${esc(book.name)}</span>
        <span class="book-card-author">${esc(book.author)}</span>
      </div>
      <div class="book-row-location">${badges || '<span class="location-badge" style="opacity:.5">ללא מיקום</span>'}${imgBtn}</div>
    </div>
    <div class="book-row-actions">
      <button class="btn-card-edit" data-action="edit" data-id="${book.id}">✏️ עריכה</button>
      <button class="btn-card-delete" data-action="delete" data-id="${book.id}">🗑️</button>
    </div>
  </div>`;
}

function formatCascadeParts(parts) {
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(', ') + ' ו-' + parts[parts.length - 1];
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// MODALS
// ============================================================

function openModal(id) {
  document.getElementById(id).classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// ---- Book Modal ----
function switchBookModalTab(tab) {
  document.querySelectorAll('.modal-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('tabManual').classList.toggle('active', tab === 'manual');
  document.getElementById('tabExcel').classList.toggle('active',  tab === 'excel');

  const saveBtn      = document.getElementById('bookModalSave');
  const saveAddBtn   = document.getElementById('bookModalSaveAndAdd');
  const importBtn    = document.getElementById('importModalConfirm');
  const isAddMode    = !state.editingBookId;
  if (tab === 'manual') {
    saveBtn.style.display    = '';
    saveAddBtn.style.display = isAddMode ? '' : 'none';
    importBtn.style.display  = 'none';
  } else {
    saveBtn.style.display    = 'none';
    saveAddBtn.style.display = 'none';
    // Import button is shown only after a file is loaded — handled in showImportResult
    importBtn.style.display  = 'none';
  }
}

function openAddBookModal() {
  state.editingBookId = null;
  document.getElementById('bookModalTitle').textContent = 'הוסף ספר חדש';
  document.getElementById('bookModalSave').textContent  = '💾 שמור ספר';
  document.getElementById('bookModalSave').style.display = '';
  document.getElementById('bookModalSaveAndAdd').style.display = '';
  document.getElementById('bookModalTabs').style.display = '';
  resetBookForm();
  resetExcelTab();
  switchBookModalTab('manual');
  openModal('bookModal');
  document.getElementById('bookName').focus();
}

function openEditBookModal(id) {
  const book = db.books.find(b => b.id === id);
  if (!book) return;
  state.editingBookId = id;
  document.getElementById('bookModalTitle').textContent  = 'עריכת ספר';
  document.getElementById('bookModalSave').textContent   = '💾 שמור שינויים';
  document.getElementById('bookModalTabs').style.display = 'none';
  resetBookForm();

  document.getElementById('bookId').value     = book.id;
  document.getElementById('bookName').value   = book.name;
  document.getElementById('bookAuthor').value = book.author;

  populateCabinetSelect(book.cabinetId);
  if (book.cabinetId) {
    populateShelfSelect(book.cabinetId, book.shelfId);
    if (book.shelfId) {
      populateRowSelect(book.shelfId, book.rowId);
      if (book.rowId) populateLayerSelect(book.rowId, book.layerId);
    }
  }

  // Force manual tab visible, import button hidden, multi-add hidden
  document.getElementById('tabManual').classList.add('active');
  document.getElementById('tabExcel').classList.remove('active');
  document.getElementById('bookModalSave').style.display      = '';
  document.getElementById('bookModalSaveAndAdd').style.display = 'none';
  document.getElementById('importModalConfirm').style.display  = 'none';

  openModal('bookModal');
  document.getElementById('bookName').focus();
}

function resetBookForm() {
  document.getElementById('bookId').value     = '';
  document.getElementById('bookName').value   = '';
  document.getElementById('bookAuthor').value = '';
  document.getElementById('bookNameError').textContent   = '';
  document.getElementById('bookAuthorError').textContent = '';

  populateCabinetSelect(null);
  populateShelfSelect(null, null);
  populateRowSelect(null, null);
  populateLayerSelect(null, null);

  hideNewRow('newCabinetRow');
  hideNewRow('newShelfRow');
  hideNewRow('newRowRow');
  hideNewRow('newLayerRow');
}

function resetExcelTab() {
  pendingImportBooks = [];
  document.getElementById('dropZone').style.display     = '';
  document.getElementById('importResult').classList.add('hidden');
  document.getElementById('importModalConfirm').style.display = 'none';
  document.getElementById('excelFileInput').value = '';
}

// ---- Cascading Dropdowns ----
function populateCabinetSelect(selectedId) {
  const sel = document.getElementById('cabinetSelect');
  sel.innerHTML = '<option value="">-- בחר ארון --</option>';
  db.locations.cabinets.forEach(c => {
    const opt = new Option(c.name, c.id, false, c.id === selectedId);
    sel.appendChild(opt);
  });
  sel.appendChild(new Option('＋ הוסף ארון חדש...', 'NEW'));
}

function populateShelfSelect(cabinetId, selectedId) {
  const sel = document.getElementById('shelfSelect');
  sel.innerHTML = '<option value="">-- בחר מדף --</option>';
  sel.disabled  = !cabinetId;

  if (cabinetId) {
    const shelves = db.locations.shelves.filter(s => s.cabinetId === cabinetId);
    shelves.forEach(s => {
      const opt = new Option(s.name, s.id, false, s.id === selectedId);
      sel.appendChild(opt);
    });
    sel.appendChild(new Option('＋ הוסף מדף חדש...', 'NEW'));
  }
}

function populateRowSelect(shelfId, selectedId) {
  const sel = document.getElementById('rowSelect');
  sel.innerHTML = '<option value="">-- בחר טור --</option>';
  sel.disabled  = !shelfId;

  if (shelfId) {
    const rows = db.locations.rows.filter(r => r.shelfId === shelfId);
    rows.forEach(r => {
      const opt = new Option(r.name, r.id, false, r.id === selectedId);
      sel.appendChild(opt);
    });
    sel.appendChild(new Option('＋ הוסף טור חדש...', 'NEW'));
  }
}

function populateLayerSelect(rowId, selectedId) {
  const sel = document.getElementById('layerSelect');
  sel.innerHTML = '<option value="">-- בחר שכבה --</option>';
  sel.disabled  = !rowId;

  if (rowId) {
    const layers = db.locations.layers.filter(l => l.rowId === rowId);
    layers.forEach(l => {
      const opt = new Option(l.name, l.id, false, l.id === selectedId);
      sel.appendChild(opt);
    });
    sel.appendChild(new Option('＋ הוסף שכבה חדשה...', 'NEW'));
  }
}

function showNewRow(rowId) {
  const row = document.getElementById(rowId);
  row.classList.add('visible');
  row.querySelector('input').value = '';
  row.querySelector('input').focus();
}

function hideNewRow(rowId) {
  document.getElementById(rowId).classList.remove('visible');
}

// ---- Save Book ----
async function saveBook() {
  const name   = document.getElementById('bookName').value.trim();
  const author = document.getElementById('bookAuthor').value.trim();
  let valid = true;

  document.getElementById('bookNameError').textContent   = '';
  document.getElementById('bookAuthorError').textContent = '';

  if (!name)   { document.getElementById('bookNameError').textContent   = 'שדה חובה'; valid = false; }
  if (!author) { document.getElementById('bookAuthorError').textContent = 'שדה חובה'; valid = false; }
  if (!valid)  return;

  const cabinetVal = document.getElementById('cabinetSelect').value;
  const shelfVal   = document.getElementById('shelfSelect').value;
  const rowVal     = document.getElementById('rowSelect').value;
  const layerVal   = document.getElementById('layerSelect').value;

  const bookData = {
    name,
    author,
    cabinetId: cabinetVal && cabinetVal !== 'NEW' ? parseInt(cabinetVal) : null,
    shelfId:   shelfVal   && shelfVal   !== 'NEW' ? parseInt(shelfVal)   : null,
    rowId:     rowVal     && rowVal     !== 'NEW' ? parseInt(rowVal)     : null,
    layerId:   layerVal   && layerVal   !== 'NEW' ? parseInt(layerVal)   : null,
  };

  showLoadingOverlay(true);
  try {
    if (state.editingBookId) {
      await apiFetch('PUT', `/api/books/${state.editingBookId}`, bookData);
      const book = db.books.find(b => b.id === state.editingBookId);
      Object.assign(book, bookData);
      showToast('הספר עודכן בהצלחה ✓', 'success');
    } else {
      const result = await apiFetch('POST', '/api/books', bookData);
      db.books.push(result);
      showToast('הספר נוסף בהצלחה ✓', 'success');
    }
    closeModal('bookModal');
    render();
  } catch (e) {
    showToast('שגיאה: ' + e.message, 'error');
  } finally {
    showLoadingOverlay(false);
  }
}

// ---- Save Book (and continue adding) ----
async function saveBookAndContinue() {
  const name   = document.getElementById('bookName').value.trim();
  const author = document.getElementById('bookAuthor').value.trim();
  let valid = true;

  document.getElementById('bookNameError').textContent   = '';
  document.getElementById('bookAuthorError').textContent = '';

  if (!name)   { document.getElementById('bookNameError').textContent   = 'שדה חובה'; valid = false; }
  if (!author) { document.getElementById('bookAuthorError').textContent = 'שדה חובה'; valid = false; }
  if (!valid)  return;

  const cabinetVal = document.getElementById('cabinetSelect').value;
  const shelfVal   = document.getElementById('shelfSelect').value;
  const rowVal     = document.getElementById('rowSelect').value;
  const layerVal   = document.getElementById('layerSelect').value;

  const bookData = {
    name,
    author,
    cabinetId: cabinetVal && cabinetVal !== 'NEW' ? parseInt(cabinetVal) : null,
    shelfId:   shelfVal   && shelfVal   !== 'NEW' ? parseInt(shelfVal)   : null,
    rowId:     rowVal     && rowVal     !== 'NEW' ? parseInt(rowVal)     : null,
    layerId:   layerVal   && layerVal   !== 'NEW' ? parseInt(layerVal)   : null,
  };

  showLoadingOverlay(true);
  try {
    const result = await apiFetch('POST', '/api/books', bookData);
    db.books.push(result);
    showToast(`"${name}" נוסף ✓`, 'success');
    render();

    // Keep modal open, keep location, clear only name/author
    const savedCabinetId = bookData.cabinetId;
    const savedShelfId   = bookData.shelfId;
    const savedRowId     = bookData.rowId;
    const savedLayerId   = bookData.layerId;

    document.getElementById('bookName').value   = '';
    document.getElementById('bookAuthor').value = '';
    document.getElementById('bookNameError').textContent   = '';
    document.getElementById('bookAuthorError').textContent = '';
    hideNewRow('newCabinetRow');
    hideNewRow('newShelfRow');
    hideNewRow('newRowRow');
    hideNewRow('newLayerRow');

    populateCabinetSelect(savedCabinetId);
    if (savedCabinetId) {
      populateShelfSelect(savedCabinetId, savedShelfId);
      if (savedShelfId) {
        populateRowSelect(savedShelfId, savedRowId);
        if (savedRowId) populateLayerSelect(savedRowId, savedLayerId);
        else populateLayerSelect(null, null);
      } else {
        populateRowSelect(null, null);
        populateLayerSelect(null, null);
      }
    } else {
      populateShelfSelect(null, null);
      populateRowSelect(null, null);
      populateLayerSelect(null, null);
    }

    document.getElementById('bookName').focus();
  } catch (e) {
    showToast('שגיאה: ' + e.message, 'error');
  } finally {
    showLoadingOverlay(false);
  }
}

// ---- Delete Modal ----
function openDeleteModal(id) {
  const book = db.books.find(b => b.id === id);
  if (!book) return;
  state.deletingBookId = id;
  document.getElementById('deleteBookName').textContent = `"${book.name}"`;
  openModal('deleteModal');
}

async function confirmDelete() {
  if (!state.deletingBookId) return;
  showLoadingOverlay(true);
  try {
    await apiFetch('DELETE', `/api/books/${state.deletingBookId}`);
    db.books = db.books.filter(b => b.id !== state.deletingBookId);
    state.deletingBookId = null;
    closeModal('deleteModal');
    render();
    showToast('הספר נמחק', 'success');
  } catch (e) {
    showToast('שגיאה: ' + e.message, 'error');
  } finally {
    showLoadingOverlay(false);
  }
}

// ---- Locations Modal ----
function openLocationsModal() {
  renderLocationsManager();
  openModal('locationsModal');
}

// ---- Shelf Image ----
let shelfImgTargetId = null;

function compressImage(file, maxPx, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const scale  = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w      = Math.round(img.width  * scale);
        const h      = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function openShelfImgMgmt(shelfId) {
  const shelf = getShelf(shelfId);
  if (!shelf) return;
  shelfImgTargetId = shelfId;
  document.getElementById('shelfImgMgmtName').textContent = shelf.name;
  const currentWrap = document.getElementById('shelfImgCurrentWrap');
  const currentImg  = document.getElementById('shelfImgCurrent');
  if (shelf.image) {
    currentImg.src = shelf.image;
    currentWrap.style.display = '';
  } else {
    currentWrap.style.display = 'none';
  }
  openModal('shelfImgMgmtModal');
}

async function saveShelfImage(base64) {
  showLoadingOverlay(true);
  try {
    await apiFetch('PUT', `/api/locations/${shelfImgTargetId}`, { image: base64 });
    const shelf = getShelf(shelfImgTargetId);
    if (shelf) shelf.image = base64;
    const currentWrap = document.getElementById('shelfImgCurrentWrap');
    const currentImg  = document.getElementById('shelfImgCurrent');
    if (base64) {
      currentImg.src = base64;
      currentWrap.style.display = '';
    } else {
      currentImg.src = '';
      currentWrap.style.display = 'none';
    }
    renderShelvesList(parseInt(document.getElementById('newShelfCabinet').value) || null);
    render();
    showToast(base64 ? 'התמונה נשמרה ✓' : 'התמונה נמחקה ✓', 'success');
  } catch (e) {
    showToast('שגיאה: ' + e.message, 'error');
  } finally {
    showLoadingOverlay(false);
  }
}

function openShelfImgViewer(shelfId) {
  const shelf = getShelf(shelfId);
  if (!shelf || !shelf.image) return;
  document.getElementById('shelfImgViewTitle').textContent = shelf.name;
  document.getElementById('shelfImgViewImg').src = shelf.image;
  openModal('shelfImgViewModal');
}

function renderLocationsManager() {
  // Populate cabinet selects in shelves + rows tabs
  const shelfCabSel = document.getElementById('newShelfCabinet');
  const savedShelfCab = shelfCabSel.value;
  shelfCabSel.innerHTML = '<option value="">-- בחר ארון --</option>';
  db.locations.cabinets.forEach(c => shelfCabSel.appendChild(new Option(c.name, c.id)));
  if (savedShelfCab) shelfCabSel.value = savedShelfCab;

  const rowCabSel = document.getElementById('newRowCabinet');
  const savedRowCab = rowCabSel.value;
  rowCabSel.innerHTML = '<option value="">-- בחר ארון --</option>';
  db.locations.cabinets.forEach(c => rowCabSel.appendChild(new Option(c.name, c.id)));
  if (savedRowCab) rowCabSel.value = savedRowCab;

  // Populate shelf select in rows tab filtered by selected cabinet
  const rowShelfSel = document.getElementById('newRowShelf');
  const savedRowShelf = rowShelfSel.value;
  const filterCabForRows = parseInt(rowCabSel.value) || null;
  rowShelfSel.innerHTML = '<option value="">-- בחר מדף --</option>';
  rowShelfSel.disabled = !filterCabForRows;
  if (filterCabForRows) {
    db.locations.shelves
      .filter(s => s.cabinetId === filterCabForRows)
      .forEach(s => rowShelfSel.appendChild(new Option(s.name, s.id)));
    if (savedRowShelf) rowShelfSel.value = savedRowShelf;
  }

  // Populate selects in layers tab
  const layerCabSel = document.getElementById('newLayerCabinet');
  const savedLayerCab = layerCabSel.value;
  layerCabSel.innerHTML = '<option value="">-- בחר ארון --</option>';
  db.locations.cabinets.forEach(c => layerCabSel.appendChild(new Option(c.name, c.id)));
  if (savedLayerCab) layerCabSel.value = savedLayerCab;

  const layerShelfSel = document.getElementById('newLayerShelf');
  const savedLayerShelf = layerShelfSel.value;
  const filterCabForLayers = parseInt(layerCabSel.value) || null;
  layerShelfSel.innerHTML = '<option value="">-- בחר מדף --</option>';
  layerShelfSel.disabled = !filterCabForLayers;
  if (filterCabForLayers) {
    db.locations.shelves
      .filter(s => s.cabinetId === filterCabForLayers)
      .forEach(s => layerShelfSel.appendChild(new Option(s.name, s.id)));
    if (savedLayerShelf) layerShelfSel.value = savedLayerShelf;
  }

  const layerRowSel = document.getElementById('newLayerRowMgr');
  const savedLayerRow = layerRowSel.value;
  const filterShelfForLayers = parseInt(layerShelfSel.value) || null;
  layerRowSel.innerHTML = '<option value="">-- בחר טור --</option>';
  layerRowSel.disabled = !filterShelfForLayers;
  if (filterShelfForLayers) {
    db.locations.rows
      .filter(r => r.shelfId === filterShelfForLayers)
      .forEach(r => layerRowSel.appendChild(new Option(r.name, r.id)));
    if (savedLayerRow) layerRowSel.value = savedLayerRow;
  }

  // Cabinets list
  const cabList = document.getElementById('cabinetsList');
  if (db.locations.cabinets.length === 0) {
    cabList.innerHTML = '<div style="color:var(--color-muted);padding:10px">אין ארונות</div>';
  } else {
    cabList.innerHTML = db.locations.cabinets.map(c => {
      const booksCount = db.books.filter(b => b.cabinetId === c.id).length;
      const ownerLine  = c.owner ? `<div class="loc-item-owner">👤 ${esc(c.owner)}</div>` : '';
      const editBtnLabel = c.owner ? '👤 ערוך בעלים' : '👤 הוסף בעלים';
      return `<div class="loc-item-cab">
        <div class="loc-item-cab-top">
          <div class="loc-item-cab-info">
            <div class="loc-item-name">🗄️ ${esc(c.name)}</div>
            ${ownerLine}
            <div class="loc-item-meta">${booksCount} ספרים</div>
          </div>
          <div class="loc-item-cab-btns">
            <button class="loc-item-edit-owner" data-action="edit-owner" data-id="${c.id}">${editBtnLabel}</button>
            <button class="loc-item-delete" data-action="del-cabinet" data-id="${c.id}">מחק</button>
          </div>
        </div>
        <div class="loc-owner-edit-row" id="ownerEditRow_${c.id}">
          <input type="text" placeholder="הכנס שם בעלים..." value="${esc(c.owner || '')}">
          <button class="btn-confirm" data-action="save-owner" data-id="${c.id}" title="שמור">✓</button>
          <button class="btn-cancel-sm" data-action="cancel-owner" data-id="${c.id}" title="בטל">✕</button>
        </div>
      </div>`;
    }).join('');
  }

  // Shelves list — filtered by selected cabinet
  renderShelvesList(parseInt(shelfCabSel.value) || null);

  // Rows list — filtered by selected shelf
  renderRowsList(parseInt(rowShelfSel.value) || null);

  // Layers list — filtered by selected row
  renderLayersList(parseInt(layerRowSel.value) || null);
}

function renderShelvesList(filterCabinetId) {
  const shelvesList = document.getElementById('shelvesList');
  const shelves = filterCabinetId
    ? db.locations.shelves.filter(s => s.cabinetId === filterCabinetId)
    : [];

  if (!filterCabinetId) {
    shelvesList.innerHTML = '<div style="color:var(--color-muted);padding:10px">בחר ארון להצגת המדפים שלו</div>';
    return;
  }
  if (shelves.length === 0) {
    shelvesList.innerHTML = '<div style="color:var(--color-muted);padding:10px">אין מדפים בארון זה</div>';
    return;
  }
  shelvesList.innerHTML = shelves.map(s => {
    const cab = getCabinet(s.cabinetId);
    const booksCount = db.books.filter(b => b.shelfId === s.id).length;
    return `<div class="loc-item">
      <div><div class="loc-item-name">📋 ${esc(s.name)}</div>
      <div class="loc-item-meta">${cab ? cab.name : ''} · ${booksCount} ספרים</div></div>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="loc-item-img-btn${s.image ? ' has-image' : ''}" data-action="shelf-img" data-id="${s.id}" title="${s.image ? 'החלף תמונה' : 'הוסף תמונה'}">📷</button>
        <button class="loc-item-delete" data-action="del-shelf" data-id="${s.id}">מחק</button>
      </div>
    </div>`;
  }).join('');
}

function renderRowsList(filterShelfId) {
  const rowsList = document.getElementById('rowsList');
  const rows = filterShelfId
    ? db.locations.rows.filter(r => r.shelfId === filterShelfId)
    : [];

  if (!filterShelfId) {
    rowsList.innerHTML = '<div style="color:var(--color-muted);padding:10px">בחר מדף להצגת הטורים שלו</div>';
    return;
  }
  if (rows.length === 0) {
    rowsList.innerHTML = '<div style="color:var(--color-muted);padding:10px">אין טורים במדף זה</div>';
    return;
  }
  rowsList.innerHTML = rows.map(r => {
    const shelf = getShelf(r.shelfId);
    const cab   = shelf ? getCabinet(shelf.cabinetId) : null;
    const booksCount = db.books.filter(b => b.rowId === r.id).length;
    return `<div class="loc-item">
      <div><div class="loc-item-name">· ${esc(r.name)}</div>
      <div class="loc-item-meta">${cab ? cab.name + ' / ' : ''}${shelf ? shelf.name : ''} · ${booksCount} ספרים</div></div>
      <button class="loc-item-delete" data-action="del-row" data-id="${r.id}">מחק</button>
    </div>`;
  }).join('');
}

function renderLayersList(filterRowId) {
  const layersList = document.getElementById('layersList');
  const layers = filterRowId
    ? db.locations.layers.filter(l => l.rowId === filterRowId)
    : [];

  if (!filterRowId) {
    layersList.innerHTML = '<div style="color:var(--color-muted);padding:10px">בחר טור להצגת השכבות שלו</div>';
    return;
  }
  if (layers.length === 0) {
    layersList.innerHTML = '<div style="color:var(--color-muted);padding:10px">אין שכבות בטור זה</div>';
    return;
  }
  layersList.innerHTML = layers.map(l => {
    const row   = getRow(l.rowId);
    const shelf = row ? getShelf(row.shelfId) : null;
    const cab   = shelf ? getCabinet(shelf.cabinetId) : null;
    const booksCount = db.books.filter(b => b.layerId === l.id).length;
    return `<div class="loc-item">
      <div><div class="loc-item-name">‣ ${esc(l.name)}</div>
      <div class="loc-item-meta">${cab ? cab.name + ' / ' : ''}${shelf ? shelf.name + ' / ' : ''}${row ? row.name : ''} · ${booksCount} ספרים</div></div>
      <button class="loc-item-delete" data-action="del-layer" data-id="${l.id}">מחק</button>
    </div>`;
  }).join('');
}

// ============================================================
// TOAST
// ============================================================
let toastTimer;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3000);
}

// ============================================================
// EXCEL IMPORT / EXPORT
// ============================================================

let pendingImportBooks = [];

function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const wsData = [
    ['שם ספר', 'שם סופר', 'ארון', 'מדף', 'טור', 'שכבה'],
    ['הארי פוטר ואבן החכמים', "ג'יי קיי רולינג",        'ארון 1', 'מדף 1', 'טור 1', 'שכבה א'],
    ['1984',                  "ג'ורג' אורוול",            'ארון 1', 'מדף 1', 'טור 1', 'שכבה ב'],
    ['הנסיך הקטן',            'אנטואן דה סנט-אקזופרי',   'ארון 2', 'מדף 3', 'טור 2', ''],
    ['ספר לדוגמה',            'סופר לדוגמה',              'ארון 2', 'מדף 3', 'טור 2', ''],
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch: 32 }, { wch: 26 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];

  // Bold header
  ['A1','B1','C1','D1','E1','F1'].forEach(cell => {
    if (!ws[cell]) return;
    ws[cell].s = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '6B3F26' } },
      alignment: { horizontal: 'center', readingOrder: 2 },
    };
  });

  XLSX.utils.book_append_sheet(wb, ws, 'ספרים');
  XLSX.writeFile(wb, 'תבנית_קטלוג_ספרים.xlsx');
  showToast('התבנית הורדה בהצלחה ✓', 'success');
}

function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      parseImportRows(rows);
    } catch {
      showToast('שגיאה בקריאת הקובץ', 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function parseImportRows(rows) {
  if (rows.length < 2) { showToast('הקובץ ריק', 'error'); return; }

  const HEADER_MAP = {
    'שם ספר': 'name', 'שם סופר': 'author',
    'ארון': 'cabinet', 'מדף': 'shelf', 'טור': 'row', 'שכבה': 'layer',
  };

  const headers = rows[0].map(h => String(h).trim());
  const colIdx  = {};
  headers.forEach((h, i) => { if (HEADER_MAP[h]) colIdx[HEADER_MAP[h]] = i; });

  if (colIdx.name === undefined || colIdx.author === undefined) {
    showToast('חסרות עמודות חובה: "שם ספר" ו-"שם סופר"', 'error');
    return;
  }

  const books  = [];
  const errors = [];

  rows.slice(1).forEach((row, i) => {
    if (row.every(c => !String(c).trim())) return; // skip empty rows
    const line   = i + 2;
    const name   = String(row[colIdx.name]   ?? '').trim();
    const author = String(row[colIdx.author] ?? '').trim();
    if (!name)   { errors.push(`שורה ${line}: חסר שם ספר`);  return; }
    if (!author) { errors.push(`שורה ${line}: חסר שם סופר`); return; }
    books.push({
      name, author,
      cabinet: colIdx.cabinet !== undefined ? String(row[colIdx.cabinet] ?? '').trim() : '',
      shelf:   colIdx.shelf   !== undefined ? String(row[colIdx.shelf]   ?? '').trim() : '',
      row:     colIdx.row     !== undefined ? String(row[colIdx.row]     ?? '').trim() : '',
      layer:   colIdx.layer   !== undefined ? String(row[colIdx.layer]   ?? '').trim() : '',
    });
  });

  if (books.length === 0) { showToast('לא נמצאו ספרים תקינים לייבוא', 'error'); return; }

  pendingImportBooks = books;
  showImportResult(books, errors);
}

function showImportResult(books, errors) {
  // Detect new locations
  const newCabNames  = new Set();
  const newShelfKeys = new Set();
  const newRowKeys   = new Set();
  const newLayerKeys = new Set();

  books.forEach(b => {
    if (b.cabinet) {
      const existCab = db.locations.cabinets.find(c => c.name === b.cabinet);
      if (!existCab) newCabNames.add(b.cabinet);
      if (b.shelf) {
        const cab = existCab || { id: -1 };
        const existShelf = db.locations.shelves.find(
          s => s.name === b.shelf && (s.cabinetId === cab.id || newCabNames.has(b.cabinet))
        );
        if (!existShelf) newShelfKeys.add(`${b.cabinet}/${b.shelf}`);
        if (b.row) {
          const existRow = db.locations.rows.find(r => r.name === b.row);
          if (!existRow) newRowKeys.add(`${b.cabinet}/${b.shelf}/${b.row}`);
          if (b.layer) {
            const existLayer = db.locations.layers.find(l => l.name === b.layer);
            if (!existLayer) newLayerKeys.add(`${b.cabinet}/${b.shelf}/${b.row}/${b.layer}`);
          }
        }
      }
    }
  });

  // Summary
  const parts = [`<strong>${books.length}</strong> ספרים`];
  if (newCabNames.size)  parts.push(`<span class="import-new-badge">חדש</span>${newCabNames.size} ארונות`);
  if (newShelfKeys.size) parts.push(`<span class="import-new-badge">חדש</span>${newShelfKeys.size} מדפים`);
  if (newRowKeys.size)   parts.push(`<span class="import-new-badge">חדש</span>${newRowKeys.size} טורים`);
  if (newLayerKeys.size) parts.push(`<span class="import-new-badge">חדש</span>${newLayerKeys.size} שכבות`);

  document.getElementById('importSummary').innerHTML =
    `<div class="import-summary-box">📊 נמצאו: ${parts.join(' &nbsp;·&nbsp; ')}</div>`;

  // Errors
  const errBox = document.getElementById('importErrorsBox');
  if (errors.length) {
    errBox.classList.remove('hidden');
    errBox.innerHTML = `<strong>⚠️ ${errors.length} שורות עם שגיאות (ידולגו):</strong>
      <ul>${errors.map(e => `<li>${e}</li>`).join('')}</ul>`;
  } else {
    errBox.classList.add('hidden');
  }

  // Preview table
  const preview  = books.slice(0, 15);
  const moreRows = books.length > 15
    ? `<tr><td colspan="7" style="text-align:center;color:var(--color-muted);padding:10px">...ועוד ${books.length - 15} ספרים</td></tr>`
    : '';

  document.getElementById('importPreviewTable').innerHTML = `
    <table class="import-table">
      <thead><tr><th>#</th><th>שם ספר</th><th>שם סופר</th><th>ארון</th><th>מדף</th><th>טור</th><th>שכבה</th></tr></thead>
      <tbody>
        ${preview.map((b, i) => `<tr>
          <td style="color:var(--color-muted)">${i + 1}</td>
          <td><strong>${esc(b.name)}</strong></td>
          <td>${esc(b.author)}</td>
          <td>${esc(b.cabinet)}</td>
          <td>${esc(b.shelf)}</td>
          <td>${esc(b.row)}</td>
          <td>${esc(b.layer)}</td>
        </tr>`).join('')}
        ${moreRows}
      </tbody>
    </table>`;

  // Show result panel, hide drop zone, show import button in footer
  document.getElementById('dropZone').style.display = 'none';
  document.getElementById('importResult').classList.remove('hidden');
  const importBtn = document.getElementById('importModalConfirm');
  importBtn.textContent   = `📥 ייבא ${books.length} ספרים`;
  importBtn.style.display = '';
}

async function confirmImport() {
  const count = pendingImportBooks.length;
  showLoadingOverlay(true);
  try {
    const result = await apiFetch('POST', '/api/books/bulk', { books: pendingImportBooks });
    db.books.push(...result.books);
    db.locations = result.locations;
    if (!db.locations.layers) db.locations.layers = [];
    pendingImportBooks = [];
    closeModal('bookModal');
    render();
    showToast(`${count} ספרים יובאו בהצלחה ✓`, 'success');
  } catch (e) {
    showToast('שגיאה: ' + e.message, 'error');
  } finally {
    showLoadingOverlay(false);
  }
}

// ============================================================
// EVENT LISTENERS
// ============================================================

document.addEventListener('DOMContentLoaded', () => {

  // ---- Navbar ----
  document.getElementById('addBookBtn').addEventListener('click', openAddBookModal);
  document.getElementById('emptyAddBtn').addEventListener('click', openAddBookModal);

  // Search
  const searchInput = document.getElementById('searchInput');
  const searchClear = document.getElementById('searchClear');

  searchInput.addEventListener('input', () => {
    state.search = searchInput.value;
    searchClear.classList.toggle('visible', state.search.length > 0);
    render();
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    state.search = '';
    searchClear.classList.remove('visible');
    render();
  });

  // View toggle
  document.getElementById('viewGridBtn').addEventListener('click', () => {
    state.view = 'grid';
    document.getElementById('viewGridBtn').classList.add('active');
    document.getElementById('viewListBtn').classList.remove('active');
    render();
  });

  document.getElementById('viewListBtn').addEventListener('click', () => {
    state.view = 'list';
    document.getElementById('viewListBtn').classList.add('active');
    document.getElementById('viewGridBtn').classList.remove('active');
    render();
  });

  // Manage locations
  document.getElementById('manageLocationsBtn').addEventListener('click', openLocationsModal);

  // Clear filter
  document.getElementById('clearFilterBtn').addEventListener('click', () => {
    state.filter = { cabinetId: null, shelfId: null, rowId: null, layerId: null, owner: null };
    render();
  });

  // ---- Location Tree (delegated) ----
  document.getElementById('locationTree').addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;

    if (action === 'filter-owner') {
      const owner = el.dataset.owner;
      if (state.filter.owner === owner) {
        state.filter = { cabinetId: null, shelfId: null, rowId: null, layerId: null, owner: null };
      } else {
        state.filter = { cabinetId: null, shelfId: null, rowId: null, layerId: null, owner };
      }
    } else if (action === 'filter-all') {
      state.filter = { cabinetId: null, shelfId: null, rowId: null, layerId: null, owner: null };
    } else if (action === 'filter-cabinet') {
      const id = parseInt(el.dataset.id);
      if (state.filter.cabinetId === id && !state.filter.shelfId) {
        state.filter = { cabinetId: null, shelfId: null, rowId: null, layerId: null, owner: null };
      } else {
        state.filter = { cabinetId: id, shelfId: null, rowId: null, layerId: null, owner: null };
      }
    } else if (action === 'filter-shelf') {
      const shelfId   = parseInt(el.dataset.id);
      const cabinetId = parseInt(el.dataset.cabinet);
      if (state.filter.shelfId === shelfId && !state.filter.rowId) {
        state.filter = { cabinetId, shelfId: null, rowId: null, layerId: null, owner: null };
      } else {
        state.filter = { cabinetId, shelfId, rowId: null, layerId: null, owner: null };
      }
    } else if (action === 'filter-row') {
      const rowId     = parseInt(el.dataset.id);
      const shelfId   = parseInt(el.dataset.shelf);
      const cabinetId = parseInt(el.dataset.cabinet);
      if (state.filter.rowId === rowId && !state.filter.layerId) {
        state.filter = { cabinetId, shelfId, rowId: null, layerId: null, owner: null };
      } else {
        state.filter = { cabinetId, shelfId, rowId, layerId: null, owner: null };
      }
    } else if (action === 'filter-layer') {
      const layerId   = parseInt(el.dataset.id);
      const rowId     = parseInt(el.dataset.row);
      const shelfId   = parseInt(el.dataset.shelf);
      const cabinetId = parseInt(el.dataset.cabinet);
      if (state.filter.layerId === layerId) {
        state.filter = { cabinetId, shelfId, rowId, layerId: null, owner: null };
      } else {
        state.filter = { cabinetId, shelfId, rowId, layerId, owner: null };
      }
    }
    render();
  });

  // ---- Books container (delegated) ----
  document.getElementById('booksContainer').addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'edit')           openEditBookModal(parseInt(el.dataset.id));
    if (el.dataset.action === 'delete')         openDeleteModal(parseInt(el.dataset.id));
    if (el.dataset.action === 'view-shelf-img') openShelfImgViewer(parseInt(el.dataset.shelfId));
  });

  // ---- Book Modal ----
  document.getElementById('bookModalClose').addEventListener('click',  () => closeModal('bookModal'));
  document.getElementById('bookModalCancel').addEventListener('click', () => closeModal('bookModal'));
  document.getElementById('bookModalSave').addEventListener('click', saveBook);
  document.getElementById('bookModalSaveAndAdd').addEventListener('click', saveBookAndContinue);

  // Cabinet select change
  document.getElementById('cabinetSelect').addEventListener('change', e => {
    const val = e.target.value;
    if (val === 'NEW') {
      showNewRow('newCabinetRow');
      e.target.value = '';
    } else {
      hideNewRow('newCabinetRow');
      populateShelfSelect(val ? parseInt(val) : null, null);
      populateRowSelect(null, null);
      populateLayerSelect(null, null);
    }
  });

  // Confirm / Cancel new cabinet
  document.getElementById('confirmNewCabinet').addEventListener('click', async () => {
    const name = document.getElementById('newCabinetName').value.trim();
    if (!name) { showToast('הכנס שם לארון', 'error'); return; }
    showLoadingOverlay(true);
    try {
      const result = await apiFetch('POST', '/api/locations', { type: 'ארון', name });
      const newCab = { id: result.id, name: result.name };
      db.locations.cabinets.push(newCab);
      hideNewRow('newCabinetRow');
      populateCabinetSelect(newCab.id);
      populateShelfSelect(newCab.id, null);
      populateRowSelect(null, null);
      populateLayerSelect(null, null);
      showToast(`ארון "${name}" נוסף ✓`, 'success');
      render();
    } catch (e) {
      showToast('שגיאה: ' + e.message, 'error');
    } finally {
      showLoadingOverlay(false);
    }
  });

  document.getElementById('cancelNewCabinet').addEventListener('click', () => {
    hideNewRow('newCabinetRow');
    document.getElementById('cabinetSelect').value = '';
  });

  // Shelf select change
  document.getElementById('shelfSelect').addEventListener('change', e => {
    const val = e.target.value;
    if (val === 'NEW') {
      showNewRow('newShelfRow');
      e.target.value = '';
    } else {
      hideNewRow('newShelfRow');
      populateRowSelect(val ? parseInt(val) : null, null);
      populateLayerSelect(null, null);
    }
  });

  // Confirm / Cancel new shelf
  document.getElementById('confirmNewShelf').addEventListener('click', async () => {
    const name = document.getElementById('newShelfName').value.trim();
    const cabinetId = parseInt(document.getElementById('cabinetSelect').value);
    if (!name) { showToast('הכנס שם למדף', 'error'); return; }
    if (!cabinetId) { showToast('בחר ארון תחילה', 'error'); return; }
    showLoadingOverlay(true);
    try {
      const result = await apiFetch('POST', '/api/locations', { type: 'מדף', name, parentId: cabinetId });
      const newShelf = { id: result.id, cabinetId, name: result.name };
      db.locations.shelves.push(newShelf);
      hideNewRow('newShelfRow');
      populateShelfSelect(cabinetId, newShelf.id);
      populateRowSelect(newShelf.id, null);
      populateLayerSelect(null, null);
      showToast(`מדף "${name}" נוסף ✓`, 'success');
      render();
    } catch (e) {
      showToast('שגיאה: ' + e.message, 'error');
    } finally {
      showLoadingOverlay(false);
    }
  });

  document.getElementById('cancelNewShelf').addEventListener('click', () => {
    hideNewRow('newShelfRow');
    document.getElementById('shelfSelect').value = '';
  });

  // Row (טור) select change
  document.getElementById('rowSelect').addEventListener('change', e => {
    const val = e.target.value;
    if (val === 'NEW') {
      showNewRow('newRowRow');
      e.target.value = '';
    } else {
      hideNewRow('newRowRow');
      populateLayerSelect(val ? parseInt(val) : null, null);
    }
  });

  // Confirm / Cancel new row (טור)
  document.getElementById('confirmNewRow').addEventListener('click', async () => {
    const name = document.getElementById('newRowName').value.trim();
    const shelfId = parseInt(document.getElementById('shelfSelect').value);
    if (!name) { showToast('הכנס שם לטור', 'error'); return; }
    if (!shelfId) { showToast('בחר מדף תחילה', 'error'); return; }
    showLoadingOverlay(true);
    try {
      const result = await apiFetch('POST', '/api/locations', { type: 'טור', name, parentId: shelfId });
      const newRow = { id: result.id, shelfId, name: result.name };
      db.locations.rows.push(newRow);
      hideNewRow('newRowRow');
      populateRowSelect(shelfId, newRow.id);
      populateLayerSelect(newRow.id, null);
      showToast(`טור "${name}" נוסף ✓`, 'success');
      render();
    } catch (e) {
      showToast('שגיאה: ' + e.message, 'error');
    } finally {
      showLoadingOverlay(false);
    }
  });

  document.getElementById('cancelNewRow').addEventListener('click', () => {
    hideNewRow('newRowRow');
    document.getElementById('rowSelect').value = '';
  });

  // Layer (שכבה) select change
  document.getElementById('layerSelect').addEventListener('change', e => {
    const val = e.target.value;
    if (val === 'NEW') {
      showNewRow('newLayerRow');
      e.target.value = '';
    } else {
      hideNewRow('newLayerRow');
    }
  });

  // Confirm / Cancel new layer (שכבה)
  document.getElementById('confirmNewLayer').addEventListener('click', async () => {
    const name  = document.getElementById('newLayerName').value.trim();
    const rowId = parseInt(document.getElementById('rowSelect').value);
    if (!name)  { showToast('הכנס שם לשכבה', 'error'); return; }
    if (!rowId) { showToast('בחר טור תחילה', 'error'); return; }
    showLoadingOverlay(true);
    try {
      const result = await apiFetch('POST', '/api/locations', { type: 'שכבה', name, parentId: rowId });
      const newLayer = { id: result.id, rowId, name: result.name };
      db.locations.layers.push(newLayer);
      hideNewRow('newLayerRow');
      populateLayerSelect(rowId, newLayer.id);
      showToast(`שכבה "${name}" נוספה ✓`, 'success');
      render();
    } catch (e) {
      showToast('שגיאה: ' + e.message, 'error');
    } finally {
      showLoadingOverlay(false);
    }
  });

  document.getElementById('cancelNewLayer').addEventListener('click', () => {
    hideNewRow('newLayerRow');
    document.getElementById('layerSelect').value = '';
  });

  // ---- Delete Modal ----
  document.getElementById('deleteModalClose').addEventListener('click',   () => closeModal('deleteModal'));
  document.getElementById('deleteModalCancel').addEventListener('click',  () => closeModal('deleteModal'));
  document.getElementById('deleteModalConfirm').addEventListener('click', confirmDelete);

  // ---- Locations Modal ----
  document.getElementById('locationsModalClose').addEventListener('click',  () => closeModal('locationsModal'));
  document.getElementById('locationsModalClose2').addEventListener('click', () => closeModal('locationsModal'));

  // Tabs
  document.querySelectorAll('.loc-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.loc-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.loc-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1)).classList.add('active');
    });
  });

  // Filter shelves list by cabinet selection in manager
  document.getElementById('newShelfCabinet').addEventListener('change', () => {
    const cabinetId = parseInt(document.getElementById('newShelfCabinet').value) || null;
    renderShelvesList(cabinetId);
  });

  // Filter rows by cabinet in manager (cascade: cabinet → shelf selector)
  document.getElementById('newRowCabinet').addEventListener('change', () => {
    const cabinetId = parseInt(document.getElementById('newRowCabinet').value) || null;
    const rowShelfSel = document.getElementById('newRowShelf');
    rowShelfSel.innerHTML = '<option value="">-- בחר מדף --</option>';
    rowShelfSel.disabled = !cabinetId;
    if (cabinetId) {
      db.locations.shelves
        .filter(s => s.cabinetId === cabinetId)
        .forEach(s => rowShelfSel.appendChild(new Option(s.name, s.id)));
    }
    renderRowsList(null);
  });

  // Filter rows list by shelf selection in manager
  document.getElementById('newRowShelf').addEventListener('change', () => {
    const shelfId = parseInt(document.getElementById('newRowShelf').value) || null;
    renderRowsList(shelfId);
  });

  // Layer tab cascades in manager
  document.getElementById('newLayerCabinet').addEventListener('change', () => {
    const cabinetId = parseInt(document.getElementById('newLayerCabinet').value) || null;
    const layerShelfSel = document.getElementById('newLayerShelf');
    layerShelfSel.innerHTML = '<option value="">-- בחר מדף --</option>';
    layerShelfSel.disabled = !cabinetId;
    if (cabinetId) {
      db.locations.shelves
        .filter(s => s.cabinetId === cabinetId)
        .forEach(s => layerShelfSel.appendChild(new Option(s.name, s.id)));
    }
    const layerRowSel = document.getElementById('newLayerRowMgr');
    layerRowSel.innerHTML = '<option value="">-- בחר טור --</option>';
    layerRowSel.disabled = true;
    renderLayersList(null);
  });

  document.getElementById('newLayerShelf').addEventListener('change', () => {
    const shelfId = parseInt(document.getElementById('newLayerShelf').value) || null;
    const layerRowSel = document.getElementById('newLayerRowMgr');
    layerRowSel.innerHTML = '<option value="">-- בחר טור --</option>';
    layerRowSel.disabled = !shelfId;
    if (shelfId) {
      db.locations.rows
        .filter(r => r.shelfId === shelfId)
        .forEach(r => layerRowSel.appendChild(new Option(r.name, r.id)));
    }
    renderLayersList(null);
  });

  document.getElementById('newLayerRowMgr').addEventListener('change', () => {
    const rowId = parseInt(document.getElementById('newLayerRowMgr').value) || null;
    renderLayersList(rowId);
  });

  // Add cabinet from manager
  document.getElementById('addCabinetBtn').addEventListener('click', async () => {
    const name  = document.getElementById('newCabinetNameMgr').value.trim();
    const owner = document.getElementById('newCabinetOwnerMgr').value.trim();
    if (!name) { showToast('הכנס שם לארון', 'error'); return; }
    showLoadingOverlay(true);
    try {
      const result = await apiFetch('POST', '/api/locations', { type: 'ארון', name, owner });
      db.locations.cabinets.push({ id: result.id, name: result.name, owner: result.owner || '' });
      document.getElementById('newCabinetNameMgr').value  = '';
      document.getElementById('newCabinetOwnerMgr').value = '';
      renderLocationsManager();
      render();
      showToast(`ארון "${name}" נוסף ✓`, 'success');
    } catch (e) {
      showToast('שגיאה: ' + e.message, 'error');
    } finally {
      showLoadingOverlay(false);
    }
  });

  // Add shelf from manager
  document.getElementById('addShelfBtn').addEventListener('click', async () => {
    const name      = document.getElementById('newShelfNameMgr').value.trim();
    const cabinetId = parseInt(document.getElementById('newShelfCabinet').value);
    if (!name)      { showToast('הכנס שם למדף', 'error');   return; }
    if (!cabinetId) { showToast('בחר ארון תחילה', 'error'); return; }
    showLoadingOverlay(true);
    try {
      const result = await apiFetch('POST', '/api/locations', { type: 'מדף', name, parentId: cabinetId });
      db.locations.shelves.push({ id: result.id, cabinetId, name: result.name });
      document.getElementById('newShelfNameMgr').value = '';
      renderLocationsManager();
      render();
      showToast(`מדף "${name}" נוסף ✓`, 'success');
    } catch (e) {
      showToast('שגיאה: ' + e.message, 'error');
    } finally {
      showLoadingOverlay(false);
    }
  });

  // Add row (טור) from manager
  document.getElementById('addRowBtn').addEventListener('click', async () => {
    const name    = document.getElementById('newRowNameMgr').value.trim();
    const shelfId = parseInt(document.getElementById('newRowShelf').value);
    if (!name)    { showToast('הכנס שם לטור', 'error');    return; }
    if (!shelfId) { showToast('בחר מדף תחילה', 'error');   return; }
    showLoadingOverlay(true);
    try {
      const result = await apiFetch('POST', '/api/locations', { type: 'טור', name, parentId: shelfId });
      db.locations.rows.push({ id: result.id, shelfId, name: result.name });
      document.getElementById('newRowNameMgr').value = '';
      renderLocationsManager();
      render();
      showToast(`טור "${name}" נוסף ✓`, 'success');
    } catch (e) {
      showToast('שגיאה: ' + e.message, 'error');
    } finally {
      showLoadingOverlay(false);
    }
  });

  // Add layer (שכבה) from manager
  document.getElementById('addLayerBtn').addEventListener('click', async () => {
    const name  = document.getElementById('newLayerNameMgr').value.trim();
    const rowId = parseInt(document.getElementById('newLayerRowMgr').value);
    if (!name)  { showToast('הכנס שם לשכבה', 'error'); return; }
    if (!rowId) { showToast('בחר טור תחילה', 'error');  return; }
    showLoadingOverlay(true);
    try {
      const result = await apiFetch('POST', '/api/locations', { type: 'שכבה', name, parentId: rowId });
      db.locations.layers.push({ id: result.id, rowId, name: result.name });
      document.getElementById('newLayerNameMgr').value = '';
      renderLocationsManager();
      render();
      showToast(`שכבה "${name}" נוספה ✓`, 'success');
    } catch (e) {
      showToast('שגיאה: ' + e.message, 'error');
    } finally {
      showLoadingOverlay(false);
    }
  });

  // Enter/Escape key in owner edit inputs
  document.getElementById('cabinetsList').addEventListener('keydown', e => {
    if (e.target.tagName !== 'INPUT') return;
    const row = e.target.closest('.loc-owner-edit-row');
    if (!row) return;
    if (e.key === 'Enter') {
      row.querySelector('[data-action="save-owner"]').click();
    } else if (e.key === 'Escape') {
      row.querySelector('[data-action="cancel-owner"]').click();
    }
  });

  // Delete / edit-owner location (delegated from manager lists)
  document.getElementById('cabinetsList').addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = parseInt(btn.dataset.id);

    if (btn.dataset.action === 'edit-owner') {
      const row = document.getElementById(`ownerEditRow_${id}`);
      if (row) {
        row.classList.add('visible');
        const input = row.querySelector('input');
        if (input) { input.focus(); input.select(); }
      }
      return;
    }
    if (btn.dataset.action === 'cancel-owner') {
      const row = document.getElementById(`ownerEditRow_${id}`);
      if (row) row.classList.remove('visible');
      return;
    }
    if (btn.dataset.action === 'save-owner') {
      const row   = document.getElementById(`ownerEditRow_${id}`);
      const owner = row ? row.querySelector('input').value.trim() : '';
      showLoadingOverlay(true);
      try {
        await apiFetch('PUT', `/api/locations/${id}`, { owner });
        const cab = db.locations.cabinets.find(c => c.id === id);
        if (cab) cab.owner = owner;
        renderLocationsManager();
        render();
        showToast('הבעלים עודכן ✓', 'success');
      } catch (e) {
        showToast('שגיאה: ' + e.message, 'error');
      } finally {
        showLoadingOverlay(false);
      }
      return;
    }
    if (btn.dataset.action === 'del-cabinet') {
      const shelfIds  = db.locations.shelves.filter(s => s.cabinetId === id).map(s => s.id);
      const rowIds    = db.locations.rows.filter(r => shelfIds.includes(r.shelfId)).map(r => r.id);
      const layerIds  = db.locations.layers.filter(l => rowIds.includes(l.rowId)).map(l => l.id);
      const bookCount = db.books.filter(b =>
        b.cabinetId === id || shelfIds.includes(b.shelfId) ||
        rowIds.includes(b.rowId) || layerIds.includes(b.layerId)
      ).length;
      const parts = [];
      if (shelfIds.length)  parts.push(`${shelfIds.length} מדפים`);
      if (rowIds.length)    parts.push(`${rowIds.length} טורים`);
      if (layerIds.length)  parts.push(`${layerIds.length} שכבות`);
      if (bookCount)        parts.push(`${bookCount} ספרים`);
      const extra = parts.length ? ` תמחק גם ${formatCascadeParts(parts)}` : '';
      if (!confirm(`מחיקת הארון${extra}. להמשיך?`)) return;
      showLoadingOverlay(true);
      try {
        await apiFetch('DELETE', `/api/locations/${id}?cascade=true`);
        const bookSet = new Set(db.books.filter(b =>
          b.cabinetId === id || shelfIds.includes(b.shelfId) ||
          rowIds.includes(b.rowId) || layerIds.includes(b.layerId)
        ).map(b => b.id));
        db.books = db.books.filter(b => !bookSet.has(b.id));
        db.locations.layers  = db.locations.layers.filter(l => !layerIds.includes(l.id));
        db.locations.rows    = db.locations.rows.filter(r => !rowIds.includes(r.id));
        db.locations.shelves = db.locations.shelves.filter(s => !shelfIds.includes(s.id));
        db.locations.cabinets = db.locations.cabinets.filter(c => c.id !== id);
        renderLocationsManager();
        render();
        showToast('הארון נמחק ✓', 'success');
      } catch (e) {
        showToast('שגיאה: ' + e.message, 'error');
      } finally {
        showLoadingOverlay(false);
      }
    }
  });

  ['shelvesList', 'rowsList', 'layersList'].forEach(listId => {
    document.getElementById(listId).addEventListener('click', async e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = parseInt(btn.dataset.id);

      if (btn.dataset.action === 'shelf-img') {
        openShelfImgMgmt(id);
        return;
      }

      let confirmMsg = '';
      let rowIds = [], layerIds = [], bookSet = new Set();

      if (btn.dataset.action === 'del-shelf') {
        rowIds    = db.locations.rows.filter(r => r.shelfId === id).map(r => r.id);
        layerIds  = db.locations.layers.filter(l => rowIds.includes(l.rowId)).map(l => l.id);
        const bookCount = db.books.filter(b =>
          b.shelfId === id || rowIds.includes(b.rowId) || layerIds.includes(b.layerId)
        ).length;
        const parts = [];
        if (rowIds.length)   parts.push(`${rowIds.length} טורים`);
        if (layerIds.length) parts.push(`${layerIds.length} שכבות`);
        if (bookCount)       parts.push(`${bookCount} ספרים`);
        const extra = parts.length ? ` תמחק גם ${formatCascadeParts(parts)}` : '';
        confirmMsg = `מחיקת המדף${extra}. להמשיך?`;
        bookSet = new Set(db.books.filter(b =>
          b.shelfId === id || rowIds.includes(b.rowId) || layerIds.includes(b.layerId)
        ).map(b => b.id));
      } else if (btn.dataset.action === 'del-row') {
        layerIds  = db.locations.layers.filter(l => l.rowId === id).map(l => l.id);
        const bookCount = db.books.filter(b =>
          b.rowId === id || layerIds.includes(b.layerId)
        ).length;
        const parts = [];
        if (layerIds.length) parts.push(`${layerIds.length} שכבות`);
        if (bookCount)       parts.push(`${bookCount} ספרים`);
        const extra = parts.length ? ` תמחק גם ${formatCascadeParts(parts)}` : '';
        confirmMsg = `מחיקת הטור${extra}. להמשיך?`;
        bookSet = new Set(db.books.filter(b =>
          b.rowId === id || layerIds.includes(b.layerId)
        ).map(b => b.id));
      } else if (btn.dataset.action === 'del-layer') {
        const bookCount = db.books.filter(b => b.layerId === id).length;
        const extra = bookCount ? ` תמחק גם ${bookCount} ספרים` : '';
        confirmMsg = `מחיקת השכבה${extra}. להמשיך?`;
        bookSet = new Set(db.books.filter(b => b.layerId === id).map(b => b.id));
      }

      if (!confirm(confirmMsg)) return;

      showLoadingOverlay(true);
      try {
        await apiFetch('DELETE', `/api/locations/${id}?cascade=true`);
        db.books = db.books.filter(b => !bookSet.has(b.id));
        if (btn.dataset.action === 'del-shelf') {
          db.locations.layers  = db.locations.layers.filter(l => !layerIds.includes(l.id));
          db.locations.rows    = db.locations.rows.filter(r => !rowIds.includes(r.id));
          db.locations.shelves = db.locations.shelves.filter(s => s.id !== id);
        } else if (btn.dataset.action === 'del-row') {
          db.locations.layers = db.locations.layers.filter(l => !layerIds.includes(l.id));
          db.locations.rows   = db.locations.rows.filter(r => r.id !== id);
        } else if (btn.dataset.action === 'del-layer') {
          db.locations.layers = db.locations.layers.filter(l => l.id !== id);
        }
        renderLocationsManager();
        render();
        showToast('המיקום נמחק ✓', 'success');
      } catch (e) {
        showToast('שגיאה: ' + e.message, 'error');
      } finally {
        showLoadingOverlay(false);
      }
    });
  });

  // ---- Shelf Image Management Modal ----
  document.getElementById('shelfImgMgmtClose').addEventListener('click',  () => closeModal('shelfImgMgmtModal'));
  document.getElementById('shelfImgMgmtClose2').addEventListener('click', () => closeModal('shelfImgMgmtModal'));

  document.getElementById('shelfImgPickBtn').addEventListener('click', () => {
    document.getElementById('shelfImgFileInput').value = '';
    document.getElementById('shelfImgFileInput').click();
  });

  document.getElementById('shelfImgFileInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      let base64 = await compressImage(file, 300, 0.75);
      if (base64.length > 45000) base64 = await compressImage(file, 200, 0.65);
      if (base64.length > 45000) { showToast('התמונה גדולה מדי גם לאחר דחיסה', 'error'); return; }
      await saveShelfImage(base64);
    } catch {
      showToast('שגיאה בעיבוד התמונה', 'error');
    }
  });

  document.getElementById('shelfImgDeleteBtn').addEventListener('click', async () => {
    await saveShelfImage('');
  });

  // ---- Shelf Image Viewer Modal ----
  document.getElementById('shelfImgViewClose').addEventListener('click',  () => closeModal('shelfImgViewModal'));
  document.getElementById('shelfImgViewClose2').addEventListener('click', () => closeModal('shelfImgViewModal'));

  // Close modal on overlay click
  ['bookModal', 'deleteModal', 'locationsModal', 'shelfImgMgmtModal', 'shelfImgViewModal'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => {
      if (e.target === document.getElementById(id)) closeModal(id);
    });
  });

  // Enter key in book form fields
  ['bookName', 'bookAuthor'].forEach(fieldId => {
    document.getElementById(fieldId).addEventListener('keydown', e => {
      if (e.key === 'Enter') saveBook();
    });
  });

  // Enter key in new location inputs
  [['newCabinetName', 'confirmNewCabinet'],
   ['newShelfName',   'confirmNewShelf'],
   ['newRowName',     'confirmNewRow'],
   ['newLayerName',   'confirmNewLayer']].forEach(([inputId, btnId]) => {
    document.getElementById(inputId).addEventListener('keydown', e => {
      if (e.key === 'Enter')  document.getElementById(btnId).click();
      if (e.key === 'Escape') document.getElementById('cancel' + btnId.replace('confirm', '')).click();
    });
  });

  // ---- Bottom Nav Tabs ----
  document.querySelectorAll('.bottom-tab').forEach(btn => {
    btn.addEventListener('click', () => switchMobileTab(btn.dataset.tab));
  });

  // Management view action cards
  document.getElementById('mgmtAddBook').addEventListener('click', openAddBookModal);

  document.getElementById('mgmtAddMultiple').addEventListener('click', () => {
    openAddBookModal();
    // Focus user on the "save and add" flow — show a brief hint toast
    showToast('השתמש ב"שמור והוסף עוד" לאחר בחירת מיקום', '');
  });

  document.getElementById('mgmtImportExcel').addEventListener('click', () => {
    openAddBookModal();
    switchBookModalTab('excel');
  });

  document.getElementById('mgmtLocations').addEventListener('click', openLocationsModal);

  // ---- Sidebar toggle (mobile) ----
  document.getElementById('filterToggleBtn').addEventListener('click', openSidebar);
  document.getElementById('sidebarCloseBtn').addEventListener('click', closeSidebar);
  document.getElementById('sidebarDoneBtn').addEventListener('click', closeSidebar);
  document.getElementById('sidebarBackdrop').addEventListener('click', closeSidebar);

  // Also close sidebar after selecting a filter on mobile
  document.getElementById('locationTree').addEventListener('click', () => {
    if (window.innerWidth < 768) setTimeout(closeSidebar, 180);
  });

  // ---- Sort ----
  const sortBtn      = document.getElementById('sortBtn');
  const sortDropdown = document.getElementById('sortDropdown');
  const sortBackdrop = document.getElementById('sortBackdrop');

  function openSortDropdown() {
    sortDropdown.classList.add('open');
    sortBackdrop.classList.add('open');
    sortDropdown.querySelectorAll('.sort-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.sort === state.sort);
    });
    document.body.style.overflow = 'hidden';
  }

  function closeSortDropdown() {
    sortDropdown.classList.remove('open');
    sortBackdrop.classList.remove('open');
    document.body.style.overflow = '';
  }

  sortBtn.addEventListener('click', e => {
    e.stopPropagation();
    sortDropdown.classList.contains('open') ? closeSortDropdown() : openSortDropdown();
  });

  sortDropdown.addEventListener('click', e => {
    const opt = e.target.closest('.sort-option');
    if (!opt) return;
    state.sort = opt.dataset.sort;
    closeSortDropdown();
    sortBtn.innerHTML = `↕ ${SORT_LABELS[state.sort]}`;
    render();
  });

  sortBackdrop.addEventListener('click', closeSortDropdown);

  document.addEventListener('click', e => {
    if (!sortBtn.contains(e.target) && !sortDropdown.contains(e.target)) {
      closeSortDropdown();
    }
  });

  // ---- Book Modal Tabs ----
  document.getElementById('bookModalTabs').addEventListener('click', e => {
    const tab = e.target.closest('.modal-tab');
    if (!tab) return;
    switchBookModalTab(tab.dataset.tab);
    if (tab.dataset.tab === 'manual') document.getElementById('bookName').focus();
  });

  // ---- Excel Tab ----
  document.getElementById('downloadTemplateBtn').addEventListener('click', downloadTemplate);

  document.getElementById('pickFileBtn').addEventListener('click', () => {
    document.getElementById('excelFileInput').value = '';
    document.getElementById('excelFileInput').click();
  });

  // Also clicking anywhere on the drop zone opens file picker
  document.getElementById('dropZone').addEventListener('click', e => {
    if (e.target.closest('.btn-link') || e.target.closest('.btn-primary')) return;
    document.getElementById('excelFileInput').click();
  });

  document.getElementById('excelFileInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handleImportFile(file);
  });

  // Drag and drop
  const dropZone = document.getElementById('dropZone');
  dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleImportFile(file);
  });

  document.getElementById('changeFileBtn').addEventListener('click', resetExcelTab);

  document.getElementById('importModalConfirm').addEventListener('click', confirmImport);

  // ---- Initial load ----
  initApp();
});

async function initApp() {
  showLoadingOverlay(true);
  try {
    await loadData();
    render();
  } catch (e) {
    showToast('שגיאה בטעינת הנתונים: ' + e.message, 'error');
  } finally {
    showLoadingOverlay(false);
  }
}
