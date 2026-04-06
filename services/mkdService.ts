import { sql, poolPromise } from '../config/db.js';
import pisService from './pisService.js';

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

        console.log('MKD History Fetch Params:', {
            formattedDate,
            effectiveYear,
            requestType,
            employeeId,
            orgUnitNo,
            userGroupNo,
            division
        });

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
            // Bypassing mp_ManDriverFileGet due to LEFT/SUBSTRING errors with non-standard filenames
            const res = await req.query(`
                SELECT *, 'pdf' as extension 
                FROM MP_ManDriverFile 
                WHERE ManDriverID = @ManDriverID AND FileStatus > 0
            `);
            return res.recordset || [];
        };

        const [header, keys, years, files] = await Promise.all([getHeader(), getKeys(), getYears(), getFiles()]);

        console.log(`MKD Details for ID ${manDriverId}:`, {
            hasHeader: !!header,
            keyCount: keys.length,
            yearCount: years.length,
            fileCount: files.length
        });

        console.log(`[DEBUG] MKD Details for ID ${manDriverId}:`, { hasHeader: !!header, keyCount: keys?.length || 0, yearCount: years?.length || 0, keys: keys?.map(k => ({ id: k.ManDriverKeyID, parent: k.ParentID, name: k.Name || k.KeyManName })) });
        return { header, keys, years, files };
    } catch (error) {
        console.error('Error executing getting MKD Details:', error);
        throw error;
    }
};

