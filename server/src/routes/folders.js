const express = require('express');
const folderStore = require('../db/folderStore');
const { routeError } = require('../utils/userFacingError');

const router = express.Router();

function errorResponse(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

// See routes/documents.js's ownerId() for the same convention.
function ownerId(req) {
  return req.user?.id ?? null;
}

// GET /api/folders
router.get('/', async (req, res) => {
  try {
    const folders = await folderStore.list({ userId: ownerId(req) });
    res.json({ folders });
  } catch (err) {
    console.error('[folders] list failed:', err.message);
    errorResponse(res, ...routeError(err, 'LIST_FAILED', "Couldn't load your folders. Please try again."));
  }
});

// POST /api/folders
// Body: { name: string }
router.post('/', async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) {
    return errorResponse(res, 400, 'MISSING_NAME', 'Request body must include a non-empty "name" string.');
  }
  if (name.length > 100) {
    return errorResponse(res, 400, 'NAME_TOO_LONG', 'Folder name must be 100 characters or fewer.');
  }
  try {
    const folder = await folderStore.create(name, { userId: ownerId(req) });
    res.status(201).json({ folder });
  } catch (err) {
    console.error('[folders] create failed:', err.message);
    errorResponse(res, ...routeError(err, 'CREATE_FAILED', "Couldn't create that folder. Please try again."));
  }
});

// DELETE /api/folders/:id
// Documents inside are NOT deleted - the DB foreign key uncategorizes them
// automatically (see migration_004_document_folders.sql).
router.delete('/:id', async (req, res) => {
  try {
    await folderStore.remove(req.params.id, { userId: ownerId(req) });
    res.json({ success: true });
  } catch (err) {
    console.error('[folders] delete failed:', err.message);
    errorResponse(res, ...routeError(err, 'DELETE_FAILED', "Couldn't delete that folder. Please try again."));
  }
});

module.exports = router;
