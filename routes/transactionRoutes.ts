import { Hono } from 'hono';
import {
    saveDraftTransaction,
    getExistingFiles,
    getDraftTransactions,
    deleteDraftTransaction,
    getApproversFlow,
    directApproveTransactions,
    debugGenerateApprovedStructureRemarks,
    getBorrowTransactions,
    getReturnsByBorrow,
    getHRCenterData,
    sendHRCenterToSap,
    getHRCenterSapMinus,
    downloadHRCenterSapFile,
    getMonitorHistory,
    getTransactionActionLog,
    getTransactionLogYear,
    getTransactionLogYearDetail,
    getSapMonitorGrid,
    getSapMonitorLog
} from '../controllers/transactionController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = new Hono();

router.post('/draft', saveDraftTransaction);
router.get('/drafts', getDraftTransactions); // Expects ?employeeId=xxx
router.get('/borrow-records', getBorrowTransactions);
router.get('/return-history/:documentNo', getReturnsByBorrow);
router.get('/files', getExistingFiles);
router.delete('/draft/:id', deleteDraftTransaction);
router.get('/approvers', getApproversFlow);
router.post('/direct-approve', directApproveTransactions);
router.post('/debug/structure-remarks', verifyToken, debugGenerateApprovedStructureRemarks);
router.get('/hrcenter', getHRCenterData);
router.post('/hrcenter/send-to-sap', sendHRCenterToSap);
router.get('/hrcenter/sap-minus', getHRCenterSapMinus);
router.get('/hrcenter/sap-file', downloadHRCenterSapFile);
router.get('/monitor-history', getMonitorHistory);
router.get('/action-log', getTransactionActionLog);
router.get('/log-yearly', getTransactionLogYear);
router.get('/log-yearly/detail', getTransactionLogYearDetail);
router.get('/sap-monitor', getSapMonitorGrid);
router.get('/sap-monitor/log', getSapMonitorLog);

export default router;
