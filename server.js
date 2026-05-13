// ============================================================
// קטלוג הספרייה - server.js
// ============================================================
'use strict';

require('dotenv').config();
const express    = require('express');
const { google } = require('googleapis');
const path       = require('path');
const https      = require('https');
const { GoogleGenerativeAI } = require('@google/generative-ai');

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

// ============================================================
// In-memory cache for /api/data
// ============================================================
let _dataCache = null;
let _dataCacheTs = 0;
const DATA_CACHE_TTL = 60 * 1000; // 60 seconds

function invalidateDataCache() {
  _dataCache = null;
  _dataCacheTs = 0;
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
      id:               parseInt(r[0]),
      name:             r[1] || '',
      author:           r[2] || '',
      cabinetId:        parseInt(r[3]) || null,
      shelfId:          parseInt(r[4]) || null,
      rowId:            parseInt(r[5]) || null,
      layerId:          parseInt(r[6]) || null,
      notes:            r[7] || '',
      series:           r[8] || '',
      seriesNumber:     r[9] || '',
      approvedDuplicate: r[10] === 'TRUE',
    }))
    .filter(b => b.id && b.name);
}

function parseLocations(rows) {
  const out = { cabinets: [], shelves: [], rows: [], layers: [] };
  if (rows.length <= 1) return out;
  rows.slice(1).forEach(r => {
    const type = r[0], id = parseInt(r[1]), name = r[2], pid = parseInt(r[3]) || null;
    const extra = r[4] ? String(r[4]).trim() : '';
    if (!id || !name) return;
    if (type === 'ארון')  out.cabinets.push({ id, name, owner: extra });
    if (type === 'מדף')   out.shelves.push({ id, cabinetId: pid, name });
    if (type === 'טור')   out.rows.push({ id, shelfId: pid, name });
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
    await sheetAppend(BOOKS_SHEET, [['id', 'שם ספר', 'שם סופר', 'ארון_id', 'מדף_id', 'טור_id', 'שכבה_id', 'הערות', 'סדרה', 'מספר_בסדרה', 'כפול_מאושר']], 'A:K');
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


// GET /api/data  – all books + locations
app.get('/api/data', async (req, res) => {
  try {
    if (_dataCache && (Date.now() - _dataCacheTs) < DATA_CACHE_TTL) {
      return res.json(_dataCache);
    }
    const [booksRows, locRows] = await Promise.all([sheetGet(BOOKS_SHEET), sheetGet(LOC_SHEET)]);
    _dataCache = { books: parseBooks(booksRows), locations: parseLocations(locRows) };
    _dataCacheTs = Date.now();
    res.json(_dataCache);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/books  – add one book
app.post('/api/books', async (req, res) => {
  try {
    const { name, author, cabinetId, shelfId, rowId, layerId, notes, series, seriesNumber } = req.body;
    const rows   = await sheetGet(BOOKS_SHEET);
    const nextId = maxId(parseBooks(rows)) + 1;
    await sheetAppend(BOOKS_SHEET, [[nextId, name, author, cabinetId ?? '', shelfId ?? '', rowId ?? '', layerId ?? '', notes ?? '', series ?? '', seriesNumber ?? '', '']], 'A:K');
    invalidateDataCache();
    res.json({ id: nextId, name, author, cabinetId, shelfId, rowId, layerId, notes: notes ?? '', series: series ?? '', seriesNumber: seriesNumber ?? '', approvedDuplicate: false });
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
    const existingApproved = (rows[idx][10] === 'TRUE') ? 'TRUE' : '';
    await sheetUpdate(BOOKS_SHEET, idx + 1, [targetId, name, author, cabinetId ?? '', shelfId ?? '', rowId ?? '', layerId ?? '', notes ?? '', series ?? '', seriesNumber ?? '', existingApproved]);
    invalidateDataCache();
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
    invalidateDataCache();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/books/approve-duplicate  – mark a group of books as approved duplicates
app.patch('/api/books/approve-duplicate', async (req, res) => {
  try {
    const ids  = req.body.ids || [];
    const rows = await sheetGet(BOOKS_SHEET);
    for (const targetId of ids) {
      const idx = rows.findIndex((r, i) => i > 0 && parseInt(r[0]) === targetId);
      if (idx === -1) continue;
      const r = rows[idx];
      await sheetUpdate(BOOKS_SHEET, idx + 1, [
        r[0], r[1], r[2], r[3] ?? '', r[4] ?? '', r[5] ?? '', r[6] ?? '',
        r[7] ?? '', r[8] ?? '', r[9] ?? '', 'TRUE',
      ]);
    }
    invalidateDataCache();
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

    invalidateDataCache();
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
    invalidateDataCache();
    res.json({ id: nextId, name, parentId, owner: extra });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/locations/:id  – update cabinet owner or row/shelf name
app.put('/api/locations/:id', async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const { owner, name } = req.body;
    const rows = await sheetGet(LOC_SHEET);
    const idx  = rows.findIndex((r, i) => i > 0 && parseInt(r[1]) === targetId);
    if (idx === -1) return res.status(404).json({ error: 'לא נמצא' });
    const row = rows[idx];
    await sheetUpdate(LOC_SHEET, idx + 1, [
      row[0], row[1],
      name  !== undefined ? name  : row[2],
      row[3] ?? '',
      owner !== undefined ? owner : (row[4] ?? ''),
      row[5] ?? '',
    ]);
    invalidateDataCache();
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
      invalidateDataCache();
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

    invalidateDataCache();
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

// ============================================================
// POST /api/books/recognize-from-image
// קבלת תמונה (base64), זיהוי ספרים עם Gemini, אימות עם Google Books
// ============================================================
app.post('/api/books/recognize-from-image', async (req, res) => {
  try {
    const { imageBase64, mimeType } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'חסרה תמונה' });

    // ---- שלב 1: Gemini מזהה שמות וסופרים מהתמונה ----
    if (!process.env.GOOGLE_AI_API_KEY) return res.status(500).json({ error: 'GOOGLE_AI_API_KEY לא מוגדר' });
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `Look at this bookshelf image. Your task is OCR only — read text that is physically printed on the book spines.

STRICT RULES:
1. Only include books where you can clearly read the title in the image
2. For author: only include if the author's name is visibly printed on the spine — otherwise return empty string ""
3. Do NOT guess, infer, or use prior knowledge to fill in missing information
4. Do NOT hallucinate books that are blurry, hidden, or unclear
5. If a spine is partially visible and you cannot read the full title, skip it

Return ONLY a JSON array, no explanation:
[{"name":"exact text from spine","author":"exact text from spine or empty string"},...]

If no books are clearly readable, return: []`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: imageBase64, mimeType: mimeType || 'image/jpeg' } },
    ]);

    let rawBooks = [];
    try {
      const text = result.response.text().trim()
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
      rawBooks = JSON.parse(text);
    } catch {
      return res.status(500).json({ error: 'Gemini לא החזיר JSON תקין' });
    }

    if (!rawBooks.length) return res.json([]);

    // ---- שלב 2: Google Books מאמת ומשלים כל ספר ----
    const BOOKS_KEY = process.env.GOOGLE_BOOKS_API_KEY || '';

    async function searchGoogleBooks(query) {
      return new Promise((resolve) => {
        const encoded = encodeURIComponent(query);
        const url = `https://www.googleapis.com/books/v1/volumes?q=${encoded}&maxResults=5${BOOKS_KEY ? `&key=${BOOKS_KEY}` : ''}`;
        https.get(url, (r) => {
          let data = '';
          r.on('data', c => data += c);
          r.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch { resolve(null); }
          });
        }).on('error', () => resolve(null));
      });
    }

    function extractBookInfo(volume) {
      const info = volume?.volumeInfo || {};
      // Google Books מחזיר authors כמערך — מאחד לסטרינג
      const author = (info.authors && info.authors.length) ? info.authors.join(', ') : '';
      return {
        name:         info.title || '',
        author,
        series:       '',
        seriesNumber: '',
      };
    }

    // מחפש לפי שם + מחבר, ואם לא נמצא — לפי שם בלבד, ואם לא — לפי מחבר
    async function findBook(raw) {
      // ניסיון א': שם + מחבר
      if (raw.name && raw.author) {
        const res1 = await searchGoogleBooks(`intitle:${raw.name} inauthor:${raw.author}`);
        const items1 = res1?.items || [];
        if (items1.length) {
          const info = extractBookInfo(items1[0]);
          // אם Google Books לא מצא מחבר — שמור את מה ש-Gemini קרא
          if (!info.author) info.author = raw.author;
          return { ...info, verified: true, suggestions: [] };
        }
      }

      // ניסיון ב': שם בלבד (חיפוש מדויק יותר עם intitle)
      if (raw.name) {
        const res2 = await searchGoogleBooks(`intitle:${raw.name}`);
        const items2 = res2?.items || [];
        if (items2.length) {
          const info = extractBookInfo(items2[0]);
          // אם Google Books לא מצא מחבר — שמור את מה ש-Gemini קרא
          if (!info.author && raw.author) info.author = raw.author;
          return { ...info, verified: true, suggestions: [] };
        }
      }

      // ניסיון ג': מחבר בלבד — הצעות לבחירה
      if (raw.author) {
        const res3 = await searchGoogleBooks(`inauthor:${raw.author}`);
        const items3 = res3?.items || [];
        if (items3.length) {
          return {
            name:         raw.name,
            author:       raw.author,
            series:       '',
            seriesNumber: '',
            verified:     false,
            notFound:     false,
            suggestions:  items3.slice(0, 4).map(extractBookInfo),
          };
        }
      }

      // לא נמצא כלום — כנראה הומצא על ידי Gemini
      return {
        name:         raw.name,
        author:       raw.author,
        series:       '',
        seriesNumber: '',
        verified:     false,
        notFound:     true,   // דגל: Google Books לא מצא — כנראה הזיה
        suggestions:  [],
      };
    }

    // מריץ את כל החיפושים במקביל
    const books = await Promise.all(rawBooks.map(findBook));
    res.json(books);

  } catch (e) {
    console.error('recognize-from-image error:', e);
    // חלץ הודעה קצרה וקריאה מתוך שגיאות Gemini
    let msg = e.message || 'שגיאה לא ידועה';
    if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') || msg.includes('FreeTier')) {
      msg = 'חרגת ממגבלת הבקשות החינמיות של Gemini (15 בקשות לדקה). המתן מספר שניות ונסה שוב.';
    } else if (msg.includes('API_KEY') || msg.includes('API key')) {
      msg = 'GOOGLE_AI_API_KEY שגוי או לא תקף.';
    } else if (msg.includes('not found') || msg.includes('not supported')) {
      msg = `הדגם "${msg.match(/models\/[\w.-]+/)?.[0] || 'gemini'}" אינו זמין. פנה למפתח.`;
    } else if (msg.length > 200) {
      msg = msg.substring(0, 200) + '...';
    }
    res.status(500).json({ error: msg });
  }
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
