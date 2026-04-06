import { Hono } from 'hono';
import {
    getPIR,
    insertPIR,
    deletePIR,
    copyPIR,
    getPIROrg,
    getFileAttach,
    uploadFilePIR,
    downloadFilePIR,
    deleteFileAttach,
    getRemark,
    insertRemark,
    deleteRemark,
    exportExcel,
    getPIRTemplate
} from '../controllers/pirController.js';

const app = new Hono();

// Tab 1: PIR
app.get('/', getPIR);
app.post('/', insertPIR);
app.put('/delete', deletePIR);
app.post('/copy', copyPIR);
app.get('/org', getPIROrg);

// Tab 2: File Attach
app.get('/file', getFileAttach);
app.post('/file/upload', uploadFilePIR);
app.get('/file/download/:effYear/:fileId', downloadFilePIR);
app.put('/file/delete', deleteFileAttach);

// Tab 3: Remark
app.get('/remark', getRemark);
app.post('/remark', insertRemark);
app.put('/remark/delete', deleteRemark);

// Tab 4: Import/Export
app.get('/export', exportExcel);
app.get('/template', getPIRTemplate);

export default app;
