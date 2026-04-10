import { sql, poolPromise } from '../config/db.js';

export interface DraftTransactionPayload {
    transactionType: number;
    effectiveMonth: string;
    effectiveYear: string;
    poolRsFlag: number;
    strgFlag: number;
    bsType: number;
    specFlag: number;
    unitReceive: string;
    remark: string;
    lineStaffFlag: number;
    policyFlag: number;
    pastFlag: number;

    // detail
    levelGroupTo: string;
    levelGroupFrom: string;
    amount: number;
    conclusionNo: string;
    conclusionDate: string;
    unitTransfer: string;
    transferInd: number;
    
    
    // files
    fileName?: string;
    fileUrl?: string; // from upload
    refId?: string | number | null; // TransactionFileID for existing files

    // names for description
    unitReceiveName?: string;
    unitTransferName?: string;
    levelGroupFromName?: string;
    levelGroupToName?: string;
}

// Helper: look up a unit's display name via mp_UnitNameGet
const getUnitName = async (pool: typeof sql.ConnectionPool.prototype, effectiveDate: Date, unitNo: string): Promise<string> => {
    if (!unitNo) return '';
    try {
        const req = new sql.Request(pool);
        req.input('EffectiveDate', sql.DateTime, effectiveDate);
        req.input('UnitNo', sql.VarChar(8), unitNo);
        const res = await req.execute('mp_UnitNameGet');
        if (res.recordset && res.recordset.length > 0) {
            return res.recordset[0].UnitName || res.recordset[0].UnitShortName || unitNo;
        }
    } catch {
        // fallback to unit code
    }
    return unitNo;
};

