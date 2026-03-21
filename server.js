// ============================================================
// קטלוג הספרייה - server.js
// ============================================================
'use strict';

require('dotenv').config();
const express    = require('express');
const { google } = require('googleapis');
const path       = require('path');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Config ----
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const BOOKS_SHEET    = 'ספרים';
const LOC_SHEET      = 'מיקומים';
const LOANS_SHEET    = 'השאלות';
const WISHLIST_SHEET = 'רשימת_קניות';

if (!SPREADSHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  console.error('❌  חסרים SPREADSHEET_ID או GOOGLE_SERVICE_ACCOUNT_JSON ב-.env');
  process.exit(1);
}

// ============================================================
// Google Sheets client
// ============================================================

let _sheets = null;

async function getSheets() {
  if (_sheets) return _sheets;
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  _sheets = google.sheets({ version: 'v4', auth });
  return _sheets;
}

// ---- Cache sheet IDs to avoid repeated metadata calls ----
const _sheetIds = {};

async function getSheetId(name) {
  if (_sheetIds[name] !== undefined) return _sheetIds[name];
  const s    = await getSheets();
  const meta = await s.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  meta.data.sheets.forEach(sh => { _sheetIds[sh.properties.title] = sh.properties.sheetId; });
  return _sheetIds[name];
}

// ---- Low-level helpers ----

async function sheetGet(sheetName) {
  const s   = await getSheets();
  const res = await s.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'`,
  });
  return res.data.values || [];
}

async function sheetAppend(sheetName, rows, colRange) {
  const s = await getSheets();
  const range = colRange ? `'${sheetName}'!${colRange}` : `'${sheetName}'!A1`;
  await s.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: 'RAW',
    resource: { values: rows },
  });
}

