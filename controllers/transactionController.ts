import { Context } from 'hono';
import {
    saveDraftTransactionService,
    getExistingFilesService,
    getDraftTransactionsService,
    deleteDraftTransactionService,
    getApproversFlowService,
    directApproveTransactionsService,
    createApprovedStructureRemarkTransactionsService,
    getBorrowTransactionsService,
    getReturnsByBorrowService,
    getHRCenterDataService,
    getMonitorHistoryService,
    getTransactionActionLogService,
    getTransactionLogYearService,
    getTransactionLogYearDetailService,
    getSapMonitorGridService,
    getSapMonitorLogService,
    DraftTransactionPayload
} from '../services/transactionService.js';
import {
    sendHRCenterToSapService,
    getHRCenterSapMinusService,
    getHRCenterSapOutboundFileBufferService,
    getHRCenterSapOutboundFileMetaService
} from '../services/hrcenterSapService.js';
import { validateTransactionCreationWindowService } from '../services/calendarService.js';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const THAI_MONTH_NAMES = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

const parseEffectiveDateForStructureDebug = (
    monthRaw: unknown,
    yearRaw: unknown,
    effectiveDateRaw: unknown
): Date => {
    let month: number | null = null;
    let year: number | null = null;

    const monthParsed = Number.parseInt(String(monthRaw ?? ''), 10);
    if (Number.isInteger(monthParsed) && monthParsed >= 1 && monthParsed <= 12) {
        month = monthParsed;
    }

    const yearParsed = Number.parseInt(String(yearRaw ?? ''), 10);
    if (Number.isInteger(yearParsed)) {
        year = yearParsed > 2400 ? yearParsed - 543 : yearParsed;
    }

    if ((!month || !year) && typeof effectiveDateRaw === 'string' && effectiveDateRaw.trim()) {
        const parsed = new Date(effectiveDateRaw);
        if (!Number.isNaN(parsed.getTime())) {
            month = parsed.getMonth() + 1;
            year = parsed.getFullYear();
        }
    }

    if (!month || !year) {
        const today = new Date();
        month = today.getMonth() + 1;
        year = today.getFullYear();
    }

    return new Date(year, month - 1, 1, 0, 0, 0, 0);
};

const parseEffectiveMonthYear = (
    effectiveMonthRaw: unknown,
    effectiveYearRaw: unknown
): { month: number | null; year: number | null } => {
    const monthName = String(effectiveMonthRaw ?? '').trim();
    const month = THAI_MONTH_NAMES.indexOf(monthName) + 1;

    const yearParsed = Number.parseInt(String(effectiveYearRaw ?? '').trim(), 10);
    const year = Number.isInteger(yearParsed) ? yearParsed : null;

    return {
        month: month > 0 ? month : null,
        year
    };
};

const toEffectiveDateFromThaiMonthYear = (
    effectiveMonthRaw: unknown,
    effectiveYearRaw: unknown
): Date | null => {
    const { month, year } = parseEffectiveMonthYear(effectiveMonthRaw, effectiveYearRaw);
    if (!month || !year) return null;
    const adYear = year > 2400 ? year - 543 : year;
    const effectiveDate = new Date(adYear, month - 1, 1, 0, 0, 0, 0);
    if (Number.isNaN(effectiveDate.getTime())) return null;
    return effectiveDate;
};