export const saveDraftTransactionService = async (
    payload: DraftTransactionPayload, 
    createBy: string,
    existingTransactionNo?: string  // if provided, skip main insert and only insert file
) => {
    try {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Calculate EffectiveDate from month/year
            const monthNames = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
            const monthIndex = monthNames.indexOf(payload.effectiveMonth) + 1;
            const yearAD = parseInt(payload.effectiveYear) - 543;
            // First day of the effective month
            const effectiveDate = new Date(`${yearAD}-${monthIndex.toString().padStart(2, '0')}-01T00:00:00Z`);

            // Generate TransactionNo or use existing
            let transactionNo = '';
            
            if (existingTransactionNo) {
                transactionNo = existingTransactionNo;
            } else {
                const adYY = yearAD.toString().slice(-2);
                const mm = monthIndex.toString().padStart(2, '0');
                const prefix = `TR${adYY}${mm}`;

                // Get last TransactionNo with matching prefix
                const lastTrRes = await transaction.request()
                    .input('Prefix', sql.VarChar(10), prefix)
                    .execute('mp_TransactionsLastNoGet');

                let runningNumber = 1;
                if (lastTrRes.recordset && lastTrRes.recordset.length > 0 && lastTrRes.recordset[0].TransactionNo) {
                    const lastTrNo = lastTrRes.recordset[0].TransactionNo; // e.g. TR26010001
                    const lastRunningStr = lastTrNo.substring(prefix.length); // '0001'
                    if (!isNaN(parseInt(lastRunningStr))) {
                        runningNumber = parseInt(lastRunningStr) + 1;
                    }
                }
                
                transactionNo = `${prefix}${runningNumber.toString().padStart(4, '0')}`;
            }
            
            const status = 1; // 1 = Draft
            const createDate = new Date();

            if (!existingTransactionNo) {
                if (payload.transactionType === 5) {
                    await transaction.request()
                        .input('TransactionNo', sql.VarChar(10), transactionNo)
                        .input('OrgUnitNo', sql.VarChar(8), payload.unitReceive)
                        .input('Note', sql.NVarChar(500), payload.remark)
                        .input('Status', sql.Int, status)
                        .input('CreateBy', sql.VarChar(20), createBy)
                        .input('CreateDate', sql.DateTime, createDate)
                        .execute('mp_RemarkInsert');
                } else {
                    // mp_TransactionsInsert
                    const req = new sql.Request(transaction);
                    
                    // Build desc using real unit names from DB via mp_UnitNameGet
                    const conclusionPart = payload.conclusionNo ? `${payload.conclusionNo} : ` : '';
                    const unitTransferName = await getUnitName(pool, effectiveDate, payload.unitTransfer) || payload.unitTransferName || payload.unitTransfer;
                    const unitReceiveName = await getUnitName(pool, effectiveDate, payload.unitReceive) || payload.unitReceiveName || payload.unitReceive;
                    const levelToName = payload.levelGroupToName || payload.levelGroupTo;
                    const levelFromName = payload.levelGroupFromName || payload.levelGroupFrom;

                    let desc = '';
                    if (payload.transactionType === 1 || payload.transactionType === 2) {
                    desc = `${conclusionPart}หน่วยงาน${unitTransferName} โอนย้ายอัตรากำลังให้หน่วยงาน ${unitReceiveName} ที่ระดับ ${levelToName} จำนวน ${payload.amount || 0} อัตรา`;
                } else if (payload.transactionType === 3) {
                    desc = `${conclusionPart}หน่วยงาน${unitTransferName} ปรับเปลี่ยนอัตรากำลังจากระดับ ${levelFromName} ไปที่ระดับ ${levelToName} จำนวน ${payload.amount || 0} อัตรา`;
                } else if (payload.transactionType === 4) {
                    const typeAction = payload.transferInd === 1 ? 'เพิ่ม' : 'ลด';
                    desc = `${conclusionPart}หน่วยงาน${unitTransferName} ${typeAction}กรอบอัตรากำลัง ที่ระดับ ${levelToName} จำนวน ${payload.amount || 0} อัตรา`;
                } else if (payload.transactionType === 6) {
                    desc = `${conclusionPart}หน่วยงาน${unitTransferName} ให้ยืมอัตรากำลังกับหน่วยงาน ${unitReceiveName} จำนวน ${payload.amount || 0} อัตรา`;
                } else if (payload.transactionType === 7) {
                    desc = `${conclusionPart}หน่วยงาน${unitReceiveName} คืนกรอบอัตรากำลังให้หน่วยงาน ${unitTransferName} ที่ระดับ ${levelToName} จำนวน ${payload.amount || 0} อัตรา`;
                }
                
                // Truncate desc if it exceeds 500 characters
                if (desc.length > 500) {
                    desc = desc.substring(0, 500);
                }

                req.input('TransactionNo', sql.VarChar(10), transactionNo);
                req.input('EffectiveDate', sql.DateTime, effectiveDate);
                req.input('ConclusionNo', sql.NVarChar(100), payload.conclusionNo || '');
                req.input('ConclusionDate', sql.DateTime, payload.conclusionDate ? new Date(payload.conclusionDate) : new Date());
                req.input('TransactionDesc', sql.NVarChar(500), desc);
                req.input('TransactionType', sql.Int, payload.transactionType);
                req.input('Amount', sql.Int, payload.amount || 0);
                req.input('UnitReceive', sql.VarChar(8), payload.unitReceive || '');
                req.input('UnitTransfer', sql.VarChar(8), payload.unitTransfer || '');
                req.input('LevelGroupFrom', sql.VarChar(4), payload.levelGroupFrom || '');
                req.input('LevelGroupTo', sql.VarChar(4), payload.levelGroupTo || '');
                req.input('TransferInd', sql.Int, payload.transferInd || 0);
                req.input('Status', sql.Int, status);
                req.input('Policyflag', sql.Int, payload.policyFlag || 0);
                req.input('PoolRsFlag', sql.Int, payload.poolRsFlag || 0);
                req.input('StrgFlag', sql.Int, payload.strgFlag || 0);
                req.input('BSType', sql.Int, payload.bsType || 0);
                req.input('SpecFlag', sql.Int, payload.specFlag || 0);
                req.input('LineStaffFlag', sql.Int, payload.lineStaffFlag || 0);
                req.input('CreateBy', sql.VarChar(10), createBy.substring(0, 10)); // size limit 10
                req.input('CreateDate', sql.DateTime, createDate);
                
                await req.execute('mp_TransactionsInsert');
            }
        } // End of if (!existingTransactionNo)

        // mp_TransactionFileInsert (if file provided)
        if (payload.fileName && payload.fileName.trim() !== '') {
                await transaction.request()
                    .input('EffectiveDate', sql.DateTime, effectiveDate)
                    .input('TransactionNo', sql.VarChar(10), transactionNo)
                    .input('FileName', sql.NVarChar(100), payload.fileName)
                    .input('FileUpload', sql.NVarChar(50), payload.fileUrl)
                    .input('CreateBy', sql.VarChar(20), createBy)
                    .input('CreateDate', sql.DateTime, createDate)
                    .input('RefID', sql.Decimal(18,0), payload.refId ? payload.refId : null)
                    .execute('mp_TransactionFileInsert');
        }

            await transaction.commit();
            return { success: true, transactionNo, message: 'Draft saved successfully' };
            
        } catch (error) {
            await transaction.rollback();
            throw error;
        }

    } catch (error) {
        console.error('Error in saveDraftTransactionService:', error);
        throw error;
    }
};

