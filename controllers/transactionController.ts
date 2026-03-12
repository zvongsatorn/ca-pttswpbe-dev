import { Context } from 'hono';
import { saveDraftTransactionService, getExistingFilesService, getDraftTransactionsService, deleteDraftTransactionService, getApproversFlowService, directApproveTransactionsService, getBorrowTransactionsService, getReturnsByBorrowService, getHRCenterDataService, DraftTransactionPayload } from '../services/transactionService.js';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

export const saveDraftTransaction = async (c: Context) => {
    try {
        // Parse multipart FormData (frontend now sends FormData with 'payload' + optional 'file')
        const formData = await c.req.formData();
        const payloadStr = formData.get('payload') as string;
        const fileEntry = formData.get('file') as File | null;

        if (!payloadStr) {
            return c.json({ status: 400, message: 'Missing payload field' }, 400);
        }

        const body = JSON.parse(payloadStr);
        const createBy = body.employeeId || 'SYSTEM';

        const payload: DraftTransactionPayload = {
            transactionType: body.transactionType,
            effectiveMonth: body.effectiveMonth,
            effectiveYear: body.effectiveYear,
            poolRsFlag: body.poolRsFlag,
            strgFlag: body.strgFlag,
            bsType: body.bsType,
            specFlag: body.specFlag,
            unitReceive: body.unitReceive,
            remark: body.remark,
            lineStaffFlag: body.lineStaffFlag,
            policyFlag: body.policyFlag,
            pastFlag: body.pastFlag,

            levelGroupTo: body.detailData?.levelGroupTo || '',
            levelGroupFrom: body.detailData?.levelGroupFrom || '',
            amount: body.detailData?.amount || 0,
            conclusionNo: body.detailData?.conclusionNo || '',
            conclusionDate: body.detailData?.conclusionDate || null,
            unitTransfer: body.detailData?.unitTransfer || '',
            transferInd: body.detailData?.transferInd || 0,

            // Text values for description formatting
            unitReceiveName: body.unitReceiveName || '',
            unitTransferName: body.detailData?.unitTransferName || '',
            levelGroupFromName: body.detailData?.levelGroupFromName || '',
            levelGroupToName: body.detailData?.levelGroupToName || '',

            // File fields - will fill after saving or use existing file if selected
            fileName: fileEntry?.name || body.detailData?.existingFileName,
            fileUrl: body.detailData?.existingFileUrl,
            refId: body.detailData?.existingFileId, // Using existing TransactionFileID as RefID
        };

        // Save draft first (service generates transactionNo)
        const result = await saveDraftTransactionService(payload, createBy);
        const transactionNo: string = result?.transactionNo || '';

        // If a file was uploaded, save it to uploads/ using transactionNo as filename
        if (fileEntry && transactionNo) {
            const uploadsDir = path.join(process.cwd(), 'uploads');
            if (!existsSync(uploadsDir)) {
                await mkdir(uploadsDir, { recursive: true });
            }
            const ext = path.extname(fileEntry.name) || '';
            const savedFileName = `${transactionNo}${ext}`; // e.g. TR26030001.pdf
            const savedFilePath = path.join(uploadsDir, savedFileName);
            const fileBuffer = Buffer.from(await fileEntry.arrayBuffer());
            await writeFile(savedFilePath, fileBuffer);

            // Update fileUrl in the DB record (update payload and re-call file insert)
            payload.fileName = fileEntry.name;
            payload.fileUrl = `uploads/${savedFileName}`;
            await saveDraftTransactionService({ ...payload, fileUrl: `uploads/${savedFileName}` }, createBy, transactionNo);
        }

        return c.json({
            status: 200,
            message: 'Draft saved successfully',
            data: result
        });
    } catch (error: any) {
        console.error('Error in saveDraftTransaction controller:', error);
        return c.json({
            status: 500,
            message: 'Internal server error',
            error: error.message
        }, 500);
    }
};

export const getExistingFiles = async (c: Context) => {
    try {
        const effectiveMonth = c.req.query('effectiveMonth');
        const effectiveYear = c.req.query('effectiveYear');
        const employeeId = c.req.query('employeeId');

        if (!effectiveMonth || !effectiveYear || !employeeId) {
            return c.json({
                status: 400,
                message: "effectiveMonth, effectiveYear, and employeeId are required"
            }, 400);
        }

        const data = await getExistingFilesService(effectiveMonth, effectiveYear, employeeId);
        
        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getExistingFiles controller:', error);
        return c.json({
            status: 500,
            message: "Internal server error",
            error: error.message
        }, 500);
    }
};

export const getDraftTransactions = async (c: Context) => {
    try {
        const employeeId = c.req.query('employeeId');
        const effectiveMonth = c.req.query('effectiveMonth'); // Thai month name, e.g. 'มีนาคม'
        const effectiveYear = c.req.query('effectiveYear');   // Buddhist year, e.g. '2568'

        if (!employeeId) {
            return c.json({
                status: 400,
                message: "employeeId is required"
            }, 400);
        }

        // Compute first day of the effective month
        const monthNames = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
        const monthIndex = effectiveMonth ? monthNames.indexOf(effectiveMonth) + 1 : new Date().getMonth() + 1;
        const yearAD = effectiveYear ? parseInt(effectiveYear) - 543 : new Date().getFullYear();
        const effectiveDate = new Date(`${yearAD}-${monthIndex.toString().padStart(2, '0')}-01T00:00:00Z`);

        const data = await getDraftTransactionsService(employeeId, effectiveDate);
        
        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getDraftTransactions controller:', error);
        return c.json({
            status: 500,
            message: "Internal server error",
            error: error.message
        }, 500);
    }
};

