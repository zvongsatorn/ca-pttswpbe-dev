import { sql, poolPromise } from '../config/db.js';
import pisService from './pisService.js';
import { sendMail, resolveMailRecipient } from './mailService.js';
import { createMailLog } from './mailLogService.js';

interface CreateMainKeyParams {
    manDriverId: string | number;
    keyManId: string | number | null;
    unit: string;
    keyType: string;
    weight: number;
    createBy: string;
    insertType: string;
    effectiveYear: string;
    parentId: string | number | null;
}

interface CreateDetailKeyParams {
    manDriverId: string | number;
    parentId: string | number;
    definition: string;
    coefficient: number;
    remark: string;
    createBy: string;
    effectiveYear: string | number;
    yearlyData: { id: number, year: string, amount: number }[];
}

const buildMkdMailRefNo = (manDriverId: string | number): string => {
    return `MKD${String(manDriverId || '')}`.slice(0, 20);
};

const normalizeMkdText = (text: string): string => {
    return text.replace(/Mandriver Power/gi, 'Manpower Key Driver');
};

const formatMkdRepCode = (employeeId: string | number | null | undefined): string => {
    const value = String(employeeId || '').trim();
    return /^\d+$/.test(value) ? value.replace(/^0+/, '').padStart(8, '0') : value;
};

const sendMailWithLog = async (params: {
    recipient: string | null;
    requestedRecipient?: string | null;
    subject: string;
    body: string;
    sendFromBy: string;
    sendToBy?: string | null;
    refNo?: string | null;
    context: string;
}) => {
    const now = new Date();
    const requestedRecipient = (params.requestedRecipient || '').trim();
    const finalRecipient = (params.recipient || '').trim();
    const logRecipient = finalRecipient || requestedRecipient;
    const canSend = finalRecipient !== '';
    const result = canSend
        ? await sendMail(finalRecipient, params.subject, params.body)
        : { success: false, error: 'Skip sending because resolved recipient is empty' };
    const remark = canSend ? null : 'SKIP';

    try {
        await createMailLog({
            sendFromBy: params.sendFromBy || 'SYSTEM',
            sendFromDate: now,
            sendToBy: params.sendToBy || null,
            emailTo: logRecipient,
            mailSubject: params.subject,
            mailBody: params.body,
            effectiveDate: now,
            isCC: 0,
            isSend: canSend && result.success ? 1 : 0,
            remark,
            ccRecipients: [],
            refNo: params.refNo || null,
            createBy: params.sendFromBy || 'SYSTEM',
            createDate: now
        });
    } catch (logError) {
        console.error(`[${params.context}] Failed to insert MP_MailTo log:`, logError);
    }

    return result;
};

export const getStartYearService = async () => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        request.input('KeyName', sql.VarChar, 'StartYearManDriver');

        const result = await request.execute('MP_ConfigGetByKeyName');
        
        if (result && result.recordset && result.recordset.length > 0) {
            return result.recordset[0].Value1;
        }
        
        return null;
    } catch (error) {
        console.error('Error executing MP_ConfigGetByKeyName:', error);
        throw error;
    }
};

const parseMkdApproveId = (approveIdStr?: string): number | null => {
    const hasApproveIdInput = approveIdStr !== undefined && approveIdStr !== null && String(approveIdStr).trim() !== '';
    const parsedApproveId = hasApproveIdInput ? Number(approveIdStr) : null;
    return parsedApproveId && Number.isFinite(parsedApproveId) && parsedApproveId > 0 ? parsedApproveId : null;
};

export const getMasterKeysService = async () => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().execute('mp_MasterKeymanGet');
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing mp_MasterKeymanGet:', error);
        throw error;
    }
};

export const getHistoryManDriverService = async (
    effectiveMonth: string | null | undefined,
    effectiveYear: string,
    requestType: number,
    employeeId: string,
    orgUnitNo: string,
    userGroupNo: string,
    division: string
) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        let formattedDate: string | null = null;
        if (effectiveMonth) {
            const effMonthStr = effectiveMonth.length === 1 ? `0${effectiveMonth}` : effectiveMonth;
            formattedDate = `${effectiveYear}-${effMonthStr}-01`;
        }

        request.input('EffectiveDate', sql.DateTime, formattedDate ? new Date(formattedDate) : null);
        request.input('EffectiveYear', sql.VarChar(50), effectiveYear);
        request.input('RequestType', sql.Int, requestType);
        request.input('EmployeeID', sql.VarChar(50), employeeId);
        request.input('OrgUnitNo', sql.VarChar(50), orgUnitNo || null); // Ensure null if empty
        request.input('UserGroupNo', sql.VarChar(50), userGroupNo);
        request.input('division', sql.VarChar(50), division || null);

        const result = await request.execute('mp_HistoryManDriverGet');
        
        if (result && result.recordset) {
            console.log(`MKD History Fetch Result: ${result.recordset.length} records found`);
            if (result.recordset.length > 0) {
                console.log('Sample MKD Record keys:', Object.keys(result.recordset[0]));
                console.log('Sample MKD Record values:', {
                    RequestNo: result.recordset[0].RequestNo,
                    fullRequestNo: result.recordset[0].fullRequestNo,
                    RequestDate: result.recordset[0].RequestDate,
                    datebd: result.recordset[0].datebd,
                    StatusName: result.recordset[0].StatusName,
                    AppStatusName: result.recordset[0].AppStatusName,
                });
            }
            return result.recordset;
        }
        
        return [];
    } catch (error) {
        console.error('Error executing mp_HistoryManDriverGet:', error);
        throw error;
    }
};

export const checkDupManDriverService = async (
    effectiveYear: string,
    requestType: number,
    orgUnitNo: string,
    orgUnitName: string
) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        request.input('EffectiveYear', sql.VarChar(50), effectiveYear);
        request.input('RequestType', sql.Int, requestType);
        request.input('OrgUnitNo', sql.VarChar(50), orgUnitNo);
        request.input('OrgUnitName', sql.VarChar(255), orgUnitName);

        const result = await request.execute('mp_ManDriverCheckDup');
        
        if (result && result.recordset && result.recordset.length > 0) {
            return parseInt(result.recordset[0].result) > 0;
        }
        
        return false;
    } catch (error) {
        console.error('Error executing mp_ManDriverCheckDup:', error);
        throw error;
    }
};

export const insertManDriverService = async (
    effectiveYear: string,
    requestType: number,
    orgUnitNo: string,
    orgUnitName: string,
    createBy: string
) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        console.log('MKD Inserting New ManDriver:', {
            EffectiveYear: effectiveYear,
            RequestType: requestType,
            OrgUnitNo: orgUnitNo,
            OrgUnitName: orgUnitName,
            CreateBy: createBy
        });

        request.input('EffectiveYear', sql.VarChar(50), effectiveYear);
        request.input('RequestType', sql.Int, requestType);
        request.input('OrgUnitNo', sql.VarChar(50), orgUnitNo);
        request.input('OrgUnitName', sql.VarChar(255), orgUnitName);
        request.input('CreateBy', sql.VarChar(50), createBy);
        request.input('CreateDate', sql.DateTime, new Date());

        const result = await request.execute('mp_ManDriverInsertNew');
        
        console.log('MKD Insert Result:', result.recordset);
        
        if (result && result.recordset && result.recordset.length > 0) {
            return result.recordset[0];
        }
        
        return null;
    } catch (error) {
        console.error('Error executing mp_ManDriverInsertNew:', error);
        throw error;
    }
};

