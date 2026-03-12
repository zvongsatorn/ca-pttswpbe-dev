import { Context } from 'hono';
import { 
    submitDocumentService, 
    getInboxService, 
    approveDocumentService, 
    rejectDocumentService,
    rejectAllDocumentService,
    getMyRequestsService,
    getDocumentDetailService,
    getInboxCountService,
    getProgressService,
    getAllTransactionsService
} from '../services/documentService.js';

export const submitDocument = async (c: Context) => {
    try {
        const body = await c.req.json();
        const { documentType, items, createBy, userGroupNo, parentDocumentNo } = body;
        const employeeId = c.get('user')?.employeeId || createBy;

        if (!employeeId) {
            return c.json({ status: 401, message: 'Unauthorized' }, 401);
        }

        const result = await submitDocumentService({ documentType, items, userGroupNo, parentDocumentNo }, employeeId);
        return c.json({ status: 200, ...result });
    } catch (error: any) {
        console.error('Error submitting document:', error);
        return c.json({ status: 500, message: 'Internal server error while submitting document', error: error.message }, 500);
    }
};

export const getInbox = async (c: Context) => {
    try {
        const employeeId = c.get('user')?.employeeId || c.req.query('employeeId');
        
        if (!employeeId) {
            return c.json({ status: 401, message: 'Unauthorized' }, 401);
        }

        const inboxItems = await getInboxService(employeeId);
        return c.json({ status: 200, data: inboxItems });
    } catch (error: any) {
        console.error('Error fetching inbox:', error);
        return c.json({ status: 500, message: 'Internal server error while fetching inbox', error: error.message }, 500);
    }
};

export const getInboxCount = async (c: Context) => {
    try {
        const employeeId = c.get('user')?.employeeId || c.req.query('employeeId');
        
        if (!employeeId) {
            return c.json({ status: 401, message: 'Unauthorized' }, 401);
        }

        const count = await getInboxCountService(employeeId);
        return c.json({ status: 200, count });
    } catch (error: any) {
        console.error('Error fetching inbox count:', error);
        return c.json({ status: 500, message: 'Internal server error while fetching inbox count', error: error.message }, 500);
    }
};

export const approveDocument = async (c: Context) => {
    try {
        const body = await c.req.json();
        const { documentNo, itemId, seqno, updateBy } = body;
        const employeeId = c.get('user')?.employeeId || updateBy;

        if (!employeeId || !documentNo || !itemId || seqno == null) {
            return c.json({ status: 400, message: 'Missing required parameters' }, 400);
        }

        const result = await approveDocumentService(documentNo, itemId, seqno, employeeId);
        return c.json({ status: 200, ...result });
    } catch (error: any) {
        console.error('Error approving document:', error);
        return c.json({ status: 500, message: 'Internal server error while approving document', error: error.message }, 500);
    }
};

export const rejectDocument = async (c: Context) => {
    try {
        const body = await c.req.json();
        const { documentNo, itemId, seqno, remark, updateBy } = body;
        const employeeId = c.get('user')?.employeeId || updateBy;

        if (!employeeId || !documentNo || !itemId || seqno == null || !remark) {
            return c.json({ status: 400, message: 'Missing required parameters (including remark)' }, 400);
        }

        const result = await rejectDocumentService(documentNo, itemId, seqno, remark, employeeId);
        return c.json({ status: 200, ...result });
    } catch (error: any) {
        console.error('Error rejecting document:', error);
        return c.json({ status: 500, message: 'Internal server error while rejecting document', error: error.message }, 500);
    }
};

export const rejectAllDocument = async (c: Context) => {
    try {
        const body = await c.req.json();
        const { documentNo, remark, updateBy } = body;
        const employeeId = c.get('user')?.employeeId || updateBy;

        if (!employeeId || !documentNo || !remark) {
            return c.json({ status: 400, message: 'Missing required parameters (including remark)' }, 400);
        }

        const result = await rejectAllDocumentService(documentNo, remark, employeeId);
        return c.json({ status: 200, ...result });
    } catch (error: any) {
        console.error('Error rejecting all documents:', error);
        return c.json({ status: 500, message: 'Internal server error while rejecting all documents', error: error.message }, 500);
    }
};

export const getMyRequests = async (c: Context) => {
    try {
        const employeeId = c.get('user')?.employeeId || c.req.query('employeeId');
        
        if (!employeeId) {
            return c.json({ status: 401, message: 'Unauthorized' }, 401);
        }

        const requests = await getMyRequestsService(employeeId);
        return c.json({ status: 200, data: requests });
    } catch (error: any) {
        console.error('Error fetching my requests:', error);
        return c.json({ status: 500, message: 'Internal server error while fetching my requests', error: error.message }, 500);
    }
};

export const getDocumentDetail = async (c: Context) => {
    try {
        const documentNo = c.req.param('documentNo');
        const employeeId = c.get('user')?.employeeId || c.req.query('employeeId');
        
        if (!documentNo || !employeeId) {
            return c.json({ status: 400, message: 'Missing documentNo or employeeId' }, 400);
        }

        const detail = await getDocumentDetailService(documentNo, employeeId);
        if (!detail) {
            return c.json({ status: 404, message: 'Document not found' }, 404);
        }

        return c.json({ status: 200, data: detail });
    } catch (error: any) {
        console.error('Error fetching document detail:', error);
        return c.json({ status: 500, message: 'Internal server error while fetching document detail', error: error.message }, 500);
    }
};

export const getProgress = async (c: Context) => {
    try {
        const employeeId = c.get('user')?.employeeId || c.req.query('employeeId');
        
        if (!employeeId) {
            return c.json({ status: 401, message: 'Unauthorized' }, 401);
        }

        const data = await getProgressService(employeeId);
        return c.json({ status: 200, data });
    } catch (error: any) {
        console.error('Error fetching progress:', error);
        return c.json({ status: 500, message: 'Internal server error while fetching progress', error: error.message }, 500);
    }
};

export const getAllTransactions = async (c: Context) => {
    try {
        const employeeId = c.get('user')?.employeeId || c.req.query('employeeId');
        
        if (!employeeId) {
            return c.json({ status: 401, message: 'Unauthorized' }, 401);
        }

        const data = await getAllTransactionsService(employeeId);
        return c.json({ status: 200, data });
    } catch (error: any) {
        console.error('Error fetching all transactions:', error);
        return c.json({ status: 500, message: 'Internal server error while fetching all transactions', error: error.message }, 500);
    }
};