export const getDraftTransactionsService = async (employeeId: string, effectiveDate: Date) => {
    try {
        const pool = await poolPromise;
        const req = new sql.Request(pool);
        
        req.input('EffectiveDate', sql.DateTime, effectiveDate);
        req.input('Status', sql.Int, 1); // 1 = Draft
        req.input('EmployeeID', sql.VarChar(10), employeeId);

        const result = await req.execute('mp_DraftTransactionsGet');
        
        if (!result || !result.recordset || result.recordset.length === 0) {
            return [];
        }

        const records = result.recordset;

        // Collect unique IDs to fetch names in parallel
        const levelGroupNos = new Set<string>();
        const unitNos = new Set<string>();
        records.forEach((r: any) => {
            if (r.LevelGroupTo) levelGroupNos.add(r.LevelGroupTo);
            if (r.LevelGroupFrom) levelGroupNos.add(r.LevelGroupFrom);
            if (r.UnitTransfer) unitNos.add(r.UnitTransfer);
            if (r.UnitReceive) unitNos.add(r.UnitReceive);
        });

        const levelGroupNameMap: Record<string, string> = {};
        const unitNameMap: Record<string, string> = {};

        // Fetch all names in parallel to avoid N+1 sequential DB calls
        await Promise.all([
            ...Array.from(levelGroupNos).map(async (lgNo) => {
                try {
                    const lgReq = new sql.Request(pool);
                    lgReq.input('LevelGroupNo', sql.VarChar(4), lgNo);
                    const lgRes = await lgReq.execute('mp_LevelGroupGetByNo');
                    levelGroupNameMap[lgNo] = lgRes.recordset?.[0]?.LevelGroupName || lgNo;
                } catch {
                    levelGroupNameMap[lgNo] = lgNo;
                }
            }),
            ...Array.from(unitNos).map(async (unitNo) => {
                unitNameMap[unitNo] = await getUnitName(pool, effectiveDate, unitNo);
            })
        ]);

        // Attach resolved names to records
        return records.map((r: any) => {
            let safeFileUrl = r.FileUpload || null;
            if (safeFileUrl && !safeFileUrl.startsWith('uploads/')) {
                safeFileUrl = `uploads/transactions/${safeFileUrl}`;
            }
            return {
                ...r,
                LevelGroupToName: r.LevelGroupTo ? (levelGroupNameMap[r.LevelGroupTo] || r.LevelGroupTo) : '',
                LevelGroupFromName: r.LevelGroupFrom ? (levelGroupNameMap[r.LevelGroupFrom] || r.LevelGroupFrom) : '',
                UnitTransferName: r.UnitTransfer ? (unitNameMap[r.UnitTransfer] || r.UnitTransfer) : '',
                UnitReceiveName: r.UnitReceive ? (unitNameMap[r.UnitReceive] || r.UnitReceive) : '',
                FileUpload: safeFileUrl
            };
        });
    } catch (error) {
        console.error('Error in getDraftTransactionsService:', error);
        throw error;
    }
};