export const getMKDDetailsService = async (manDriverId: string | number) => {
    try {
        const pool = await poolPromise;
        
        const getHeader = async () => {
            const req = new sql.Request(pool);
            req.input('ManDriverID', sql.Decimal, manDriverId);
            const res = await req.execute('mp_ManDriverGet');
            return res.recordset && res.recordset.length > 0 ? res.recordset[0] : null;
        };

        const getKeys = async () => {
            const req = new sql.Request(pool);
            req.input('ManDriverID', sql.Decimal, manDriverId);
            const res = await req.execute('mp_ManDriverKeyGet');
            return res.recordset || [];
        };

        const getYears = async () => {
            const req = new sql.Request(pool);
            req.input('ManDriverID', sql.Decimal, manDriverId);
            const res = await req.execute('mp_ManDriverKeyYearGet');
            return res.recordset || [];
        };

        const getFiles = async () => {
            const req = new sql.Request(pool);
            req.input('ManDriverID', sql.Decimal, manDriverId);
            const res = await req.execute('mp_ManDriverFileListGet');
            return res.recordset || [];
        };

        const getSummary = async () => {
            const req = new sql.Request(pool);
            req.input('ManDriverID', sql.Decimal, manDriverId);
            const res = await req.execute('mp_ManDriverKeySummaryGet');
            return res.recordset || [];
        };

        const [header, keys, years, files, summary] = await Promise.all([getHeader(), getKeys(), getYears(), getFiles(), getSummary()]);

        console.log(`MKD Details for ID ${manDriverId}:`, {
            hasHeader: !!header,
            keyCount: keys.length,
            yearCount: years.length,
            fileCount: files.length
        });

        return { header, keys, years, files, summary };
    } catch (error) {
        console.error('Error executing getting MKD Details:', error);
        throw error;
    }
};

export const createMainKeyService = async ({
    manDriverId,
    keyManId,
    unit,
    keyType,
    weight,
    createBy,
    insertType,
    effectiveYear,
    parentId
}: CreateMainKeyParams) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        console.log('--- CALLING mp_ManDriverKeyInsert ---', { manDriverId, keyManId, unit, keyType, weight, createBy, insertType, effectiveYear, parentId });
        request.input('ManDriverID', sql.Decimal, manDriverId);
        request.input('KeyManID', sql.Decimal, keyManId || null);
        request.input('Unit', sql.VarChar(50), unit);
        request.input('KeyType', sql.Int, (keyType === 'index' || Number(keyType) === 1) ? 1 : 2);
        request.input('Weight', sql.Decimal(18, 2), weight);
        request.input('CreateBy', sql.VarChar(50), createBy);
        request.input('CreateDate', sql.DateTime, new Date());
        request.input('InsertType', sql.Int, insertType || 1);
        request.input('EffectiveYear', sql.Int, effectiveYear || 0);
        request.input('ParentID', sql.Decimal, parentId || null);

        const result = await request.execute('mp_ManDriverKeyInsert');
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing mp_ManDriverKeyInsert:', error);
        throw error;
    }
};

export const updateMainKeyService = async (
    manDriverKeyId: string | number,
    unit: string,
    keyType: string,
    weight: number,
    updateBy: string
) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        request.input('ManDriverKeyID', sql.Decimal, manDriverKeyId);
        request.input('Unit', sql.VarChar(50), unit);
        request.input('KeyType', sql.Int, (keyType === 'index' || Number(keyType) === 1) ? 1 : 2);
        request.input('Weight', sql.Decimal(18, 2), weight);
        request.input('UpdateBy', sql.VarChar(50), updateBy);
        request.input('UpdateDate', sql.DateTime, new Date());

        const result = await request.execute('mp_ManDriverKeyMainUpdate');
        return result.rowsAffected;
    } catch (error) {
        console.error('Error executing mp_ManDriverKeyMainUpdate:', error);
        throw error;
    }
};

const getDetailKeyParentData = async (transaction: sql.Transaction, parentId: string | number) => {
    const parentReq = new sql.Request(transaction);
    parentReq.input('ParentID', sql.Decimal, parentId);
    const parentRes = await parentReq.execute('mp_ManDriverKeyParentGet');
    return parentRes.recordset?.[0] || {};
};

const insertDetailKeyFromParent = async (
    transaction: sql.Transaction,
    params: CreateDetailKeyParams,
    parentData: any
) => {
    const request = new sql.Request(transaction);
    request.input('ManDriverID', sql.Decimal, params.manDriverId);
    request.input('KeyManID', sql.Decimal, parentData.KeyManID || null);
    request.input('Unit', sql.VarChar(50), parentData.Unit || '');
    request.input('KeyType', sql.Int, parentData.KeyType || 1);
    request.input('Weight', sql.Decimal(18, 2), parentData.Weight || 0);
    request.input('CreateBy', sql.VarChar(50), params.createBy);
    request.input('CreateDate', sql.DateTime, new Date());
    request.input('InsertType', sql.Int, 2);
    request.input('EffectiveYear', sql.Int, Number(params.effectiveYear) || 0);
    request.input('ParentID', sql.Decimal, Number(params.parentId));
    await request.execute('mp_ManDriverKeyInsert');
};

const findNewDetailKeyId = async (
    transaction: sql.Transaction,
    manDriverId: string | number,
    parentId: string | number
) => {
    const findReq = new sql.Request(transaction);
    findReq.input('ManDriverID', sql.Decimal, Number(manDriverId));
    findReq.input('ParentID', sql.Decimal, Number(parentId));
    const findRes = await findReq.execute('mp_ManDriverKeyFindNew');
    const newKeyId = findRes.recordset?.[0]?.ManDriverKeyID;

    if (!newKeyId) {
        throw new Error('Insertion failed: Could not find newly created key');
    }

    return newKeyId;
};

const updateDetailKeyMetadata = async (
    transaction: sql.Transaction,
    newKeyId: string | number,
    params: CreateDetailKeyParams
) => {
    const request = new sql.Request(transaction);
    request.input('ManDriverKeyID', sql.Decimal, newKeyId);
    request.input('Definition', sql.VarChar(255), params.definition || '');
    request.input('Coefficient', sql.Decimal(18, 2), params.coefficient || 0);
    request.input('Remark', sql.VarChar(255), params.remark || '');
    request.input('UpdateBy', sql.VarChar(50), params.createBy);
    request.input('UpdateDate', sql.DateTime, new Date());
    await request.execute('mp_ManDriverKeyUpdate');
};

const buildNewDetailKeyYearlyTable = (yearlyData: CreateDetailKeyParams['yearlyData']) => {
    const tvp = new sql.Table('mp_ParaList');
    tvp.columns.add('id', sql.Decimal(18, 0));
    tvp.columns.add('year', sql.VarChar(50));
    tvp.columns.add('amount', sql.Decimal(18, 2));

    for (const item of yearlyData) {
        tvp.rows.add(0, item.year, item.amount || 0);
    }

    return tvp;
};

const updateNewDetailKeyYearlyData = async (
    transaction: sql.Transaction,
    manDriverId: string | number,
    newKeyId: string | number,
    yearlyData: CreateDetailKeyParams['yearlyData']
) => {
    if (!yearlyData || yearlyData.length === 0) return;

    const request = new sql.Request(transaction);
    request.input('DataTable', buildNewDetailKeyYearlyTable(yearlyData));
    request.input('ManDriverKeyID', sql.Decimal, newKeyId);
    request.input('ManDriverID', sql.Decimal, manDriverId);
    await request.execute('mp_ManDriverKeyYearDTUpdate');
};

const rollbackCreateDetailKeyTransaction = async (transaction: sql.Transaction) => {
    try {
        await transaction.rollback();
    } catch (rollbackError: any) {
        if (rollbackError && rollbackError.name !== 'TransactionError') {
            console.error('Error during rollback:', rollbackError);
        }
    }
};

