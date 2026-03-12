import { Hono } from 'hono';
import { 
    submitDocument, 
    getInbox, 
    approveDocument, 
    rejectDocument,
    rejectAllDocument,
    getMyRequests,
    getDocumentDetail,
    getInboxCount,
    getProgress,
    getAllTransactions
} from '../controllers/documentController.js';

const documentRoutes = new Hono();

documentRoutes.post('/submit', submitDocument);
documentRoutes.get('/inbox', getInbox);
documentRoutes.get('/inbox/count', getInboxCount);
documentRoutes.get('/my-requests', getMyRequests);
documentRoutes.post('/approve', approveDocument);
documentRoutes.post('/reject', rejectDocument);
documentRoutes.post('/reject-all', rejectAllDocument);
documentRoutes.get('/progress', getProgress);
documentRoutes.get('/all', getAllTransactions);
documentRoutes.get('/:documentNo', getDocumentDetail);

export default documentRoutes;
