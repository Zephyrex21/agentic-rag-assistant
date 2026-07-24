const express = require('express');
const multer = require('multer');
const path = require('path');
const { randomUUID } = require('crypto');

const documentStore = require('../db/documentStore');
const chunkStore = require('../db/chunkStore');
const { isSupportedFile } = require('../services/textExtraction');
const { deleteByDocumentId } = require('../services/pinecone');
const { processDocument } = require('../workers/ingestionWorker');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeName = `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB cap
  fileFilter: (req, file, cb) => {
    if (!isSupportedFile(file.originalname)) {
      return cb(new Error('UNSUPPORTED_TYPE'));
    }
    cb(null, true);
  },
});

function errorResponse(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

// POST /api/documents/upload
router.post('/upload', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err.message === 'UNSUPPORTED_TYPE') {
        return errorResponse(res, 400, 'UNSUPPORTED_FILE_TYPE', 'Only .txt, .md, and .pdf files are supported.');
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return errorResponse(res, 400, 'FILE_TOO_LARGE', 'File exceeds the 20MB limit.');
      }
      return errorResponse(res, 400, 'UPLOAD_FAILED', err.message);
    }
    if (!req.file) {
      return errorResponse(res, 400, 'NO_FILE', 'No file was provided in the "file" field.');
    }

    // Everything from here on can hit Supabase, which can throw (bad creds, network
    // blip, table missing, etc.) - wrapped so a DB error becomes a clean 500 response
    // instead of an unhandled rejection that takes the whole server down.
    try {
      const documentId = randomUUID();
      const doc = {
        id: documentId,
        filename: req.file.originalname,
        status: 'processing',
        chunkCount: 0,
        uploadedAt: new Date().toISOString(),
        error: null,
      };

      await documentStore.create(doc);

      // Fire-and-forget: async worker updates status as it progresses.
      // Not awaited on purpose - this is what makes upload non-blocking.
      processDocument({
        documentId,
        filePath: req.file.path,
        filename: req.file.originalname,
      });

      res.status(202).json({ documentId, filename: doc.filename, status: doc.status });
    } catch (dbErr) {
      console.error('[documents] upload failed:', dbErr.message);
      errorResponse(res, 500, 'UPLOAD_FAILED', dbErr.message);
    }
  });
});

// GET /api/documents/:id/status
router.get('/:id/status', async (req, res) => {
  try {
    const doc = await documentStore.get(req.params.id);
    if (!doc) return errorResponse(res, 404, 'DOCUMENT_NOT_FOUND', 'No document with that ID.');
    res.json({
      documentId: doc.id,
      status: doc.status,
      chunkCount: doc.chunkCount,
      error: doc.error || undefined,
    });
  } catch (err) {
    console.error('[documents] status check failed:', err.message);
    errorResponse(res, 500, 'STATUS_CHECK_FAILED', err.message);
  }
});

// GET /api/documents
router.get('/', async (req, res) => {
  try {
    const documents = await documentStore.list();
    res.json({
      documents: documents.map((d) => ({
        id: d.id,
        filename: d.filename,
        status: d.status,
        chunkCount: d.chunkCount,
        uploadedAt: d.uploadedAt,
      })),
    });
  } catch (err) {
    console.error('[documents] list failed:', err.message);
    errorResponse(res, 500, 'LIST_FAILED', err.message);
  }
});

// DELETE /api/documents/:id
router.delete('/:id', async (req, res) => {
  try {
    const doc = await documentStore.get(req.params.id);
    if (!doc) return errorResponse(res, 404, 'DOCUMENT_NOT_FOUND', 'No document with that ID.');

    try {
      await deleteByDocumentId(req.params.id, doc.chunkCount);
    } catch (pineconeErr) {
      // If Pinecone isn't configured yet, still allow metadata cleanup to proceed
      console.warn(`[documents] Pinecone delete skipped/failed for ${req.params.id}:`, pineconeErr.message);
    }

    try {
      await chunkStore.deleteByDocumentId(req.params.id);
    } catch (chunkErr) {
      console.warn(`[documents] chunks table delete skipped/failed for ${req.params.id}:`, chunkErr.message);
    }

    await documentStore.remove(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[documents] delete failed:', err.message);
    errorResponse(res, 500, 'DELETE_FAILED', err.message);
  }
});

module.exports = router;