export const getExistingFilesService = async (
    effectiveMonth: string,
    effectiveYear: string,
    employeeId: string
) => {
    try {
        const pool = await poolPromise;
        const req = new sql.Request(pool);

        // Calculate EffectiveDate from month/year
        const monthNames = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
        const monthIndex = monthNames.indexOf(effectiveMonth) + 1;
        const yearAD = parseInt(effectiveYear) - 543;
        const effectiveDate = new Date(`${yearAD}-${monthIndex.toString().padStart(2, '0')}-01T00:00:00Z`);

        req.input('EffectiveDate', sql.DateTime, effectiveDate);
        req.input('EmployeeID', sql.VarChar(20), employeeId);

        const result = await req.execute('mp_TransactionFilesByDateGet');
        
        if (result && result.recordset) {
            // Map the result to a usable format for the frontend
            return result.recordset.map(row => ({
               id: row.TransactionFileID,
               name: row.FileName,
               transactionNo: row.TransactionNo,
               conclusionNo: row.ConclusionNo,
               fileUrl: (row.FileUpload && !row.FileUpload.startsWith('uploads/')) ? `uploads/transactions/${row.FileUpload}` : row.FileUpload
            }));
        }

        return [];
    } catch (error) {
        console.error('Error in getExistingFilesService:', error);
        throw error;
    }
};

export const deleteDraftTransactionService = async (transactionNo: string, updateBy: string) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('TransactionNo', sql.VarChar(10), transactionNo)
            .input('Status', sql.Int, 0) // 0 = Deleted
            .input('UpdateBy', sql.VarChar(20), updateBy)
            .input('UpdateDate', sql.DateTime, new Date())
            .execute('mp_TransactionsUpdateStatus');
        return { success: true };
    } catch (error) {
        console.error('Error in deleteDraftTransactionService:', error);
        throw error;
    }
};

export interface CheckFlowParams {
    jobType: number;
    userGroupReceive: string;
    orgUnitNoReceive: string;
    levelGroupNoFrom: string;
    orgUnitNoTransfer: string | null;
    levelGroupNoTo: string;
    effectiveDate: string | Date;
    isRequirePolicy: number;
}

export const getApproversFlowService = async (params: CheckFlowParams) => {
    try {
        const pool = await poolPromise;
        const req = new sql.Request(pool);
        
        req.input('JobType', sql.Int, params.jobType);
        req.input('UserGroupReceive', sql.VarChar(2), params.userGroupReceive);
        req.input('OrgUnitNoReceive', sql.VarChar(20), params.orgUnitNoReceive);
        req.input('LevelGroupNoFrom', sql.VarChar(20), params.levelGroupNoFrom);
        req.input('OrgUnitNoTransfer', sql.VarChar(20), params.orgUnitNoTransfer);
        req.input('LevelGroupNoTo', sql.VarChar(20), params.levelGroupNoTo);
        req.input('EffectiveDate', sql.Date, params.effectiveDate);
        req.input('IsRequirePolicy', sql.Bit, params.isRequirePolicy);

        const result = await req.execute('mp_CheckFlow');
        
        if (!result || !result.recordset) {
            return [];
        }

        return result.recordset;
    } catch (error) {
        console.error('Error in getApproversFlowService:', error);
        throw error;
    }
};

export const directApproveTransactionsService = async (transactionNos: string[], updateBy: string) => {
    try {
        const pool = await poolPromise;
        const today = new Date();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            for (const txNo of transactionNos) {
                const req = new sql.Request(transaction);
                req.input('TransactionNo', sql.VarChar(10), txNo);
                req.input('UpdateBy', sql.VarChar(20), updateBy);
                req.input('UpdateDate', sql.DateTime, today);
                await req.execute('mp_TransactionsDirectApprove');
            }
            await transaction.commit();
            return { success: true, message: 'Transactions approved successfully.' };
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    } catch (error) {
        console.error('Error in directApproveTransactionsService:', error);
        throw error;
    }
};

/**
 * Fetch approved borrow transactions (TransactionType=6, Status=3)
 * along with already-returned amounts (TransactionType=7)
 */