export const createDetailKeyService = async (params: CreateDetailKeyParams) => {
    try {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const parentData = await getDetailKeyParentData(transaction, params.parentId);
            await insertDetailKeyFromParent(transaction, params, parentData);
            const newKeyId = await findNewDetailKeyId(transaction, params.manDriverId, params.parentId);
            await updateDetailKeyMetadata(transaction, newKeyId, params);
            await updateNewDetailKeyYearlyData(transaction, params.manDriverId, newKeyId, params.yearlyData);

            await transaction.commit();
            return { success: true, newKeyId };
        } catch (error) {
            console.error('[CRITICAL ERROR] createDetailKeyService logic failed:', error);
            await rollbackCreateDetailKeyTransaction(transaction);
            throw error;
        }
    } catch (error) {
        console.error('Error executing createDetailKeyService:', error);
        throw error;
    }
};

export const updateDetailKeyService = async (
    manDriverId: string | number,
    manDriverKeyId: string | number,
    definition: string,
    coefficient: number,
    remark: string,
    updateBy: string,
    yearlyData: { id: number, year: string, amount: number }[]
) => {
    try {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Update Key Info
            const request1 = new sql.Request(transaction);
            request1.input('ManDriverKeyID', sql.Decimal, manDriverKeyId);
            request1.input('Definition', sql.VarChar(255), definition || '');
            request1.input('Coefficient', sql.Decimal(18, 2), coefficient || 0);
            request1.input('Remark', sql.VarChar(255), remark || '');
            request1.input('UpdateBy', sql.VarChar(50), updateBy);
            request1.input('UpdateDate', sql.DateTime, new Date());
            await request1.execute('mp_ManDriverKeyUpdate');

            // 2. Update Yearly Amounts
            if (yearlyData && yearlyData.length > 0) {
                const tvp = new sql.Table('mp_ParaList');
                tvp.columns.add('id', sql.Decimal(18, 0)); // Assuming ManDriverKeyYearID is decimal
                tvp.columns.add('year', sql.VarChar(50));
                tvp.columns.add('amount', sql.Decimal(18, 2));

                for (const item of yearlyData) {
                    tvp.rows.add(item.id, item.year, item.amount);
                }

                const request2 = new sql.Request(transaction);
                request2.input('DataTable', tvp);
                request2.input('ManDriverKeyID', sql.Decimal, manDriverKeyId);
                request2.input('ManDriverID', sql.Decimal, manDriverId);
                await request2.execute('mp_ManDriverKeyYearDTUpdate');
            }

            await transaction.commit();
            return { success: true };
        } catch (innerError) {
            await transaction.rollback();
            throw innerError;
        }
    } catch (error) {
        console.error('Error executing updateDetailKeyService:', error);
        throw error;
    }
};

export const deleteKeyService = async (manDriverKeyId: string | number, user: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('ManDriverKeyID', sql.Decimal, manDriverKeyId);
        request.input('UpdateBy', sql.VarChar(50), user);
        request.input('UpdateDate', sql.DateTime, new Date());
        
        await request.execute('mp_ManDriverKeyDelete');
        return { success: true };
    } catch (error) {
        console.error('Error executing deleteKeyService:', error);
        throw error;
    }
};

export const uploadFileService = async (
    manDriverId: string | number, 
    fileName: string, 
    fileUpload: string, 
    createBy: string
) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('ManDriverID', sql.Decimal, manDriverId);
        request.input('FileName', sql.VarChar(255), fileName);
        request.input('FileUpload', sql.VarChar(255), fileUpload);
        request.input('CreateBy', sql.VarChar(50), createBy);
        request.input('CreateDate', sql.DateTime, new Date());
        
        await request.execute('mp_ManDriverFileInsert');
        return { success: true };
    } catch (error) {
        console.error('Error executing uploadFileService:', error);
        throw error;
    }
};

export const deleteFileService = async (manDriverFileId: string | number) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('ManDriverFileID', sql.Decimal, manDriverFileId);
        
        await request.execute('mp_ManDriverFileDelete');
        return { success: true };
    } catch (error) {
        console.error('Error executing deleteFileService:', error);
        throw error;
    }
};

export const updateManDriverStatusService = async (manDriverId: string | number, status: number, user: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('ManDriverID', sql.Decimal, manDriverId);
        request.input('ManDriverStatus', sql.Int, status);
        request.input('UpdateBy', sql.VarChar(50), user);
        request.input('UpdateDate', sql.DateTime, new Date());
        
        await request.execute('mp_ManDriverStatusUpdate');
        return { success: true };
    } catch (error) {
        console.error('Error executing updateManDriverStatusService:', error);
        throw error;
    }
};

export const getHeadCountService = async (manDriverId: string | number, effectiveYear: number) => {
    try {
        const pool = await poolPromise;
        const req1 = new sql.Request(pool);
        req1.input('ManDriverID', sql.Decimal, manDriverId);
        const res1 = await req1.execute('mp_ManDriverRecordGet');

        const req2 = new sql.Request(pool);
        req2.input('ManDriverID', sql.Decimal, manDriverId);
        req2.input('EffectiveYear', sql.Int, effectiveYear || 0);
        const res2 = await req2.execute('mp_GetYearForHeadCount');
        
        console.log(`[DEBUG] HeadCount for ${manDriverId}:`, {
            headCounts: res1.recordset?.map(r => ({ type: r.HeadCountType, name: r.HeadCountTypeName, year: r.KeyYear, id: r.ManDriverHeadCountID })),
            years: res2.recordset?.map(r => ({ type: r.HeadCountType, name: r.HeadCountTypeName, year: r.KeyYear, id: r.ManDriverHeadCountID }))
        });

        const mapTypeName = (hcType: number) => {
            if (hcType === 1) return 'Permanent';
            if (hcType === 2) return 'UnitHead';
            return 'Outsource';
        };

        return {
            headCounts: (res1.recordset || []).map((r: any) => ({
                ...r,
                HeadCountTypeName: mapTypeName(Number(r.HeadCountType))
            })),
            years: (res2.recordset || []).map((r: any) => ({
                ...r,
                HeadCountTypeName: mapTypeName(Number(r.HeadCountType))
            }))
        };
    } catch (error) {
        console.error('Error executing getHeadCountService:', error);
        throw error;
    }
};

export const updateHeadCountService = async (manDriverId: string | number, data: { id: number, year: string, amount: number }[]) => {
    try {
        const pool = await poolPromise;
        const tvp = new sql.Table('mp_ParaList');
        tvp.columns.add('id', sql.Decimal(18, 0));
        tvp.columns.add('year', sql.VarChar(50));
        tvp.columns.add('amount', sql.Decimal(18, 2));

        for (const item of data) {
            tvp.rows.add(item.id, item.year, item.amount);
        }

        const request = new sql.Request(pool);
        request.input('DataTable', tvp);
        request.input('ManDriverID', sql.Decimal, manDriverId);
        await request.execute('mp_ManDriverHeadCountDTUpdate');
        return { success: true };
    } catch (error) {
        console.error('Error executing updateHeadCountService:', error);
        throw error;
    }
};

export const updateUnitNameService = async (manDriverId: string | number, orgUnitName: string, updateBy: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('ManDriverID', sql.Decimal, manDriverId);
        request.input('OrgUnitName', sql.VarChar(255), orgUnitName);
        request.input('UpdateBy', sql.VarChar(50), updateBy);
        request.input('UpdateDate', sql.DateTime, new Date());
        await request.execute('mp_ManDriverUnitnameUpdate');
        return { success: true };
    } catch (error) {
        console.error('Error executing updateUnitNameService:', error);
        throw error;
    }
};

export const updateNoteService = async (manDriverId: string | number, note: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('ManDriverID', sql.Decimal, manDriverId);
        request.input('Note', sql.NVarChar(sql.MAX), note || '');
        
        await request.execute('mp_ManDriverNoteUpdate');
        return { success: true };
    } catch (error) {
        console.error('Error executing updateNoteService:', error);
        throw error;
    }
};