export const saveDraftTransaction = async (c: Context) => {
    try {
        const contentType = c.req.header('content-type') || '';
        let body: Record<string, any> | null = null;
        let fileEntry: File | null = null;

        if (contentType.includes('multipart/form-data')) {
            const formData = await c.req.formData();
            const payloadRaw = formData.get('payload');
            fileEntry = formData.get('file') as File | null;

            if (typeof payloadRaw !== 'string' || !payloadRaw.trim()) {
                return c.json({ status: 400, message: 'Missing payload field' }, 400);
            }
            body = JSON.parse(payloadRaw);
        } else {
            const raw = await c.req.json().catch(() => null) as any;
            const payloadRaw = raw?.payload;

            if (payloadRaw && typeof payloadRaw === 'object') {
                body = payloadRaw;
            } else if (typeof payloadRaw === 'string' && payloadRaw.trim()) {
                body = JSON.parse(payloadRaw);
            } else if (raw && typeof raw === 'object') {
                body = raw;
            }
        }

        if (!body) {
            return c.json({ status: 400, message: 'Invalid payload' }, 400);
        }

        const parsedEffective = parseEffectiveMonthYear(body.effectiveMonth, body.effectiveYear);
        if (!parsedEffective.month || !parsedEffective.year) {
            return c.json({ status: 400, message: 'Invalid effectiveMonth or effectiveYear' }, 400);
        }

        const calendarWindowCheck = await validateTransactionCreationWindowService(
            parsedEffective.month,
            parsedEffective.year
        );

        if (!calendarWindowCheck.isAllowed) {
            return c.json({
                status: 403,
                message: calendarWindowCheck.message,
                data: {
                    calendarStart: calendarWindowCheck.startDate,
                    calendarEnd: calendarWindowCheck.endDate
                }
            }, 403);
        }

        const createBy = body.employeeId || 'SYSTEM';

        // DB column for FileUpload stores only the file name (no folder prefix).
        const normalizeUploadFileName = (value: unknown): string | undefined => {
            if (typeof value !== 'string') return undefined;
            const trimmed = value.trim();
            if (!trimmed) return undefined;
            const normalized = trimmed.replace(/\\/g, '/');
            return path.basename(normalized);
        };

        const normalizeTransactionNo = (value: unknown): string | undefined => {
            if (typeof value !== 'string') return undefined;
            const trimmed = value.trim();
            if (!trimmed) return undefined;
            return trimmed.substring(0, 10);
        };

        // Process file upload first if present
        let fileUrlToSave = normalizeUploadFileName(body.detailData?.existingFileUrl);
        let fileNameToSave = body.detailData?.existingFileName || null;
        
        if (fileEntry) {
            const uploadsDir = path.join(process.cwd(), 'uploads', 'transactions');
            if (!existsSync(uploadsDir)) {
                await mkdir(uploadsDir, { recursive: true });
            }
            const originalName = fileEntry.name;
            let extension = path.extname(originalName).toLowerCase();
            if (!extension) extension = ".pdf";
            
            const { randomUUID } = await import('crypto');
            const safeName = `${randomUUID()}${extension}`;
            
            const savedFilePath = path.join(uploadsDir, safeName);
            const fileBuffer = Buffer.from(await fileEntry.arrayBuffer());
            await writeFile(savedFilePath, fileBuffer);
            
            fileNameToSave = originalName;
            fileUrlToSave = safeName;
        }

        const payload = {
            transactionType: parseInt(body.transactionType as string),
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

            // File fields
            fileName: fileNameToSave,
            fileUrl: fileUrlToSave,
            refId: body.detailData?.existingFileId, // Using existing TransactionFileID as RefID
            refTransactionNo: normalizeTransactionNo(body.refTransactionNo ?? body.detailData?.refTransactionNo),
        };

        // Save draft and the file record in a single call
        const result = await saveDraftTransactionService(payload, createBy);
        
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
        const monthIndex = effectiveMonth ? THAI_MONTH_NAMES.indexOf(effectiveMonth) + 1 : new Date().getMonth() + 1;
        const yearAD = effectiveYear ? parseInt(effectiveYear) - 543 : new Date().getFullYear();
        const effectiveDate = new Date(yearAD, monthIndex - 1, 1, 0, 0, 0, 0);

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

export const debugGenerateApprovedStructureRemarks = async (c: Context) => {
    try {
        const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
        const tokenUser = ((c.req as any).user || {}) as Record<string, unknown>;

        const effectiveDate = parseEffectiveDateForStructureDebug(
            body.effectiveMonth,
            body.effectiveYear,
            body.effectiveDate
        );
        const createBy = String(body.createBy || tokenUser.id || 'SYSTEM').trim() || 'SYSTEM';

        const result = await createApprovedStructureRemarkTransactionsService({
            effectiveDate,
            createBy
        });

        return c.json({
            status: 200,
            message: 'Structure-change remark transaction generated successfully',
            data: result
        }, 200);
    } catch (error: any) {
        console.error('Error in debugGenerateApprovedStructureRemarks controller:', error);
        return c.json({
            status: 500,
            message: 'Internal server error',
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
        const effectiveDate = new Date(yearAD, monthIndex - 1, 1, 0, 0, 0, 0);

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

export const sendHRCenterToSap = async (c: Context) => {
    try {
        const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
        const effectiveMonth = body.effectiveMonth;
        const effectiveYear = body.effectiveYear;
        const employeeId = String(body.employeeId || '').trim() || 'SYSTEM';

        const effectiveDate = toEffectiveDateFromThaiMonthYear(effectiveMonth, effectiveYear);
        if (!effectiveDate) {
            return c.json({
                status: 400,
                message: 'Invalid effectiveMonth/effectiveYear'
            }, 400);
        }

        const orgUnitsRaw = Array.isArray(body.orgUnits) ? body.orgUnits : [];
        const orgUnits = orgUnitsRaw
            .map((item: unknown) => String(item || '').trim())
            .filter((item: string) => item.length > 0);

        const result = await sendHRCenterToSapService({
            effectiveDate,
            employeeId,
            orgUnits
        });

        return c.json({
            status: 200,
            data: result
        });
    } catch (error: any) {
        console.error('Error in sendHRCenterToSap controller:', error);
        return c.json({
            status: 500,
            message: 'Internal server error',
            error: error.message
        }, 500);
    }
};

export const getHRCenterSapMinus = async (c: Context) => {
    try {
        const effectiveMonth = c.req.query('effectiveMonth');
        const effectiveYear = c.req.query('effectiveYear');
        const effectiveDate = toEffectiveDateFromThaiMonthYear(effectiveMonth, effectiveYear);
        if (!effectiveDate) {
            return c.json({
                status: 400,
                message: 'Invalid effectiveMonth/effectiveYear'
            }, 400);
        }

        const data = await getHRCenterSapMinusService(effectiveDate);
        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getHRCenterSapMinus controller:', error);
        return c.json({
            status: 500,
            message: 'Internal server error',
            error: error.message
        }, 500);
    }
};

export const downloadHRCenterSapFile = async (c: Context) => {
    try {
        const meta = await getHRCenterSapOutboundFileMetaService();
        if (!meta.exists) {
            return c.json({
                status: 404,
                message: 'SAP outbound file not found'
            }, 404);
        }

        const file = await getHRCenterSapOutboundFileBufferService();
        const fileContent = Uint8Array.from(file.content);
        return c.body(fileContent, 200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': `attachment; filename="${file.fileName}"`,
            'Cache-Control': 'no-store'
        });
    } catch (error: any) {
        console.error('Error in downloadHRCenterSapFile controller:', error);
        return c.json({
            status: 500,
            message: 'Internal server error',
            error: error.message
        }, 500);
    }
};

const toDateFromMonthYear = (monthRaw: string, yearRaw: string): Date | null => {
    if (!monthRaw || !yearRaw) return null;

    const month = Number.parseInt(monthRaw, 10);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
        return null;
    }

    let year = Number.parseInt(yearRaw, 10);
    if (!Number.isInteger(year)) {
        return null;
    }

    if (year > 2400) {
        year -= 543;
    }

    const date = new Date(year, month - 1, 1);
    if (
        Number.isNaN(date.getTime()) ||
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== 1
    ) {
        return null;
    }

    date.setHours(0, 0, 0, 0);
    return date;
};

const normalizeEffectiveDateForLog = (effectiveDateRaw: string): string | null => {
    const raw = effectiveDateRaw.trim();
    if (!raw) return null;

    const fromDmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (fromDmy) {
        const day = Number.parseInt(fromDmy[1], 10);
        const month = Number.parseInt(fromDmy[2], 10);
        let year = Number.parseInt(fromDmy[3], 10);
        if (year > 2400) year -= 543;

        const date = new Date(year, month - 1, day);
        if (
            !Number.isNaN(date.getTime()) &&
            date.getFullYear() === year &&
            date.getMonth() === month - 1 &&
            date.getDate() === day
        ) {
            return `${year.toString().padStart(4, '0')}${month.toString().padStart(2, '0')}${day.toString().padStart(2, '0')}`;
        }
    }

    const digitOnly = raw.replace(/\D/g, '');
    if (digitOnly.length === 8) {
        const yearRawNum = Number.parseInt(digitOnly.slice(0, 4), 10);
        const month = Number.parseInt(digitOnly.slice(4, 6), 10);
        const day = Number.parseInt(digitOnly.slice(6, 8), 10);
        const year = yearRawNum > 2400 ? yearRawNum - 543 : yearRawNum;
        const date = new Date(year, month - 1, day);

        if (
            !Number.isNaN(date.getTime()) &&
            date.getFullYear() === year &&
            date.getMonth() === month - 1 &&
            date.getDate() === day
        ) {
            return `${year.toString().padStart(4, '0')}${month.toString().padStart(2, '0')}${day.toString().padStart(2, '0')}`;
        }
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    const year = parsed.getFullYear();
    const month = parsed.getMonth() + 1;
    const day = parsed.getDate();
    return `${year.toString().padStart(4, '0')}${month.toString().padStart(2, '0')}${day.toString().padStart(2, '0')}`;
};

export const getMonitorHistory = async (c: Context) => {
    try {
        const dmonth1 = c.req.query('dmonth1') || '';
        const dyear1 = c.req.query('dyear1') || '';
        const dmonth2 = c.req.query('dmonth2') || '';
        const dyear2 = c.req.query('dyear2') || '';
        const employeeId = c.req.query('EmployeeID') || c.req.query('employeeId') || '';
        const orgUnitNo = c.req.query('OrgUnitNo') || c.req.query('orgUnitNo') || '';
        const userGroupNo = c.req.query('UserGroupNo') || c.req.query('userGroupNo') || '';

        if (!dmonth1 || !dyear1 || !dmonth2 || !dyear2 || !employeeId || !orgUnitNo || !userGroupNo) {
            return c.json({ status: 400, message: 'Missing required query parameters' }, 400);
        }

        const fromDate = toDateFromMonthYear(dmonth1, dyear1);
        const toDate = toDateFromMonthYear(dmonth2, dyear2);
        if (!fromDate || !toDate) {
            return c.json({ status: 400, message: 'Invalid month/year format' }, 400);
        }

        if (fromDate > toDate) {
            return c.json({ status: 400, message: 'From date must be less than or equal to To date' }, 400);
        }

        const data = await getMonitorHistoryService({
            fromDate,
            toDate,
            employeeId,
            orgUnitNo,
            userGroupNo
        });

        return c.json({ status: 200, data }, 200);
    } catch (error: any) {
        console.error('Error in getMonitorHistory controller:', error);
        return c.json({
            status: 500,
            message: 'Internal server error',
            error: error.message
        }, 500);
    }
};

export const getTransactionActionLog = async (c: Context) => {
    try {
        const refNo = c.req.query('refNo') || c.req.query('RefNo') || '';
        if (!refNo) {
            return c.json({ status: 400, message: 'Missing refNo parameter' }, 400);
        }

        const data = await getTransactionActionLogService(refNo);
        return c.json({ status: 200, data }, 200);
    } catch (error: any) {
        console.error('Error in getTransactionActionLog controller:', error);
        return c.json({
            status: 500,
            message: 'Internal server error',
            error: error.message
        }, 500);
    }
};

export const getTransactionLogYear = async (c: Context) => {
    try {
        const orgUnitNo = c.req.query('OrgUnitNo') || c.req.query('orgUnitNo') || '';
        const yearRaw = c.req.query('dyear') || c.req.query('year') || '';

        const year = Number.parseInt(yearRaw, 10);
        if (!orgUnitNo || !Number.isInteger(year) || year < 1900 || year > 3000) {
            return c.json({ status: 400, message: 'Missing or invalid OrgUnitNo/dyear parameter' }, 400);
        }

        const data = await getTransactionLogYearService(orgUnitNo, year);
        return c.json({ status: 200, data }, 200);
    } catch (error: any) {
        console.error('Error in getTransactionLogYear controller:', error);
        return c.json({
            status: 500,
            message: 'Internal server error',
            error: error.message
        }, 500);
    }
};

export const getTransactionLogYearDetail = async (c: Context) => {
    try {
        const orgUnitNo = c.req.query('OrgUnitNo') || c.req.query('orgUnitNo') || '';
        const yearRaw = c.req.query('dyear') || c.req.query('year') || '';
        const monthRaw = c.req.query('dmonth') || c.req.query('month') || '';

        const year = Number.parseInt(yearRaw, 10);
        const month = Number.parseInt(monthRaw, 10);

        if (
            !orgUnitNo ||
            !Number.isInteger(year) ||
            year < 1900 ||
            year > 3000 ||
            !Number.isInteger(month) ||
            month < 1 ||
            month > 12
        ) {
            return c.json({ status: 400, message: 'Missing or invalid OrgUnitNo/dyear/dmonth parameter' }, 400);
        }

        const data = await getTransactionLogYearDetailService(orgUnitNo, year, month);
        return c.json({ status: 200, data }, 200);
    } catch (error: any) {
        console.error('Error in getTransactionLogYearDetail controller:', error);
        return c.json({
            status: 500,
            message: 'Internal server error',
            error: error.message
        }, 500);
    }
};

export const getSapMonitorGrid = async (c: Context) => {
    try {
        const monthRaw = c.req.query('dmonth') || c.req.query('month') || '';
        const yearRaw = c.req.query('dyear') || c.req.query('year') || '';

        const effectiveDate = toDateFromMonthYear(monthRaw, yearRaw);
        if (!effectiveDate) {
            return c.json({ status: 400, message: 'Missing or invalid dmonth/dyear parameter' }, 400);
        }

        const data = await getSapMonitorGridService(effectiveDate);
        return c.json({ status: 200, data }, 200);
    } catch (error: any) {
        console.error('Error in getSapMonitorGrid controller:', error);
        return c.json({
            status: 500,
            message: 'Internal server error',
            error: error.message
        }, 500);
    }
};

export const getSapMonitorLog = async (c: Context) => {
    try {
        const effectiveDateRaw = c.req.query('EffectiveDate') || c.req.query('effectiveDate') || '';
        const effectiveDate = normalizeEffectiveDateForLog(effectiveDateRaw);

        if (!effectiveDate) {
            return c.json({ status: 400, message: 'Missing or invalid EffectiveDate parameter' }, 400);
        }

        const data = await getSapMonitorLogService(effectiveDate);
        return c.json({ status: 200, data }, 200);
    } catch (error: any) {
        console.error('Error in getSapMonitorLog controller:', error);
        return c.json({
            status: 500,
            message: 'Internal server error',
            error: error.message
        }, 500);
    }
};