export const deleteDraftTransaction = async (c: Context) => {
    try {
        const id = c.req.param('id')?.trim();
        const employeeId = c.req.query('employeeId')?.trim() || 'SYSTEM';
        console.log(`[DELETE /draft/:id] Requested delete for TransactionNo: '${id}', by: '${employeeId}'`);

        if (!id) {
            return c.json({ status: 400, message: "Transaction ID is required" }, 400);
        }

        await deleteDraftTransactionService(id, employeeId);
        console.log(`[DELETE /draft/:id] Successfully executed SP for TransactionNo: '${id}'`);

        return c.json({
            status: 200,
            message: "Transaction deleted successfully"
        });
    } catch (error: any) {
        console.error('Error in deleteDraftTransaction controller:', error);
        return c.json({
            status: 500,
            message: "Internal server error",
            error: error.message
        }, 500);
    }
};

export const getApproversFlow = async (c: Context) => {
    try {
        const jobType = parseInt(c.req.query('jobType') || '1', 10);
        const userGroupReceive = c.req.query('userGroupReceive') || '';
        const orgUnitNoReceive = c.req.query('orgUnitNoReceive') || '';
        const levelGroupNoFrom = c.req.query('levelGroupNoFrom') || '';
        const orgUnitNoTransfer = c.req.query('orgUnitNoTransfer') || null;
        const levelGroupNoTo = c.req.query('levelGroupNoTo') || '';
        const effectiveDate = c.req.query('effectiveDate') || new Date().toISOString().split('T')[0];
        const isRequirePolicy = parseInt(c.req.query('isRequirePolicy') || '0', 10);

        const data = await getApproversFlowService({
            jobType,
            userGroupReceive,
            orgUnitNoReceive,
            levelGroupNoFrom,
            orgUnitNoTransfer,
            levelGroupNoTo,
            effectiveDate,
            isRequirePolicy,
        });

        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getApproversFlow controller:', error);
        return c.json({
            status: 500,
            message: "Internal server error",
            error: error.message
        }, 500);
    }
};

export const directApproveTransactions = async (c: Context) => {
    try {
        const body = await c.req.json();
        const { transactionNos, updateBy } = body;

        if (!transactionNos || !Array.isArray(transactionNos) || transactionNos.length === 0) {
             return c.json({ status: 400, message: "Transaction numbers are required" }, 400);
        }
        if (!updateBy) {
            return c.json({ status: 400, message: "updateBy is required" }, 400);
        }

        const result = await directApproveTransactionsService(transactionNos, updateBy);
        
        return c.json({
            status: 200,
            message: result.message
        });
    } catch (error: any) {
        console.error('Error in directApproveTransactions controller:', error);
        return c.json({
            status: 500,
            message: "Internal server error",
            error: error.message
        }, 500);
    }
};

export const getBorrowTransactions = async (c: Context) => {
    try {
        const employeeId = c.req.query('employeeId') || undefined;

        const data = await getBorrowTransactionsService(employeeId);
        
        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getBorrowTransactions controller:', error);
        return c.json({
            status: 500,
            message: "Internal server error",
            error: error.message
        }, 500);
    }
};

export const getReturnsByBorrow = async (c: Context) => {
    try {
        const documentNo = c.req.param('documentNo')?.trim();

        if (!documentNo) {
            return c.json({ status: 400, message: "documentNo is required" }, 400);
        }

        const data = await getReturnsByBorrowService(documentNo);
        
        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getReturnsByBorrow controller:', error);
        return c.json({
            status: 500,
            message: "Internal server error",
            error: error.message
        }, 500);
    }
};

export const getHRCenterData = async (c: Context) => {
    try {
        const viewMode = c.req.query('viewMode') as 'all' | 'department';
        const effectiveMonth = c.req.query('effectiveMonth');
        const effectiveYear = c.req.query('effectiveYear');
        const employeeId = c.req.query('employeeId') || '';
        const userGroupNo = c.req.query('userGroupNo') || '';

        if (!effectiveMonth || !effectiveYear || !employeeId || !userGroupNo) {
             return c.json({ status: 400, message: "Missing required parameters" }, 400);
        }

        // Convert month/year string to date
        const monthNames = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
        const monthIndex = monthNames.indexOf(effectiveMonth) + 1;
        const yearAD = parseInt(effectiveYear) - 543;
        const effectiveDate = new Date(`${yearAD}-${monthIndex.toString().padStart(2, '0')}-01T00:00:00Z`);

        const data = await getHRCenterDataService(
            viewMode === 'department' ? 'department' : 'all',
            effectiveDate,
            employeeId,
            userGroupNo
        );

        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getHRCenterData controller:', error);
        return c.json({
            status: 500,
            message: "Internal server error",
            error: error.message
        }, 500);
    }
};