export const getMKDDashboardService = async (manDriverId: string | number) => {
    try {
        const pool = await poolPromise;
        const req1 = new sql.Request(pool);
        req1.input('ManDriverID', sql.Decimal, manDriverId);
        const res1 = await req1.execute('mp_ManDriverChartGet');

        const req2 = new sql.Request(pool);
        req2.input('ManDriverID', sql.Decimal, manDriverId);
        const res2 = await req2.execute('mp_ManDriverChartDetailGet');

        const req3 = new sql.Request(pool);
        req3.input('ManDriverID', sql.Decimal, manDriverId);
        const res3 = await req3.execute('mp_ManDriverChartDetailCalGet');

        return {
            chart: res1.recordset || [],
            chartDetail: res2.recordset || [],
            chartDetailCal: res3.recordset || []
        };
    } catch (error) {
        console.error('Error executing getMKDDashboardService:', error);
        throw error;
    }
};

export const updateProductivityRateService = async (manDriverId: string | number, data: { id: number, year: string, amount: number }[]) => {
    try {
        const pool = await poolPromise;
        const tvp = new sql.Table('mp_ParaList');
        tvp.columns.add('id', sql.Decimal(18, 0));
        tvp.columns.add('year', sql.VarChar(50));
        tvp.columns.add('amount', sql.Decimal(18, 2));

        for (const item of data) {
            tvp.rows.add(item.id, item.year, item.amount);
        }

        const request = new sql.Request(pool);
        request.input('DataTable', tvp);
        request.input('ManDriverID', sql.Decimal, manDriverId);
        await request.execute('mp_ManDriverRateDTUpdate');
        return { success: true };
    } catch (error) {
        console.error('Error executing updateProductivityRateService:', error);
        throw error;
    }
};

// ========================
// History Approve Services
// ========================

export const getHistoryManDriverApproveService = async (
    effectiveMonth: string | null | undefined,
    effectiveYear: string,
    requestType: number,
    employeeId: string,
    orgUnitNo: string,
    userGroupNo: string,
    division: string
) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        let formattedDate: string | null = null;
        if (effectiveMonth) {
            const effMonthStr = effectiveMonth.length === 1 ? `0${effectiveMonth}` : effectiveMonth;
            formattedDate = `${effectiveYear}-${effMonthStr}-01`;
        }

        request.input('EffectiveDate', sql.DateTime, formattedDate ? new Date(formattedDate) : null);
        request.input('EffectiveYear', sql.VarChar(50), effectiveYear);
        request.input('RequestType', sql.Int, requestType);
        request.input('EmployeeID', sql.VarChar(50), employeeId);
        request.input('OrgUnitNo', sql.VarChar(50), orgUnitNo || null);
        request.input('UserGroupNo', sql.VarChar(50), userGroupNo);
        request.input('division', sql.VarChar(50), division || null);

        console.log('[DEBUG] mp_HistoryManDriverApproveGet params:', {
            EffectiveDate: formattedDate ? new Date(formattedDate) : null,
            EffectiveYear: effectiveYear,
            RequestType: requestType,
            EmployeeID: employeeId,
            OrgUnitNo: orgUnitNo,
            UserGroupNo: userGroupNo,
            division: division
        });

        const result = await request.execute('mp_HistoryManDriverApproveGet');
        console.log(`[DEBUG] mp_HistoryManDriverApproveGet result: ${result.recordset?.length || 0} rows found`);
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing mp_HistoryManDriverApproveGet:', error);
        throw error;
    }
};

type ReusableMkdSource = { manDriverId: string; requestNo: string };

const normalizeReusableMkdParams = (effectiveYear: string, employeeId: string) => ({
    normalizedYear: String(effectiveYear || '').trim(),
    normalizedEmployeeId: String(employeeId || '').trim()
});

const getReusableMkdOwnHistoryRows = async (
    normalizedYear: string,
    normalizedEmployeeId: string,
    userGroupNo: string
) => {
    const historyRows = await getHistoryManDriverService(
        undefined,
        normalizedYear,
        1,
        normalizedEmployeeId,
        '',
        userGroupNo || '',
        ''
    );

    return (historyRows || []).filter((row: any) => {
        const createBy = String(row?.CreateBy || row?.createBy || '').trim();
        // Keep row if CreateBy matches current user, or if API source doesn't return CreateBy.
        return !createBy || createBy === normalizedEmployeeId;
    });
};

const buildReusableMkdSourceMap = (rows: any[]) => {
    const sourceMap = new Map<string, ReusableMkdSource>();
    rows.forEach((row: any) => {
        const manDriverId = String(row?.ManDriverID || '').trim();
        if (!manDriverId) return;

        const requestNo = String(row?.RequestNo || row?.fullRequestNo || '').trim();
        if (!sourceMap.has(manDriverId)) {
            sourceMap.set(manDriverId, {
                manDriverId,
                requestNo: requestNo || 'ID_' + manDriverId
            });
        }
    });
    return sourceMap;
};

const getReusableMkdFilesForSource = async (pool: sql.ConnectionPool, source: ReusableMkdSource) => {
    const req = new sql.Request(pool);
    req.input('ManDriverID', sql.Decimal, source.manDriverId);
    const res = await req.execute('mp_ManDriverFileListGet');
    const files = res?.recordset || [];

    return files
        .map((file: any) => ({
            sourceManDriverId: source.manDriverId,
            requestNo: source.requestNo,
            fileName: String(file?.FileName || file?.fileName || file?.FileUpload || '').trim(),
            fileUpload: String(file?.FileUpload || '').trim(),
            createDate: file?.CreateDate || file?.UpdateDate || null
        }))
        .filter((file: any) => file.fileUpload);
};

const dedupeAndSortReusableMkdFiles = (fileCollections: any[][]) => {
    const deduped = new Map<string, any>();
    fileCollections.flat().forEach((item) => {
        const key = item.sourceManDriverId + '::' + item.fileUpload;
        if (!deduped.has(key)) deduped.set(key, item);
    });

    return Array.from(deduped.values()).sort((a, b) => {
        const aTime = a.createDate ? new Date(a.createDate).getTime() : 0;
        const bTime = b.createDate ? new Date(b.createDate).getTime() : 0;
        return bTime - aTime;
    });
};

export const getReusableMkdFilesService = async (
    effectiveYear: string,
    employeeId: string,
    userGroupNo: string = ''
) => {
    try {
        const { normalizedYear, normalizedEmployeeId } = normalizeReusableMkdParams(effectiveYear, employeeId);
        if (!normalizedYear || !normalizedEmployeeId) return [];

        const ownRows = await getReusableMkdOwnHistoryRows(normalizedYear, normalizedEmployeeId, userGroupNo);
        const sourceMap = buildReusableMkdSourceMap(ownRows);
        const pool = await poolPromise;
        const fileCollections = await Promise.all(
            Array.from(sourceMap.values()).map((source) => getReusableMkdFilesForSource(pool, source))
        );

        return dedupeAndSortReusableMkdFiles(fileCollections);
    } catch (error) {
        console.error('Error in getReusableMkdFilesService:', error);
        throw error;
    }
};

export const getFlowHistoryService = async (manDriverId: string | number, approveId: string | number) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('ManDriverID', sql.Decimal, manDriverId);
        request.input('ApproveID', sql.Decimal, approveId);
        const result = await request.execute('mp_ManDriverFlowHistGet');
        
        const historyData = result.recordset || [];
        
        if (historyData.length > 0) {
            // Fetch remarks to join with history
            const remarkReq = new sql.Request(pool);
            remarkReq.input('ApproveID', sql.Decimal, approveId);
            const remarkResult = await remarkReq.execute('mp_ApproveHistRemarkGet');
            
            const remarkMap = new Map();
            remarkResult.recordset.forEach((r: any) => {
                remarkMap.set(r.ApproveHistID.toString(), r.Remark);
            });
            
            return historyData.map((h: any) => ({
                ...h,
                Remark: remarkMap.get(h.ApproveHistID?.toString()) || h.Remark || ''
            }));
        }

        return historyData;
    } catch (error) {
        console.error('Error executing mp_ManDriverFlowHistGet:', error);
        throw error;
    }
};