async function sheetUpdate(sheetName, rowNum, values) {
  // rowNum is 1-based (e.g. row 2 = first data row after header)
  const s = await getSheets();
  await s.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!A${rowNum}`,
    valueInputOption: 'RAW',
    resource: { values: [values] },
  });
}

async function sheetDeleteRow(sheetName, arrayIndex) {
  // arrayIndex is 0-based index from the values array
  const s       = await getSheets();
  const sheetId = await getSheetId(sheetName);
  await s.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: {
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: arrayIndex, endIndex: arrayIndex + 1 },
        },
      }],
    },
  });
}

// ---- Parse helpers ----

function parseBooks(rows) {
  if (rows.length <= 1) return [];
  return rows.slice(1)
    .map(r => ({
      id:        parseInt(r[0]),
      name:      r[1] || '',
      author:    r[2] || '',
      cabinetId: parseInt(r[3]) || null,
      shelfId:   parseInt(r[4]) || null,
      rowId:     parseInt(r[5]) || null,
      layerId:      parseInt(r[6]) || null,
      notes:        r[7] || '',
      series:       r[8] || '',
      seriesNumber: r[9] || '',
    }))
    .filter(b => b.id && b.name);
}

function parseLocations(rows) {
  const out = { cabinets: [], shelves: [], rows: [], layers: [] };
  if (rows.length <= 1) return out;
  rows.slice(1).forEach(r => {
    const type = r[0], id = parseInt(r[1]), name = r[2], pid = parseInt(r[3]) || null;
    const extra = r[4] ? String(r[4]).trim() : '';
    const image = r[5] ? String(r[5]).trim() : '';
    if (!id || !name) return;
    if (type === 'ארון')  out.cabinets.push({ id, name, owner: extra });
    if (type === 'מדף')   out.shelves.push({ id, cabinetId: pid, name });
    if (type === 'טור') {
      if (image) {
        const validPrefix = image.startsWith('data:image/') || image.startsWith('https://');
        console.log(`[Image] טעינת תמונה לטור ${id} (${name}): ${image.length} תווים, תקין: ${validPrefix}`);
        if (!validPrefix) console.warn(`[Image] אזהרה: תמונה לטור ${id} נראית פגומה/חתוכה`);
      }
      out.rows.push({ id, shelfId: pid, name, image });
    }
    if (type === 'שכבה')  out.layers.push({ id, rowId: pid, name });
  });
  return out;
}

function parseLoans(rows) {
  if (rows.length <= 1) return [];
  return rows.slice(1)
    .map(r => ({
      id:       parseInt(r[0]),
      bookId:   parseInt(r[1]),
      borrower: r[2] || '',
      phone:    r[3] || '',
      date:     r[4] || '',
      notes:    r[5] || '',
    }))
    .filter(l => l.id && l.bookId);
}

function parseWishlist(rows) {
  if (rows.length <= 1) return [];
  return rows.slice(1)
    .map(r => ({
      id:           parseInt(r[0]),
      name:         r[1] || '',
      author:       r[2] || '',
      bought:       r[3] || '',
      series:       r[4] || '',
      seriesNumber: r[5] || '',
      notes:        r[6] || '',
    }))
    .filter(w => w.id && w.name);
}

function maxId(items) {
  if (!items.length) return 0;
  return Math.max(...items.map(i => i.id));
}

// ---- Sheet initialisation ----

async function ensureSheets() {
  const s    = await getSheets();
  const meta = await s.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existing = meta.data.sheets.map(sh => sh.properties.title);
  meta.data.sheets.forEach(sh => { _sheetIds[sh.properties.title] = sh.properties.sheetId; });

  const toAdd = [BOOKS_SHEET, LOC_SHEET, LOANS_SHEET, WISHLIST_SHEET].filter(n => !existing.includes(n));
  if (toAdd.length) {
    const res = await s.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests: toAdd.map(title => ({ addSheet: { properties: { title } } })) },
    });
    res.data.replies.forEach((r, i) => {
      _sheetIds[toAdd[i]] = r.addSheet.properties.sheetId;
    });
  }

  // Add headers if sheets are empty
  const booksRows = await sheetGet(BOOKS_SHEET);
  if (!booksRows.length) {
    await sheetAppend(BOOKS_SHEET, [['id', 'שם ספר', 'שם סופר', 'ארון_id', 'מדף_id', 'טור_id', 'שכבה_id', 'הערות', 'סדרה', 'מספר_בסדרה']], 'A:J');
  }
  const locRows = await sheetGet(LOC_SHEET);
  if (!locRows.length) {
    await sheetAppend(LOC_SHEET, [['סוג', 'id', 'שם', 'parent_id']], 'A:F');
  }
  const loansRows = await sheetGet(LOANS_SHEET);
  if (!loansRows.length) {
    await sheetAppend(LOANS_SHEET, [['id', 'book_id', 'שם_שואל', 'טלפון', 'תאריך_השאלה', 'הערות']], 'A:F');
  }
  const wishlistRows = await sheetGet(WISHLIST_SHEET);
  if (!wishlistRows.length) {
    await sheetAppend(WISHLIST_SHEET, [['id', 'שם_ספר', 'שם_סופר', 'נקנה', 'סדרה', 'מספר_בסדרה', 'הערות']], 'A:G');
  }
}

// ============================================================
// API Routes
// ============================================================

// POST /api/upload  – upload image to Cloudinary, return URL
app.post('/api/upload', async (req, res) => {
  try {
    const { base64, rowId } = req.body;
    if (!base64) return res.status(400).json({ error: 'חסר base64' });
    console.log(`[Cloudinary] מעלה תמונה לטור ${rowId}: ${base64.length} תווים`);
    const result = await cloudinary.uploader.upload(base64, {
      folder:        'book-catalog',
      public_id:     `row-${rowId}`,
      overwrite:     true,
      resource_type: 'image',
    });
    console.log(`[Cloudinary] הועלה בהצלחה: ${result.secure_url} (${result.bytes} bytes)`);
    res.json({ url: result.secure_url });
  } catch (e) {
    console.error('[Cloudinary] שגיאת העלאה:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/data  – all books + locations
app.get('/api/data', async (req, res) => {
  try {
    const [booksRows, locRows] = await Promise.all([sheetGet(BOOKS_SHEET), sheetGet(LOC_SHEET)]);
    res.json({ books: parseBooks(booksRows), locations: parseLocations(locRows) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/books  – add one book
app.post('/api/books', async (req, res) => {
  try {
    const { name, author, cabinetId, shelfId, rowId, layerId, notes, series, seriesNumber } = req.body;
    const rows   = await sheetGet(BOOKS_SHEET);
    const nextId = maxId(parseBooks(rows)) + 1;
    await sheetAppend(BOOKS_SHEET, [[nextId, name, author, cabinetId ?? '', shelfId ?? '', rowId ?? '', layerId ?? '', notes ?? '', series ?? '', seriesNumber ?? '']], 'A:J');
    res.json({ id: nextId, name, author, cabinetId, shelfId, rowId, layerId, notes: notes ?? '', series: series ?? '', seriesNumber: seriesNumber ?? '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/books/:id  – update a book
app.put('/api/books/:id', async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const rows     = await sheetGet(BOOKS_SHEET);
    const idx      = rows.findIndex((r, i) => i > 0 && parseInt(r[0]) === targetId);
    if (idx === -1) return res.status(404).json({ error: 'לא נמצא' });
    const { name, author, cabinetId, shelfId, rowId, layerId, notes, series, seriesNumber } = req.body;
    await sheetUpdate(BOOKS_SHEET, idx + 1, [targetId, name, author, cabinetId ?? '', shelfId ?? '', rowId ?? '', layerId ?? '', notes ?? '', series ?? '', seriesNumber ?? '']);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/books/:id
app.delete('/api/books/:id', async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const rows     = await sheetGet(BOOKS_SHEET);
    const idx      = rows.findIndex((r, i) => i > 0 && parseInt(r[0]) === targetId);
    if (idx === -1) return res.status(404).json({ error: 'לא נמצא' });
    await sheetDeleteRow(BOOKS_SHEET, idx);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/books/bulk  – import multiple books + auto-create locations
app.post('/api/books/bulk', async (req, res) => {
  try {
    const incoming = req.body.books || [];
    const [booksRows, locRows] = await Promise.all([sheetGet(BOOKS_SHEET), sheetGet(LOC_SHEET)]);

    let locs      = parseLocations(locRows);
    let nextLocId  = maxId([...locs.cabinets, ...locs.shelves, ...locs.rows, ...locs.layers]) + 1;
    let nextBookId = maxId(parseBooks(booksRows)) + 1;

    const newBookRows = [];
    const newLocRows  = [];
    const newBooks    = [];

    for (const b of incoming) {
      let cabinet = locs.cabinets.find(c => c.name === b.cabinet) || null;
      if (b.cabinet && !cabinet) {
        cabinet = { id: nextLocId++, name: b.cabinet };
        locs.cabinets.push(cabinet);
        newLocRows.push(['ארון', cabinet.id, cabinet.name, '']);
      }

      let shelf = null;
      if (b.shelf && cabinet) {
        shelf = locs.shelves.find(s => s.name === b.shelf && s.cabinetId === cabinet.id) || null;
        if (!shelf) {
          shelf = { id: nextLocId++, cabinetId: cabinet.id, name: b.shelf };
          locs.shelves.push(shelf);
          newLocRows.push(['מדף', shelf.id, shelf.name, cabinet.id]);
        }
      }

      let row = null;
      if (b.row && shelf) {
        row = locs.rows.find(r => r.name === b.row && r.shelfId === shelf.id) || null;
        if (!row) {
          row = { id: nextLocId++, shelfId: shelf.id, name: b.row };
          locs.rows.push(row);
          newLocRows.push(['טור', row.id, row.name, shelf.id]);
        }
      }

      let layer = null;
      if (b.layer && row) {
        layer = locs.layers.find(l => l.name === b.layer && l.rowId === row.id) || null;
        if (!layer) {
          layer = { id: nextLocId++, rowId: row.id, name: b.layer };
          locs.layers.push(layer);
          newLocRows.push(['שכבה', layer.id, layer.name, row.id]);
        }
      }

      const book = { id: nextBookId++, name: b.name, author: b.author,
        cabinetId: cabinet?.id ?? null, shelfId: shelf?.id ?? null,
        rowId: row?.id ?? null, layerId: layer?.id ?? null };
      newBooks.push(book);
      newBookRows.push([book.id, book.name, book.author,
        book.cabinetId ?? '', book.shelfId ?? '', book.rowId ?? '', book.layerId ?? '']);
    }

    if (newLocRows.length)  await sheetAppend(LOC_SHEET,   newLocRows,  'A:F');
    if (newBookRows.length) await sheetAppend(BOOKS_SHEET, newBookRows, 'A:J');

    res.json({ books: newBooks, locations: locs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/locations  – add one location (cabinet / shelf / טור / שכבה)
app.post('/api/locations', async (req, res) => {
  try {
    const { type, name, parentId, owner } = req.body; // type: 'ארון'|'מדף'|'טור'|'שכבה'
    const rows   = await sheetGet(LOC_SHEET);
    const locs   = parseLocations(rows);
    const nextId = maxId([...locs.cabinets, ...locs.shelves, ...locs.rows, ...locs.layers]) + 1;
    const extra  = (type === 'ארון' && owner) ? owner : '';
    await sheetAppend(LOC_SHEET, [[type, nextId, name, parentId ?? '', extra]], 'A:F');
    res.json({ id: nextId, name, parentId, owner: extra });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/locations/:id  – update cabinet owner or shelf image
app.put('/api/locations/:id', async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const { owner, image, name } = req.body;
    const rows = await sheetGet(LOC_SHEET);
    const idx  = rows.findIndex((r, i) => i > 0 && parseInt(r[1]) === targetId);
    if (idx === -1) return res.status(404).json({ error: 'לא נמצא' });
    const row = rows[idx];
    const prevImage    = row[5] ?? '';
    const imageToSave  = image !== undefined ? image : prevImage;
    if (image !== undefined) {
      console.log(`[Image] שמירת תמונה למיקום ${targetId}: ${image || '(מחיקה)'}`);
    }
    // מחק מ-Cloudinary כאשר מוחקים תמונה קיימת
    if (image === '' && prevImage.includes('cloudinary.com')) {
      try {
        await cloudinary.uploader.destroy(`book-catalog/row-${targetId}`);
        console.log(`[Cloudinary] נמחקה תמונה: book-catalog/row-${targetId}`);
      } catch (e) {
        console.warn(`[Cloudinary] שגיאה במחיקה: ${e.message}`);
      }
    }
    await sheetUpdate(LOC_SHEET, idx + 1, [
      row[0], row[1],
      name  !== undefined ? name  : row[2],
      row[3] ?? '',
      owner !== undefined ? owner : (row[4] ?? ''),
      imageToSave,
    ]);
    // אימות שמירה — רלוונטי רק לbase64 ישן (URLs קצרים תמיד יישמרו תקין)
    if (image !== undefined && image && image.startsWith('data:image/')) {
      const verifyRows = await sheetGet(LOC_SHEET);
      const vIdx = verifyRows.findIndex((r, i) => i > 0 && parseInt(r[1]) === targetId);
      const savedImage = vIdx !== -1 ? (verifyRows[vIdx][5] ?? '') : '';
      console.log(`[Image] אימות לאחר שמירה: ${savedImage.length} תווים (נשלחו ${image.length})`);
      if (savedImage.length < image.length * 0.95) {
        return res.status(500).json({ error: `התמונה נחתכה בשמירה: נשמרו ${savedImage.length} תווים מתוך ${image.length}` });
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/locations/:id  (?cascade=true for cascade delete)
app.delete('/api/locations/:id', async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const cascade  = req.query.cascade === 'true';

    const [locRows, booksRows] = await Promise.all([sheetGet(LOC_SHEET), sheetGet(BOOKS_SHEET)]);
    const locIdx = locRows.findIndex((r, i) => i > 0 && parseInt(r[1]) === targetId);
    if (locIdx === -1) return res.status(404).json({ error: 'לא נמצא' });

    if (!cascade) {
      await sheetDeleteRow(LOC_SHEET, locIdx);
      return res.json({ ok: true });
    }

    // ---- Cascade: collect all IDs to remove ----
    const locs       = parseLocations(locRows);
    const targetType = locRows[locIdx][0];

    let shelfIds = [], rowIds = [], layerIds = [], bookIds = [];

    if (targetType === 'ארון') {
      shelfIds  = locs.shelves.filter(s => s.cabinetId === targetId).map(s => s.id);
      rowIds    = locs.rows.filter(r => shelfIds.includes(r.shelfId)).map(r => r.id);
      layerIds  = locs.layers.filter(l => rowIds.includes(l.rowId)).map(l => l.id);
      bookIds   = parseBooks(booksRows)
        .filter(b => b.cabinetId === targetId || shelfIds.includes(b.shelfId) ||
                     rowIds.includes(b.rowId)  || layerIds.includes(b.layerId))
        .map(b => b.id);
    } else if (targetType === 'מדף') {
      rowIds    = locs.rows.filter(r => r.shelfId === targetId).map(r => r.id);
      layerIds  = locs.layers.filter(l => rowIds.includes(l.rowId)).map(l => l.id);
      bookIds   = parseBooks(booksRows)
        .filter(b => b.shelfId === targetId || rowIds.includes(b.rowId) || layerIds.includes(b.layerId))
        .map(b => b.id);
    } else if (targetType === 'טור') {
      layerIds  = locs.layers.filter(l => l.rowId === targetId).map(l => l.id);
      bookIds   = parseBooks(booksRows)
        .filter(b => b.rowId === targetId || layerIds.includes(b.layerId))
        .map(b => b.id);
    } else if (targetType === 'שכבה') {
      bookIds   = parseBooks(booksRows)
        .filter(b => b.layerId === targetId)
        .map(b => b.id);
    }

    // ---- Delete books (descending index so shifts don't affect remaining) ----
    const bookSet          = new Set(bookIds);
    const bookIdxToDelete  = booksRows
      .map((r, i) => (i > 0 && bookSet.has(parseInt(r[0]))) ? i : -1)
      .filter(i => i !== -1)
      .sort((a, b) => b - a);

    for (const idx of bookIdxToDelete) {
      await sheetDeleteRow(BOOKS_SHEET, idx);
    }

    // ---- Delete locations (target + all children, descending) ----
    const locIdSet        = new Set([targetId, ...shelfIds, ...rowIds, ...layerIds]);
    const locIdxToDelete  = locRows
      .map((r, i) => (i > 0 && locIdSet.has(parseInt(r[1]))) ? i : -1)
      .filter(i => i !== -1)
      .sort((a, b) => b - a);

    for (const idx of locIdxToDelete) {
      await sheetDeleteRow(LOC_SHEET, idx);
    }

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/loans
app.get('/api/loans', async (req, res) => {
  try {
    const rows = await sheetGet(LOANS_SHEET);
    res.json(parseLoans(rows));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/loans
app.post('/api/loans', async (req, res) => {
  try {
    const { bookId, borrower, phone, date, notes } = req.body;
    const rows   = await sheetGet(LOANS_SHEET);
    const loans  = parseLoans(rows);
    const nextId = (loans.length ? Math.max(...loans.map(l => l.id)) : 0) + 1;
    await sheetAppend(LOANS_SHEET, [[nextId, bookId, borrower, phone ?? '', date ?? '', notes ?? '']], 'A:F');
    res.json({ id: nextId, bookId, borrower, phone: phone ?? '', date: date ?? '', notes: notes ?? '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/loans/:id
app.delete('/api/loans/:id', async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const rows     = await sheetGet(LOANS_SHEET);
    const idx      = rows.findIndex((r, i) => i > 0 && parseInt(r[0]) === targetId);
    if (idx === -1) return res.status(404).json({ error: 'לא נמצא' });
    await sheetDeleteRow(LOANS_SHEET, idx);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/wishlist
app.get('/api/wishlist', async (req, res) => {
  try {
    const rows = await sheetGet(WISHLIST_SHEET);
    res.json(parseWishlist(rows));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/wishlist
app.post('/api/wishlist', async (req, res) => {
  try {
    const { name, author, series, seriesNumber, notes } = req.body;
    const rows   = await sheetGet(WISHLIST_SHEET);
    const items  = parseWishlist(rows);
    const nextId = (items.length ? Math.max(...items.map(i => i.id)) : 0) + 1;
    await sheetAppend(WISHLIST_SHEET, [[nextId, name, author ?? '', '', series ?? '', seriesNumber ?? '', notes ?? '']], 'A:G');
    res.json({ id: nextId, name, author: author ?? '', bought: '', series: series ?? '', seriesNumber: seriesNumber ?? '', notes: notes ?? '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/wishlist/:id  — mark as bought
app.put('/api/wishlist/:id', async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const rows = await sheetGet(WISHLIST_SHEET);
    const idx  = rows.findIndex((r, i) => i > 0 && parseInt(r[0]) === targetId);
    if (idx === -1) return res.status(404).json({ error: 'לא נמצא' });
    const row = rows[idx];
    await sheetUpdate(WISHLIST_SHEET, idx + 1, [row[0], row[1], row[2], 'כן', row[4] ?? '', row[5] ?? '', row[6] ?? '']);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/wishlist/:id
app.delete('/api/wishlist/:id', async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const rows = await sheetGet(WISHLIST_SHEET);
    const idx  = rows.findIndex((r, i) => i > 0 && parseInt(r[0]) === targetId);
    if (idx === -1) return res.status(404).json({ error: 'לא נמצא' });
    await sheetDeleteRow(WISHLIST_SHEET, idx);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Fallback: serve index.html for any non-API route ----
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================================
// Start
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`\n📚  קטלוג הספרייה פועל על  http://localhost:${PORT}\n`);
  try {
    await ensureSheets();
    console.log('✅  Google Sheets מוכן\n');
  } catch (err) {
    console.error('❌  שגיאה בחיבור ל-Google Sheets:', err.message, '\n');
  }
});
