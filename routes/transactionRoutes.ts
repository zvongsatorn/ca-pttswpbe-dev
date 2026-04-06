import { Hono } from 'hono';
import { saveDraftTransaction, getExistingFiles, getDraftTransactions, deleteDraftTransaction, getApproversFlow, directApproveTransactions, getBorrowTransactions, getReturnsByBorrow, getHRCenterData } from '../controllers/transactionController.js';

const router = new Hono();

router.post('/draft', saveDraftTransaction);
router.get('/drafts', getDraftTransactions); // Expects ?employeeId=xxx
router.get('/borrow-records', getBorrowTransactions);
router.get('/return-history/:documentNo', getReturnsByBorrow);
router.get('/files', getExistingFiles);
router.delete('/draft/:id', deleteDraftTransaction);
router.get('/approvers', getApproversFlow);
router.post('/direct-approve', directApproveTransactions);
router.get('/hrcenter', getHRCenterData);

export default router;