export const getBorrowTransactionsService = async (employeeId?: string) => {
    try {
        const pool = await poolPromise;
        const req = new sql.Request(pool);

        // Get all approved borrow transactions
        // Optionally filter by employeeId if provided
        let whereClause = `WHERE t.TransactionType = 6 AND t.Status = 3`;
        if (employeeId) {
            req.input('EmployeeID', sql.VarChar(20), employeeId);
            // Don't filter by employee, show all approved borrows so any HR can return
        }

        const result = await req.execute('mp_BorrowTransactionsGet');
        if (!result.recordset?.length) return [];

        // Enrich with unit names and level names
        const records = result.recordset;
        const unitNos = new Set<string>();
        const levelGroupNos = new Set<string>();

        records.forEach((r: { UnitTransfer?: string; UnitReceive?: string; LevelGroupTo?: string; LevelGroupFrom?: string }) => {
            if (r.UnitTransfer) unitNos.add(r.UnitTransfer);
            if (r.UnitReceive) unitNos.add(r.UnitReceive);
            if (r.LevelGroupTo) levelGroupNos.add(r.LevelGroupTo);
            if (r.LevelGroupFrom) levelGroupNos.add(r.LevelGroupFrom);
        });

        // Resolve unit names
        const unitNameMap: Record<string, string> = {};
        for (const unitNo of unitNos) {
            const effDate = records[0]?.EffectiveDate || new Date();
            unitNameMap[unitNo] = await getUnitName(pool, effDate, unitNo);
        }

        // Resolve level group names
        const levelGroupNameMap: Record<string, string> = {};
        for (const lgNo of levelGroupNos) {
            try {
                const lgReq = new sql.Request(pool);
                lgReq.input('LevelGroupNo', sql.VarChar(4), lgNo);
                const lgRes = await lgReq.execute('mp_LevelGroupGetByNo');
                if (lgRes.recordset?.length > 0) {
                    levelGroupNameMap[lgNo] = lgRes.recordset[0].LevelGroupName || lgNo;
                }
            } catch {
                levelGroupNameMap[lgNo] = lgNo;
            }
        }

        const enriched = records.map((r: { LevelGroupTo?: string; LevelGroupFrom?: string; UnitTransfer?: string; UnitReceive?: string; Amount?: number; TotalReturned?: number; [key: string]: unknown }) => ({
            ...r,
            LevelGroupToName: r.LevelGroupTo ? (levelGroupNameMap[r.LevelGroupTo] || r.LevelGroupTo) : '',
            LevelGroupFromName: r.LevelGroupFrom ? (levelGroupNameMap[r.LevelGroupFrom] || r.LevelGroupFrom) : '',
            UnitTransferName: r.UnitTransfer ? (unitNameMap[r.UnitTransfer] || r.UnitTransfer) : '',
            UnitReceiveName: r.UnitReceive ? (unitNameMap[r.UnitReceive] || r.UnitReceive) : '',
            RemainingCount: (r.Amount || 0) - (r.TotalReturned || 0),
        }));

        return enriched;
    } catch (error) {
        console.error('Error in getBorrowTransactionsService:', error);
        throw error;
    }
};

/**
 * Fetch return transactions (TransactionType=7) linked to a borrow document
 */
export const getReturnsByBorrowService = async (borrowDocumentNo: string) => {
    try {
        const pool = await poolPromise;
        const req = new sql.Request(pool);
        req.input('ParentDocumentNo', sql.VarChar(13), borrowDocumentNo);

        const result = await req.execute('mp_ReturnsByBorrowGet');
        return result.recordset || [];
    } catch (error) {
        console.error('Error in getReturnsByBorrowService:', error);
        throw error;
    }
};

export const getHRCenterDataService = async (
    viewMode: 'all' | 'department',
    effectiveDate: string | Date,
    employeeId: string,
    userGroupNo: string
) => {
    try {
        const pool = await poolPromise;
        const req = new sql.Request(pool);
        
        req.input('EffectiveDate', sql.DateTime, effectiveDate);
        req.input('EmployeeID', sql.VarChar(10), employeeId);
        req.input('UserGroupNO', sql.VarChar(2), userGroupNo);

        let result;
        if (viewMode === 'department') {
            result = await req.execute('mp_HRCenter_OrgUnit_GetTrans');
        } else {
            result = await req.execute('mp_HRCenter_OrgUnit_GetAll');
        }

        if (!result || !result.recordset) {
            return [];
        }

        return result.recordset;
    } catch (error) {
        console.error('Error in getHRCenterDataService:', error);
        throw error;
    }
};
