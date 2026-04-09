import { Hono } from 'hono';
import {
    getStartYear,
    getHistoryManDriver,
    checkDupManDriver,
    createManDriver,
    getMKDDetails,
    upsertMainKey,
    updateDetailKey,
    deleteKey,
    uploadFile,
    deleteFile,
    getMasterKeys,
    updateManDriverStatus,
    getHeadCount,
    updateHeadCount,
    updateUnitName,
    updateNote,
    getHistoryApprove,
    getFlowHistory,
    approveManDriver,
    getFile,
    getMKDDashboardData,
    updateProductivityRate,
    requestApproveMKD,
    exportListKeyman,
    createMasterKeyMaster,
    updateMasterKeyMaster,
    downloadMasterKeyTemplate,
    exportPosition,
    getInboxManDriver,
    getMyRequestsMKD,
    submitMKDApproveAction,
    copyMKD,
    getMKDHistory,
    cancelMKD
} from '../controllers/mkdController.js';

const app = new Hono();

// GET /api/mkd/years
app.get('/start-year', getStartYear);

// GET /api/mkd/history
app.get('/history', getHistoryManDriver);

// GET /api/mkd/history-approve
app.get('/history-approve', getHistoryApprove);

// GET /api/mkd/inbox
app.get('/inbox', getInboxManDriver);

// GET /api/mkd/my-requests
app.get('/my-requests', getMyRequestsMKD);

// GET /api/mkd/master-keys
app.get('/master-keys', getMasterKeys);

// PUT /api/mkd/:id/status
app.put('/:id/status', updateManDriverStatus);

// POST /api/mkd/check-dup
app.post('/check-dup', checkDupManDriver);

// POST /api/mkd
app.post('/', createManDriver);

// GET /api/mkd/:id/details
app.get('/:id/details', getMKDDetails);

// POST /api/mkd/:id/keys/main
app.post('/:id/keys/main', upsertMainKey);

// POST /api/mkd/:id/keys/detail
app.post('/:id/keys/detail', updateDetailKey);

// DELETE /api/mkd/:id/keys/:keyId
app.delete('/:id/keys/:keyId', deleteKey);

// POST /api/mkd/:id/files
app.post('/:id/files', uploadFile);

// DELETE /api/mkd/:id/files/:fileId
app.delete('/:id/files/:fileId', deleteFile);

// GET /api/mkd/:id/headcount
app.get('/:id/headcount', getHeadCount);

// POST /api/mkd/:id/headcount
app.post('/:id/headcount', updateHeadCount);

// PUT /api/mkd/:id/unitname
app.put('/:id/unitname', updateUnitName);

// PUT /api/mkd/:id/note
app.put('/:id/note', updateNote);

// GET /api/mkd/:id/flow-history
app.get('/:id/flow-history', getFlowHistory);

// PUT /api/mkd/:id/approve
app.put('/:id/approve', approveManDriver);

// GET /api/mkd/:id/files/:fileId
app.get('/:id/files/:fileId', getFile);

// GET /api/mkd/:id/dashboard
app.get('/:id/dashboard', getMKDDashboardData);

// POST /api/mkd/:id/dashboard/rate
app.post('/:id/dashboard/rate', updateProductivityRate);

// POST /api/mkd/:id/request-approve
app.post('/:id/request-approve', requestApproveMKD);

// GET /api/mkd/export-list
app.get('/export-list', exportListKeyman);

// POST /api/mkd/master-keys
app.post('/master-keys', createMasterKeyMaster);

// PUT /api/mkd/master-keys/:id
app.put('/master-keys/:id', updateMasterKeyMaster);

// GET /api/mkd/template/master-keys
app.get('/template/master-keys', downloadMasterKeyTemplate);

// GET /api/mkd/export-position
app.get('/export-position', exportPosition);

// POST /api/mkd/:id/submit-approve-action
app.post('/:id/submit-approve-action', submitMKDApproveAction);

// PUT /api/mkd/:id/cancel
app.put('/:id/cancel', cancelMKD);

// POST /api/mkd/:id/copy
app.post('/:id/copy', copyMKD);

// GET /api/mkd/history-copy
app.get('/history-copy', getMKDHistory);

export default app;