export const approveManDriverService = async (
    manDriverId: string | number,
    conclusionNo: string,
    updateBy: string,
    mkdApproveCount: number = 0,
    status: number = 3,
    fileName: string = '',
    fileUpload: string = ''
) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('ManDriverID', sql.Decimal, manDriverId);
        request.input('ConclusionNo', sql.VarChar, conclusionNo);
        request.input('MKDApprove', sql.Int, mkdApproveCount);
        request.input('FileName', sql.VarChar, fileName);
        request.input('FileUpload', sql.VarChar, fileUpload);
        request.input('ManDriverStatus', sql.Int, status);
        request.input('UpdateBy', sql.VarChar, updateBy);
        request.input('UpdateDate', sql.DateTime, new Date());
        request.input('RefID', sql.VarChar, null);
        request.input('UploadBy', sql.VarChar, updateBy);
        request.input('UploadDate', sql.DateTime, new Date());
        
        await request.execute('mp_ManDriverApproveUpdate');
        return { success: true };
    } catch (error) {
        console.error('Error executing mp_ManDriverApproveUpdate:', error);
        throw error;
    }
};

const createMkdApproval = async (transaction: sql.Transaction, manDriverId: string, employeeId: string): Promise<number> => {
    const approveReq = new sql.Request(transaction);
    approveReq.input('RefID', sql.Decimal(18, 0), manDriverId);
    approveReq.input('ApproveStatus', sql.Int, 1);
    approveReq.input('CreateBy', sql.VarChar(20), employeeId);
    approveReq.input('CreateDate', sql.DateTime, new Date());

    const approveResult = await approveReq.execute('mp_ManDriverApproveInsert');
    return approveResult.recordset[0].ApproveID;
};

const filterMkdApprovalFlow = (rawFlow: any[]): any[] => {
    const hasAE = rawFlow.some((step: any) => step.REP_BAND?.trim() === 'AE');
    return rawFlow.filter((step: any) => {
        const band = step.REP_BAND?.trim();
        if (band !== 'AF' && band !== 'AG' && band !== 'AH') {
            return true;
        }
        return hasAE ? false : band === 'AF';
    });
};

const loadNewMkdApprovalFlow = async (employeeId: string) => {
    console.log(`[requestApproveMKDService] Fetching info for employee: ${employeeId}`);
    const empInfo = await pisService.getEmployeeInfo(employeeId);
    if (!empInfo) {
        console.error(`[requestApproveMKDService] Employee info not found for ${employeeId}`);
        throw new Error(`ไม่พบข้อมูลพนักงาน (${employeeId}) ในระบบ PIS`);
    }

    const posCode = empInfo.POSCODE || empInfo.poscode;
    const requesterDisplayName = `${empInfo.FNAME || ''} ${empInfo.LNAME || ''}`.trim() || employeeId;
    console.log(`[requestApproveMKDService] Employee: ${empInfo.FNAME} ${empInfo.LNAME}, PosCode: ${posCode}`);
    console.log(`[requestApproveMKDService] Fetching flow for ${employeeId} / ${posCode}`);

    const rawFlow = await pisService.getApprovalFlow(employeeId, posCode);
    if (!rawFlow || rawFlow.length === 0) {
        console.error(`[requestApproveMKDService] No flow steps returned for ${employeeId}`);
        throw new Error('ไม่พบสายการอนุมัติ (Approval Flow) ในระบบ PIS สำหรับตำแหน่งนี้');
    }

    console.log(`[requestApproveMKDService] Raw flow steps: ${rawFlow.length}`);
    const flow = filterMkdApprovalFlow(rawFlow);
    console.log(`[requestApproveMKDService] Filtered flow steps: ${flow.length}`);

    if (flow.length === 0) {
        throw new Error('สายการอนุมัติว่างเปล่าหลังจากทำการคัดกรอง Band (AE/AF/AG/AH)');
    }

    return { empInfo, posCode, flow, requesterDisplayName };
};

const resendMkdApproval = async (
    transaction: sql.Transaction,
    manDriverId: string,
    employeeId: string,
    approveId: number
): Promise<string> => {
    console.log(`[requestApproveMKDService] Executing RESEND logic for ApproveID: ${approveId}`);

    const seq0Req = new sql.Request(transaction);
    seq0Req.input('ApproveID', sql.Decimal(18, 0), approveId);
    seq0Req.input('RefID', sql.Decimal(18, 0), manDriverId);
    const seq0Res = await seq0Req.execute('mp_ManDriverApproveHistSeq0Get');
    const approveHistId = seq0Res.recordset[0]?.ApproveHistID;

    if (!approveHistId) {
        console.error('[requestApproveMKDService] Seqno 0 not found. Cannot execute resend update.');
        throw new Error('ไม่พบข้อมูลผู้สร้างคำขอ (Seqno 0) สำหรับการส่งขออนุมัติซ้ำ');
    }

    const spReq = new sql.Request(transaction);
    spReq.input('ManDriverID', sql.Decimal(18, 0), manDriverId);
    spReq.input('ApproveHistID', sql.Decimal(18, 0), approveHistId);
    spReq.input('ApproveID', sql.Decimal(18, 0), approveId);
    spReq.input('ApproveBy', sql.VarChar(20), employeeId);
    spReq.input('ApproveDate', sql.DateTime, new Date());
    spReq.input('ApproveStatus', sql.Int, 1);
    await spReq.execute('mp_ManDriverApproveHistUpdateRe');
    console.log(`[requestApproveMKDService] Executed SP mp_ManDriverApproveHistUpdateRe for ApproveHistID: ${approveHistId}`);

    const requesterReq = new sql.Request(transaction);
    requesterReq.input('ApproveID', sql.Decimal(18, 0), approveId);
    const requesterRes = await requesterReq.query(`
        SELECT TOP 1 FNAME, LNAME
        FROM MP_ApproveHist
        WHERE ApproveID = @ApproveID AND Seqno = 0
    `);
    const requester = requesterRes.recordset[0];
    return `${requester?.FNAME || ''} ${requester?.LNAME || ''}`.trim() || employeeId;
};

const insertMkdRequesterHistory = async (
    transaction: sql.Transaction,
    manDriverId: string,
    approveId: number,
    employeeId: string,
    empInfo: any,
    posCode: string
) => {
    const requesterReq = new sql.Request(transaction);
    requesterReq.input('ApproveID', sql.Decimal(18, 0), approveId);
    requesterReq.input('RefID', sql.Decimal(18, 0), manDriverId);
    requesterReq.input('Seqno', sql.Int, 0);
    requesterReq.input('INAME', sql.NVarChar(50), empInfo.INAME || '');
    requesterReq.input('FNAME', sql.NVarChar(100), empInfo.FNAME || '');
    requesterReq.input('LNAME', sql.NVarChar(100), empInfo.LNAME || '');
    requesterReq.input('POSCODE', sql.NVarChar(10), posCode);
    requesterReq.input('posname', sql.NVarChar(200), empInfo.posname || '');
    requesterReq.input('EmailAddr', sql.NVarChar(200), empInfo.EmailAddr || '');
    requesterReq.input('REP_NO', sql.Int, -1);
    requesterReq.input('REP_CODE', sql.NVarChar(10), formatMkdRepCode(employeeId));
    requesterReq.input('ApproveHistStatus', sql.Int, 1);
    requesterReq.input('ApproveHistDate', sql.DateTime, new Date());
    requesterReq.input('ApproveHistBy', sql.NVarChar(20), employeeId);
    await requesterReq.execute('mp_ManDriverApproveHistInsert');
};