export const createMainKeyService = async (
    manDriverId: string | number,
    keyManId: string | number | null,
    unit: string,
    keyType: string,
    weight: number,
    createBy: string,
    insertType: string,
    effectiveYear: string,
    parentId: string | number | null
) => {
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
        request.input('Note', sql.VarChar(sql.MAX), note || '');
        request.input('UpdateDate', sql.DateTime, new Date());
        
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

export const getFlowHistoryService = async (manDriverId: string | number, approveId: string | number) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('ManDriverID', sql.Decimal, manDriverId);
        request.input('ApproveID', sql.Decimal, approveId);
        const result = await request.execute('mp_ManDriverFlowHistGet');
        return result.recordset || [];
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

export const requestApproveMKDService = async (manDriverId: string, employeeId: string) => {
    try {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Get Employee Info from PIS (POSCODE)
            const empInfo = await pisService.getEmployeeInfo(employeeId);
            if (!empInfo) {
                throw new Error(`Employee info not found in PIS for ${employeeId}`);
            }
            const posCode = empInfo.POSCODE || empInfo.poscode;

            // 2. Initialize MP_Approve
            const approveReq = new sql.Request(transaction);
            approveReq.input('RefID', sql.Decimal(18, 0), manDriverId);
            approveReq.input('ApproveStatus', sql.Int, 1); // 1 = Pending
            approveReq.input('CreateBy', sql.VarChar(20), employeeId);
            approveReq.input('CreateDate', sql.DateTime, new Date());
            
            const approveResult = await approveReq.query(`
                INSERT INTO MP_Approve (RefID, ApproveStatus, CreateBy, CreateDate)
                OUTPUT INSERTED.ApproveID
                VALUES (@RefID, @ApproveStatus, @CreateBy, @CreateDate)
            `);
            const approveId = approveResult.recordset[0].ApproveID;

            // 3. Get Flow from PIS
            const flow = await pisService.getApprovalFlow(employeeId, posCode);
            if (!flow || flow.length === 0) {
                throw new Error("Approval flow not found in PIS");
            }

            // 4. Insert Flow into MP_ApproveHist
            // First, Insert the Requester (Seqno = -1)
            const requesterReq = new sql.Request(transaction);
            requesterReq.input('ApproveID', sql.Decimal(18, 0), approveId);
            requesterReq.input('RefID', sql.Decimal(18, 0), manDriverId);
            requesterReq.input('Seqno', sql.Int, -1);
            requesterReq.input('INAME', sql.NVarChar(50), empInfo.INAME || '');
            requesterReq.input('FNAME', sql.NVarChar(100), empInfo.FNAME || '');
            requesterReq.input('LNAME', sql.NVarChar(100), empInfo.LNAME || '');
            requesterReq.input('POSCODE', sql.NVarChar(10), posCode);
            requesterReq.input('posname', sql.NVarChar(200), empInfo.posname || '');
            requesterReq.input('EmailAddr', sql.NVarChar(200), empInfo.EmailAddr || '');
            requesterReq.input('ApproveHistStatus', sql.Int, 1); // 1 = Requested/Approved
            requesterReq.input('ApproveHistDate', sql.DateTime, new Date());
            requesterReq.input('ApproveHistBy', sql.NVarChar(20), employeeId);

            await requesterReq.query(`
                INSERT INTO MP_ApproveHist 
                (ApproveID, RefID, Seqno, INAME, FNAME, LNAME, POSCODE, posname, EmailAddr, ApproveHistStatus, ApproveHistDate, ApproveHistBy)
                VALUES 
                (@ApproveID, @RefID, @Seqno, @INAME, @FNAME, @LNAME, @POSCODE, @posname, @EmailAddr, @ApproveHistStatus, @ApproveHistDate, @ApproveHistBy)
            `);

            // Insert Approvers (Seqno > 0)
            let seq = 1;
            for (const step of flow) {
                const stepReq = new sql.Request(transaction);
                stepReq.input('ApproveID', sql.Decimal(18, 0), approveId);
                stepReq.input('RefID', sql.Decimal(18, 0), manDriverId);
                stepReq.input('Seqno', sql.Int, seq++);
                stepReq.input('INAME', sql.NVarChar(50), step.INAME || '');
                stepReq.input('FNAME', sql.NVarChar(100), step.FNAME || '');
                stepReq.input('LNAME', sql.NVarChar(100), step.LNAME || '');
                stepReq.input('POSCODE', sql.NVarChar(10), step.POSCODE || '');
                stepReq.input('posname', sql.NVarChar(200), step.posname || '');
                stepReq.input('EmailAddr', sql.NVarChar(200), step.EmailAddr || '');
                stepReq.input('ApproveHistStatus', sql.Int, 0); // 0 = Pending

                await stepReq.query(`
                    INSERT INTO MP_ApproveHist 
                    (ApproveID, RefID, Seqno, INAME, FNAME, LNAME, POSCODE, posname, EmailAddr, ApproveHistStatus)
                    VALUES 
                    (@ApproveID, @RefID, @Seqno, @INAME, @FNAME, @LNAME, @POSCODE, @posname, @EmailAddr, @ApproveHistStatus)
                `);
            }

            // 5. Update MP_ManDriver Status to 2 (Waiting for Approve)
            const updateReq = new sql.Request(transaction);
            updateReq.input('ManDriverID', sql.Decimal(18, 0), manDriverId);
            updateReq.input('Status', sql.Int, 2);
            updateReq.input('UpdateBy', sql.VarChar(20), employeeId);
            updateReq.input('UpdateDate', sql.DateTime, new Date());
            await updateReq.query(`
                UPDATE MP_ManDriver 
                SET ManDriverStatus = @Status, UpdateBy = @UpdateBy, UpdateDate = @UpdateDate
                WHERE ManDriverID = @ManDriverID
            `);

            // 6. Send Mail to first approver
            const mailReq = new sql.Request(transaction);
            mailReq.input('ManDriverID', sql.Decimal(18, 0), manDriverId);
            mailReq.input('ApproveID', sql.Decimal(18, 0), approveId);
            mailReq.input('Seqno', sql.Int, 1);
            await mailReq.execute('mp_ManDriverSendMailNext');

            await transaction.commit();
            return { success: true, message: 'Approval request submitted successfully', approveId };
        } catch (error) {
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