const insertMkdApproverHistory = async (
    transaction: sql.Transaction,
    manDriverId: string,
    approveId: number,
    flow: any[]
) => {
    let seq = 1;
    for (const step of flow) {
        const repNo = step.REP_NO !== undefined ? Number(step.REP_NO) : seq;
        const stepReq = new sql.Request(transaction);
        stepReq.input('ApproveID', sql.Decimal(18, 0), approveId);
        stepReq.input('RefID', sql.Decimal(18, 0), manDriverId);
        stepReq.input('Seqno', sql.Int, seq++);
        stepReq.input('INAME', sql.NVarChar(50), step.INAME || '');
        stepReq.input('FNAME', sql.NVarChar(100), step.FNAME || '');
        stepReq.input('LNAME', sql.NVarChar(100), step.LNAME || '');
        stepReq.input('POSCODE', sql.NVarChar(10), step.POSCODE || '');
        stepReq.input('posname', sql.NVarChar(200), step.posname || step.POSNAME || '');
        stepReq.input('EmailAddr', sql.NVarChar(200), step.EmailAddr || '');
        stepReq.input('REP_NO', sql.Int, repNo);
        stepReq.input('REP_CODE', sql.NVarChar(10), formatMkdRepCode(step.CODE || step.REP_CODE || ''));
        stepReq.input('ApproveHistStatus', sql.Int, 0);
        await stepReq.execute('mp_ManDriverApproveHistInsert');
    }
};

const linkMkdApproveStatus = async (
    transaction: sql.Transaction,
    manDriverId: string,
    approveId: number,
    employeeId: string
) => {
    const updateReq = new sql.Request(transaction);
    updateReq.input('ManDriverID', sql.Decimal(18, 0), manDriverId);
    updateReq.input('Status', sql.Int, 1);
    updateReq.input('ApproveID', sql.Decimal(18, 0), approveId);
    updateReq.input('UpdateBy', sql.VarChar(20), employeeId);
    updateReq.input('UpdateDate', sql.DateTime, new Date());
    await updateReq.execute('mp_ManDriverStatusLinkApprove');
};

const notifyFirstMkdApprover = async (
    transaction: sql.Transaction,
    manDriverId: string,
    approveId: number,
    employeeId: string,
    requesterDisplayName: string
) => {
    console.log(`[requestApproveMKDService] Sending mail to first approver (Seqno 1) using ApproveID ${approveId}`);
    try {
        const nextApproverReq = new sql.Request(transaction);
        nextApproverReq.input('ApproveID', sql.Decimal(18, 0), approveId);
        nextApproverReq.input('Seqno', sql.Int, 1);
        const nextRes = await nextApproverReq.query('SELECT FNAME, LNAME, EmailAddr, REP_CODE FROM MP_ApproveHist WHERE ApproveID = @ApproveID AND Seqno = @Seqno');
        const next = nextRes.recordset?.[0];

        if (!next?.EmailAddr) {
            return;
        }

        const subject = `[PTTSWP] โปรดอนุมัติ Manpower Key Drivers (${manDriverId})`;
        const body = `
            <h2>แจ้งเตือนการเสนออนุมัติ MKD</h2>
            <p>เรียน คุณ ${next.FNAME} ${next.LNAME},</p>
            <p>มีคำขอจัดทำ Manpower Key Drivers หมายเลข <b>${manDriverId}</b> รอการพิจารณาจากท่าน</p>
            <p>ผู้เสนอ: ${requesterDisplayName}</p>
            <p>โปรดตรวจสอบรายละเอียดที่: <a href="http://localhost:3000/mkd/inbox">MKD Inbox</a></p>
            <hr/>
            <p style="color: gray; font-size: 12px;">นี่คือระบบเมลอัตโนมัติ</p>
        `;
        const recipient = await resolveMailRecipient('SendMailManDriver', next.EmailAddr);
        await sendMailWithLog({
            recipient,
            requestedRecipient: next.EmailAddr,
            subject,
            body,
            sendFromBy: employeeId,
            sendToBy: next.REP_CODE || null,
            refNo: buildMkdMailRefNo(manDriverId),
            context: 'requestApproveMKDService'
        });
    } catch (mailError) {
        console.error('Email notification failed in requestApproveMKDService:', mailError);
    }
};

export const requestApproveMKDService = async (manDriverId: string, employeeId: string, approveIdStr?: string) => {
    console.log(`[requestApproveMKDService] Start. ManDriverID: ${manDriverId}, EmployeeID: ${employeeId}, ApproveIDStr: ${approveIdStr}`);

    const approveId = parseMkdApproveId(approveIdStr);

    try {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            let activeApproveId = approveId;
            let requesterDisplayName: string;

            if (activeApproveId) {
                console.log(`[requestApproveMKDService] RESEND mode. Reusing existing ApproveID: ${activeApproveId} (skip PIS)`);
                requesterDisplayName = await resendMkdApproval(transaction, manDriverId, employeeId, activeApproveId);
            } else {
                const { empInfo, posCode, flow, requesterDisplayName: displayName } = await loadNewMkdApprovalFlow(employeeId);
                activeApproveId = await createMkdApproval(transaction, manDriverId, employeeId);
                requesterDisplayName = displayName;
                console.log(`[requestApproveMKDService] Created new ApproveID: ${activeApproveId}`);
                await insertMkdRequesterHistory(transaction, manDriverId, activeApproveId, employeeId, empInfo, posCode);
                await insertMkdApproverHistory(transaction, manDriverId, activeApproveId, flow);
            }

            if (!activeApproveId) {
                throw new Error('ไม่สามารถระบุ ApproveID สำหรับการส่งขออนุมัติได้');
            }

            await linkMkdApproveStatus(transaction, manDriverId, activeApproveId, employeeId);
            await notifyFirstMkdApprover(transaction, manDriverId, activeApproveId, employeeId, requesterDisplayName);

            await transaction.commit();
            console.log('[requestApproveMKDService] Success!');
            return { success: true, message: 'Approval request submitted successfully', approveId: activeApproveId };
        } catch (error) {
            console.error('[requestApproveMKDService] Error occurred, rolling back:', error);
            await transaction.rollback();
            throw error;
        }
    } catch (error) {
        console.error('Error in requestApproveMKDService:', error);
        throw error;
    }
};

export const exportListKeymanService = async () => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().execute('MP_MandriverExportListKeyman');
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing MP_MandriverExportListKeyman:', error);
        throw error;
    }
};

export const createMasterKeyMasterService = async (keyManName: string, createBy: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('KeyManName', sql.VarChar(255), keyManName);
        request.input('CreateBy', sql.VarChar(50), createBy);
        request.input('CreateDate', sql.DateTime, new Date());
        
        await request.execute('mp_MasTerKeyManInsert');
        return { success: true };
    } catch (error) {
        console.error('Error executing mp_MasTerKeyManInsert:', error);
        throw error;
    }
};

export const updateMasterKeyMasterService = async (keyManId: number | string, updateBy: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('KeyManID', sql.Decimal, keyManId);
        request.input('UpdateBy', sql.VarChar(50), updateBy);
        request.input('UpdateDate', sql.DateTime, new Date());
        
        await request.execute('mp_MasTerKeyManUpdate');
        return { success: true };
    } catch (error) {
        console.error('Error executing mp_MasTerKeyManUpdate:', error);
        throw error;
    }
};

export const isMasterKeyInUseService = async (keyManId: number | string) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().execute('mp_MasterKeymanGet');
        const key = String(keyManId);
        const target = (result.recordset || []).find((item: any) => String(item.KeyManID) === key);

        if (!target) {
            throw new Error('ไม่พบข้อมูล Manpower Key Driver ที่ต้องการลบ');
        }

        return Number(target.chkuse || 0) > 0;
    } catch (error) {
        console.error('Error checking mp_MasterKeymanGet usage:', error);
        throw error;
    }
};

export const exportPositionService = async (
    effYear: string | null,
    effDate: string | null, // Expected YYYY-MM-DD from frontend
    employeeId: string,
    userGroupNo: string,
    exportType: number
) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        let effectiveYear: number | null = null;
        let effectiveDate: Date | null = null;

        if (exportType === 1) {
            effectiveYear = effYear ? parseInt(effYear) - 543 : null;
        } else if (effDate) {
            // Support both YYYY-MM-DD and DD/MM/BBBB
            if (effDate.includes('-')) {

                effectiveDate = new Date(effDate);
            } else if (effDate.includes('/')) {

                const parts = effDate.split('/');
                if (parts.length === 3) {
                    const day = parseInt(parts[0]);
                    const month = parseInt(parts[1]) - 1;
                    const year = parseInt(parts[2]) - 543;
                    effectiveDate = new Date(year, month, day);
                }
            }
        }

        console.log('--- Calling mp_PositionExportExcel ---', {
            EffectiveYear: effectiveYear,
            EffectiveDate: effectiveDate?.toISOString(),
            EmployeeID: employeeId,
            UserGroupNo: userGroupNo,
            ExportType: exportType
        });

        request.input('EffectiveYear', sql.Int, effectiveYear);
        request.input('EffectiveDate', sql.DateTime, effectiveDate);
        request.input('EmployeeID', sql.NVarChar(50), employeeId);
        request.input('UserGroupNo', sql.NVarChar(50), userGroupNo);
        request.input('ExportType', sql.Int, exportType);

        const result = await request.execute('mp_PositionExportExcel');
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing mp_PositionExportExcel:', error);
        throw error;
    }
};

export const getInboxManDriverService = async (employeeId: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('EmployeeID', sql.VarChar(50), employeeId);
        const result = await request.execute('mp_ManDriverInboxGet');
        
        let records: any[] = result.recordset ? Array.from(result.recordset) : [];
        // Self-Exclusion: Exclude any record where the user themselves created it
        records = records.filter(item => item.CreateBy !== employeeId && item.EmpName !== employeeId);
        records = records.map((item) => ({
            ...item,
            Detail1: typeof item.Detail1 === 'string' ? normalizeMkdText(item.Detail1) : item.Detail1,
            Detail2: typeof item.Detail2 === 'string' ? normalizeMkdText(item.Detail2) : item.Detail2,
            FullDetail: typeof item.FullDetail === 'string' ? normalizeMkdText(item.FullDetail) : item.FullDetail
        }));
        
        return records;
    } catch (error) {
        console.error('Error executing mp_ManDriverInboxGet:', error);
        throw error;
    }
};

export const getMyRequestsMKDService = async (employeeId: string) => {
    try {
        const pool = await poolPromise;
        const req = new sql.Request(pool);
        req.input('EmployeeID', sql.VarChar(50), employeeId);
        
        const result = await req.execute('mp_ManDriverMyRequestsGet');
        return result.recordset || [];
    } catch (error) {
        console.error('Error in getMyRequestsMKDService:', error);
        throw error;
    }
};

const findPendingMkdApprovalStep = async (transaction: sql.Transaction, approveId: number, employeeId: string) => {
    const findReq = new sql.Request(transaction);
    findReq.input('ApproveID', sql.Decimal(18, 0), approveId);
    const repCode = formatMkdRepCode(employeeId);
    findReq.input('REP_CODE', sql.VarChar(50), repCode);

    const histResult = await findReq.execute('mp_ManDriverApproveHistFindPending');
    if (!histResult.recordset || histResult.recordset.length === 0) {
        console.error('[submitMKDApproveActionService] Step not found:', { approveId, employeeId, repCode });
        throw new Error('ไม่พบขั้นตอนการอนุมัติที่รอดำเนินการสำหรับผู้ใช้นี้ (No pending approval step for this Employee ID)');
    }

    return histResult.recordset[0];
};

const updateMkdApprovalHistStatus = async (
    transaction: sql.Transaction,
    approveHistId: number,
    employeeId: string,
    action: 'APPROVE' | 'REJECT'
) => {
    const updateHistReq = new sql.Request(transaction);
    updateHistReq.input('ApproveHistID', sql.Decimal(18, 0), approveHistId);
    updateHistReq.input('ApproveStatus', sql.Int, action === 'APPROVE' ? 1 : -1);
    updateHistReq.input('ApproveBy', sql.VarChar(50), employeeId);
    await updateHistReq.execute('mp_ManDriverApproveHistUpdateStatus');
};

const updateMkdMidApprove = async (
    transaction: sql.Transaction,
    manDriverId: number,
    remark: string,
    employeeId: string
) => {
    const midReq = new sql.Request(transaction);
    midReq.input('ManDriverID', sql.Decimal(18, 0), manDriverId);
    midReq.input('Remark', sql.NVarChar(sql.MAX), remark || '');
    midReq.input('UpdateBy', sql.VarChar(50), employeeId);
    await midReq.execute('mp_ManDriverMidApproveUpdate');
};

const updateMkdStatusRemark = async (
    transaction: sql.Transaction,
    manDriverId: number,
    status: number,
    remark: string,
    employeeId: string
) => {
    const statusReq = new sql.Request(transaction);
    statusReq.input('ManDriverID', sql.Decimal(18, 0), manDriverId);
    statusReq.input('Status', sql.Int, status);
    statusReq.input('Remark', sql.NVarChar(sql.MAX), remark || '');
    statusReq.input('UpdateBy', sql.VarChar(50), employeeId);
    await statusReq.execute('mp_ManDriverStatusRemarkUpdate');
};

const getMkdRequester = async (transaction: sql.Transaction, approveId: number) => {
    const reqUserReq = new sql.Request(transaction);
    reqUserReq.input('ApproveID', sql.Decimal(18, 0), approveId);
    const reqRes = await reqUserReq.query('SELECT FNAME, LNAME, EmailAddr, REP_CODE FROM MP_ApproveHist WHERE ApproveID = @ApproveID AND Seqno = 0');
    return reqRes.recordset?.[0] || null;
};

const notifyNextMkdApprover = async (next: any, manDriverId: number, employeeId: string) => {
    if (!next?.EmailAddr) {
        return;
    }

    const subject = `[PTTSWP] โปรดอนุมัติ Manpower Key Drivers (${manDriverId})`;
    const body = `
        <h2>แจ้งเตือนการพิจารณา MKD</h2>
        <p>เรียน คุณ ${next.FNAME} ${next.LNAME},</p>
        <p>มีคำขอจัดทำ Manpower Key Drivers หมายเลข <b>${manDriverId}</b> รอการพิจารณาจากท่าน</p>
        <p>โปรดตรวจสอบรายละเอียดที่: <a href="http://localhost:3000/mkd/inbox">MKD Inbox</a></p>
        <hr/>
        <p style="color: gray; font-size: 12px;">นี่คือระบบเมลอัตโนมัติ</p>
    `;
    const recipient = await resolveMailRecipient('SendMailManDriver', next.EmailAddr);
    await sendMailWithLog({
        recipient,
        requestedRecipient: next.EmailAddr,
        subject,
        body,
        sendFromBy: employeeId,
        sendToBy: next.REP_CODE || next.EmployeeID || next.EmployeeId || null,
        refNo: buildMkdMailRefNo(manDriverId),
        context: 'submitMKDApproveActionService'
    });
};

const notifyMkdRequester = async (
    reqUser: any,
    manDriverId: number,
    employeeId: string,
    subject: string,
    body: string
) => {
    if (!reqUser?.EmailAddr) {
        return;
    }

    const recipient = await resolveMailRecipient('SendMailManDriver', reqUser.EmailAddr);
    await sendMailWithLog({
        recipient,
        requestedRecipient: reqUser.EmailAddr,
        subject,
        body,
        sendFromBy: employeeId,
        sendToBy: reqUser.REP_CODE || null,
        refNo: buildMkdMailRefNo(manDriverId),
        context: 'submitMKDApproveActionService'
    });
};

const notifyMkdApprovalCompleted = async (
    transaction: sql.Transaction,
    approveId: number,
    manDriverId: number,
    employeeId: string
) => {
    try {
        const reqUser = await getMkdRequester(transaction, approveId);
        const subject = `[PTTSWP] MKD (${manDriverId}) ได้รับการอนุมัติครบถ้วนแล้ว`;
        const body = `
            <h2>แจ้งเตือนสถานะคำขอ MKD</h2>
            <p>เรียน คุณ ${reqUser?.FNAME} ${reqUser?.LNAME},</p>
            <p>คำขอจัดทำ Manpower Key Drivers หมายเลข <b>${manDriverId}</b> ของท่านได้รับการอนุมัติเรียบร้อยแล้ว</p>
            <p>โปรดตรวจสอบรายละเอียดที่: <a href="http://localhost:3000/mkd/history">MKD History</a></p>
            <hr/>
            <p style="color: gray; font-size: 12px;">นี่คือระบบเมลอัตโนมัติ</p>
        `;
        await notifyMkdRequester(reqUser, manDriverId, employeeId, subject, body);
    } catch (mailError) {
        console.error('Email notification failed for requester in MKD:', mailError);
    }
};

const notifyMkdRejected = async (
    transaction: sql.Transaction,
    approveId: number,
    manDriverId: number,
    employeeId: string,
    remark: string
) => {
    try {
        const reqUser = await getMkdRequester(transaction, approveId);
        const subject = `[PTTSWP] MKD (${manDriverId}) ถูกส่งคืน (Rejected)`;
        const body = `
            <h2>แจ้งเตือนการส่งคืน MKD</h2>
            <p>เรียน คุณ ${reqUser?.FNAME} ${reqUser?.LNAME},</p>
            <p>คำขอจัดทำ Manpower Key Drivers หมายเลข <b>${manDriverId}</b> ของท่านถูกส่งคืน/ไม่ได้รับการอนุมัติ</p>
            <p><b>เหตุผล:</b> ${remark}</p>
            <p>โปรดตรวจสอบและแก้ไขได้ที่: <a href="http://localhost:3000/mkd/history">MKD History</a></p>
            <hr/>
            <p style="color: gray; font-size: 12px;">นี่คือระบบเมลอัตโนมัติ</p>
        `;
        await notifyMkdRequester(reqUser, manDriverId, employeeId, subject, body);
    } catch (err) {
        console.warn('Failed to send rejection mail:', err);
    }
};

const getNextMkdApprovalStep = async (transaction: sql.Transaction, approveId: number, seqno: number) => {
    const nextReq = new sql.Request(transaction);
    nextReq.input('ApproveID', sql.Decimal(18, 0), approveId);
    nextReq.input('CurrentSeqno', sql.Int, seqno);
    const nextResult = await nextReq.execute('mp_ManDriverApproveHistNextGet');
    return nextResult.recordset || [];
};

const handleMkdApproveAction = async (
    transaction: sql.Transaction,
    manDriverId: number,
    approveId: number,
    employeeId: string,
    remark: string,
    seqno: number
) => {
    const nextSteps = await getNextMkdApprovalStep(transaction, approveId, seqno);
    if (nextSteps.length > 0) {
        await updateMkdMidApprove(transaction, manDriverId, remark, employeeId);
        try {
            await notifyNextMkdApprover(nextSteps[0], manDriverId, employeeId);
        } catch (mailError) {
            console.error('Email notification failed for next approver in MKD:', mailError);
        }
        return;
    }

    await updateMkdStatusRemark(transaction, manDriverId, 2, remark, employeeId);
    await notifyMkdApprovalCompleted(transaction, approveId, manDriverId, employeeId);
};

const insertMkdApprovalRemark = async (
    transaction: sql.Transaction,
    approveHistId: number,
    approveId: number,
    remark: string
) => {
    if (!remark) {
        return;
    }

    const remarkReq = new sql.Request(transaction);
    remarkReq.input('ApproveHistID', sql.Decimal(18, 0), approveHistId);
    remarkReq.input('ApproveID', sql.Decimal(18, 0), approveId);
    remarkReq.input('Remark', sql.NVarChar(200), remark);
    await remarkReq.execute('mp_ApproveHistRemarkInsert');
};

const resetMkdCreatorApproval = async (transaction: sql.Transaction, approveId: number) => {
    const resetCreatorReq = new sql.Request(transaction);
    resetCreatorReq.input('ApproveID', sql.Decimal(18, 0), approveId);
    await resetCreatorReq.execute('mp_ManDriverApproveHistResetCreator');
};

const handleMkdRejectAction = async (
    transaction: sql.Transaction,
    manDriverId: number,
    approveId: number,
    employeeId: string,
    remark: string,
    approveHistId: number
) => {
    await updateMkdStatusRemark(transaction, manDriverId, 1, remark, employeeId);
    await resetMkdCreatorApproval(transaction, approveId);
    await insertMkdApprovalRemark(transaction, approveHistId, approveId, remark);
    await notifyMkdRejected(transaction, approveId, manDriverId, employeeId, remark);
};

export const submitMKDApproveActionService = async (
    manDriverId: number,
    approveId: number,
    employeeId: string,
    action: 'APPROVE' | 'REJECT',
    remark: string
) => {
    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);

    try {
        await transaction.begin();

        const { ApproveHistID, Seqno } = await findPendingMkdApprovalStep(transaction, approveId, employeeId);
        await updateMkdApprovalHistStatus(transaction, ApproveHistID, employeeId, action);

        if (action === 'APPROVE') {
            await handleMkdApproveAction(transaction, manDriverId, approveId, employeeId, remark, Seqno);
        } else {
            await handleMkdRejectAction(transaction, manDriverId, approveId, employeeId, remark, ApproveHistID);
        }
        await transaction.commit();
        return { success: true, message: action === 'APPROVE' ? 'Approved successfully' : 'Rejected successfully' };
    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error(`Error in submitMKDApproveActionService (${action}):`, error);
        throw error;
    }
};

export const copyMKDService = async (
    copyFromId: number,
    targetId: number,
    employeeId: string,
    effectiveYear: string
) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        request.input('CopyManDriverID', sql.Decimal(18, 0), copyFromId);
        request.input('ManDriverID', sql.Decimal(18, 0), targetId);
        request.input('CreateBy', sql.VarChar(50), employeeId);
        request.input('EffectiveYear', sql.Int, parseInt(effectiveYear));

        await request.execute('mp_ManDriverCopy');
        return { success: true, message: 'Data copied successfully' };
    } catch (error) {
        console.error('Error in copyMKDService:', error);
        throw error;
    }
};

export const getMKDHistoryService = async (employeeId: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('EmployeeID', sql.VarChar(50), employeeId);
        
        const result = await request.execute('mp_ManDriverHistoryGet');
        return result.recordset || [];
    } catch (error) {
        console.error('Error in getMKDHistoryService:', error);
        throw error;
    }
};

export const cancelMKDService = async (manDriverId: number) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        
        request.input('ManDriverID', sql.Decimal(18, 0), manDriverId);
        request.input('ManDriverStatus', sql.Int, 0); // 0 = Cancelled / Draft
        
        await request.execute('mp_ManDriverCancelUpdate');
        
        return { success: true, message: 'Document cancelled successfully' };
    } catch (error) {
        console.error('Error executing cancelMKDService:', error);
        throw error;
    }
};
