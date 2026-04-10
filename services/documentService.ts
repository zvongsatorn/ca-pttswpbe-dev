import { sql, poolPromise } from '../config/db.js';
import { sendMail, resolveMailRecipient } from './mailService.js';

export interface ApproverPayload {
    seqno: number;
    employeeId: string;
    fullname: string;
    email: string;
    userGroupNo?: string;
    unitSide?: string;
}

export interface DocumentItemPayload {
    itemId: string; // TransactionNo
    approvers: ApproverPayload[];
}

export interface SubmitDocumentPayload {
    documentType: number;
    userGroupNo?: string;
    items: DocumentItemPayload[];
    parentDocumentNo?: string;
}

export const submitDocumentService = async (payload: SubmitDocumentPayload, createBy: string) => {
    try {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Generate DocumentNo DA + YY + MM + Running
            const today = new Date();
            const adYY = today.getFullYear().toString().slice(-2);
            const mm = (today.getMonth() + 1).toString().padStart(2, '0');
            const prefix = `DA${adYY}${mm}`;

            const lastDocReq = new sql.Request(transaction);
            lastDocReq.input('Prefix', sql.VarChar(10), prefix);
            const lastDocRes = await lastDocReq.execute('mp_DocumentLastNoGet');

            let runningNumber = 1;
            if (lastDocRes.recordset && lastDocRes.recordset.length > 0 && lastDocRes.recordset[0].DocumentNo) {
                const lastDocNo = lastDocRes.recordset[0].DocumentNo; 
                const lastRunningStr = lastDocNo.substring(prefix.length); 
                if (!isNaN(parseInt(lastRunningStr))) {
                    runningNumber = parseInt(lastRunningStr) + 1;
                }
            }
            
            const documentNo = `${prefix}${runningNumber.toString().padStart(4, '0')}`;
            const effectiveDate = today;

            // 1. mp_DocumentInsert
            const docReq = new sql.Request(transaction);
            docReq.input('DocumentNo', sql.VarChar(13), documentNo);
            docReq.input('EffectiveDate', sql.DateTime, effectiveDate);
            docReq.input('DocumentType', sql.Int, payload.documentType);
            docReq.input('CreateBy', sql.VarChar(20), createBy);
            docReq.input('CreateDate', sql.DateTime, today);
            docReq.input('ParentDocumentNo', sql.VarChar(13), payload.parentDocumentNo || null);
            await docReq.execute('mp_DocumentInsert');

            // 2. mp_DocumentItemsInsert for each Item and Approver
            // First, lookup creator info from MP_User
            const creatorInfoReq = new sql.Request(transaction);
            creatorInfoReq.input('EmployeeID', sql.VarChar(20), createBy);
            const creatorInfoRes = await creatorInfoReq.execute('mp_UserInfoGet');
            const creatorFullname = creatorInfoRes.recordset?.[0]?.FullName || createBy;
            const creatorEmail = creatorInfoRes.recordset?.[0]?.Email || null;
            const creatorUserGroupNo = payload.userGroupNo || null;

            for (const item of payload.items) {
                // Insert Creator (Seqno = 0)
                const creatorReq = new sql.Request(transaction);
                creatorReq.input('DocumentNo', sql.VarChar(13), documentNo);
                creatorReq.input('ItemID', sql.VarChar(10), item.itemId);
                creatorReq.input('Seqno', sql.Int, 0);
                creatorReq.input('EmployeeID', sql.VarChar(20), createBy);
                creatorReq.input('Fullname', sql.NVarChar(200), creatorFullname);
                creatorReq.input('Email', sql.NVarChar(200), creatorEmail);
                creatorReq.input('UserGroupNo', sql.VarChar(2), creatorUserGroupNo);
                creatorReq.input('AuditStatus', sql.Int, 2); // Auto-approved for creator
                creatorReq.input('UnitSide', sql.NVarChar(50), null);
                await creatorReq.execute('mp_DocumentItemsInsert');

                for (const approver of item.approvers) {
                    const itemReq = new sql.Request(transaction);
                    itemReq.input('DocumentNo', sql.VarChar(13), documentNo);
                    itemReq.input('ItemID', sql.VarChar(10), item.itemId);
                    itemReq.input('Seqno', sql.Int, approver.seqno);
                    itemReq.input('EmployeeID', sql.VarChar(20), approver.employeeId);
                    itemReq.input('Fullname', sql.NVarChar(200), approver.fullname);
                    itemReq.input('Email', sql.NVarChar(200), approver.email);
                    itemReq.input('UserGroupNo', sql.VarChar(2), approver.userGroupNo || null);
                    itemReq.input('UnitSide', sql.NVarChar(50), approver.unitSide || null);
                    
                    // Set AuditStatus = 1 for the first approver, else 0
                    const auditStatus = approver.seqno === 1 ? 1 : 0;
                    itemReq.input('AuditStatus', sql.Int, auditStatus);

                    await itemReq.execute('mp_DocumentItemsInsert');
                }

                const trUpdateReq = new sql.Request(transaction);
                trUpdateReq.input('TransactionNo', sql.VarChar(10), item.itemId);
                trUpdateReq.input('Status', sql.Int, 2);
                trUpdateReq.input('UpdateBy', sql.VarChar(20), createBy);
                trUpdateReq.input('UpdateDate', sql.DateTime, today);
                await trUpdateReq.execute('mp_TransactionsUpdateStatus');
            }

            await transaction.commit();

            // Send notification emails to first approvers (Seqno 1)
            try {
                for (const item of payload.items) {
                    const firstApprover = item.approvers.find(a => a.seqno === 1);
                    if (firstApprover && firstApprover.email) {
                        const recipient = await resolveMailRecipient('SendMailTrans', firstApprover.email);
                        if (!recipient) continue;

                        const subject = `[PTTSWP] โปรดพิจารณาคำขอ ${documentNo}`;
                        const body = `
                            <h2>แจ้งเตือนการเสนออนุมัติระบบ PTTSWP</h2>
                            <p>เรียน คุณ ${firstApprover.fullname},</p>
                            <p>มีคำขอหมายเลข <b>${documentNo}</b> (รายการ: ${item.itemId}) รอการพิจารณาจากท่าน</p>
                            <p>ผู้เสนอ: ${creatorFullname}</p>
                            <p>วันที่มีผล: ${effectiveDate.toLocaleDateString('th-TH')}</p>
                            <p>โปรดตรวจสอบรายละเอียดที่: <a href="http://localhost:3000/mkd/inbox">PTTSWP Inbox</a></p>
                            <hr/>
                            <p style="color: gray; font-size: 12px;">นี่คือระบบเมลอัตโนมัติ โปรดติดต่อนักวิเคราะห์กำลังคนหากมีข้อสงสัย</p>
                        `;
                        await sendMail(recipient, subject, body);
                    }
                }
            } catch (mailError) {
                console.error('Email notification failed in submitDocumentService:', mailError);
                // We don't throw here to ensure the transaction commit is not affected by email failure
            }

            return { success: true, documentNo, message: 'Document submitted successfully' };
        } catch (error) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {}
            throw error;
        }
    } catch (error) {
        console.error('Error in submitDocumentService:', error);
        throw error;
    }
};

export const getInboxService = async (employeeId: string) => {
    try {
        const pool = await poolPromise;
        const req = new sql.Request(pool);
        
        req.input('EmployeeID', sql.VarChar(20), employeeId);
        req.input('AuditStatus', sql.Int, 1); // Active
        
        const result = await req.execute('mp_InboxGet');
        return result.recordset || [];
    } catch (error) {
        console.error('Error in getInboxService:', error);
        throw error;
    }
};

export const getInboxCountService = async (employeeId: string) => {
    try {
        const pool = await poolPromise;
        const req = new sql.Request(pool);
        
        req.input('EmployeeID', sql.VarChar(20), employeeId);
        req.input('AuditStatus', sql.Int, 1); // Active
        
        const result = await req.execute('mp_InboxCountGet');
        return result.recordset?.[0]?.UnreadCount || 0;
    } catch (error) {
        console.error('Error in getInboxCountService:', error);
        throw error;
    }
};

export const approveDocumentService = async (documentNo: string, itemId: string, seqno: number, updateBy: string) => {
    try {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const today = new Date();

            // 1. Update current approver to Accepted (2)
            const updateCurrentReq = new sql.Request(transaction);
            updateCurrentReq.input('DocumentNo', sql.VarChar(13), documentNo);
            updateCurrentReq.input('ItemID', sql.VarChar(10), itemId);
            updateCurrentReq.input('Seqno', sql.Int, seqno);
            updateCurrentReq.input('AuditStatus', sql.Int, 2); // 2 = Accepted
            updateCurrentReq.input('AuditDate', sql.DateTime, today);
            await updateCurrentReq.execute('mp_DocumentItemsUpdateAuditStatus');

            // 2. Check if there is a next approver
            const nextSeqnoReq = new sql.Request(transaction);
            nextSeqnoReq.input('DocumentNo', sql.VarChar(13), documentNo);
            nextSeqnoReq.input('ItemID', sql.VarChar(10), itemId);
            nextSeqnoReq.input('Seqno', sql.Int, seqno + 1);
            
            const nextSeqnoRes = await nextSeqnoReq.execute('mp_DocumentNextSeqnoGet');

            if (nextSeqnoRes.recordset && nextSeqnoRes.recordset.length > 0) {
                // Activate next approver
                const updateNextReq = new sql.Request(transaction);
                updateNextReq.input('DocumentNo', sql.VarChar(13), documentNo);
                updateNextReq.input('ItemID', sql.VarChar(10), itemId);
                updateNextReq.input('Seqno', sql.Int, seqno + 1);
                updateNextReq.input('AuditStatus', sql.Int, 1); // 1 = Active
                updateNextReq.input('AuditDate', sql.DateTime, null);
                await updateNextReq.execute('mp_DocumentItemsUpdateAuditStatus');
            } else {
                // Automatically check if all items in Document are completely approved
                const checkDocReq = new sql.Request(transaction);
                checkDocReq.input('DocumentNo', sql.VarChar(13), documentNo);
                const checkDocRes = await checkDocReq.execute('mp_DocumentPendingCheck');
                
                if (!checkDocRes.recordset || checkDocRes.recordset.length === 0) {
                    // All items are completely approved (or rejected).
                    // Update DocumentStatus to 2
                    const docUpdateReq = new sql.Request(transaction);
                    docUpdateReq.input('DocumentNo', sql.VarChar(13), documentNo);
                    docUpdateReq.input('DocumentStatus', sql.Int, 2); // 2 = Approved
                    docUpdateReq.input('UpdateBy', sql.VarChar(20), updateBy);
                    docUpdateReq.input('UpdateDate', sql.DateTime, today);
                    await docUpdateReq.execute('mp_DocumentUpdateStatus');
                    
                    const approvedItemsRes = await docUpdateReq.execute('mp_DocumentApprovedItemsGet');
                    
                    if (approvedItemsRes.recordset && approvedItemsRes.recordset.length > 0) {
                        for (const row of approvedItemsRes.recordset) {
                           const trUpdateReq = new sql.Request(transaction);
                           trUpdateReq.input('TransactionNo', sql.VarChar(10), row.ItemID);
                           trUpdateReq.input('Status', sql.Int, 3);
                           trUpdateReq.input('UpdateBy', sql.VarChar(20), updateBy);
                           trUpdateReq.input('UpdateDate', sql.DateTime, today);
                           await trUpdateReq.execute('mp_TransactionsUpdateStatus');
                        }
                    }
                }
            }

            await transaction.commit();

            // Send notification emails after successful commit
            try {
                if (nextSeqnoRes.recordset && nextSeqnoRes.recordset.length > 0) {
                    // Notify next approver
                    const nextApprover = nextSeqnoRes.recordset[0];
                    if (nextApprover.Email) {
                        const recipient = await resolveMailRecipient('SendMailTrans', nextApprover.Email);
                        if (recipient) {
                            const subject = `[PTTSWP] โปรดพิจารณาคำขอ ${documentNo}`;
                            const body = `
                                <h2>แจ้งเตือนการพิจารณาคำขอระบบ PTTSWP</h2>
                                <p>เรียน คุณ ${nextApprover.Fullname},</p>
                                <p>มีคำขอหมายเลข <b>${documentNo}</b> (รายการ: ${itemId}) รอการพิจารณาจากท่าน</p>
                                <p>โปรดตรวจสอบรายละเอียดที่: <a href="http://localhost:3000/mkd/inbox">PTTSWP Inbox</a></p>
                                <hr/>
                                <p style="color: gray; font-size: 12px;">นี่คือระบบเมลอัตโนมัติ</p>
                            `;
                            await sendMail(recipient, subject, body);
                        }
                    }
                } else {
                    // Full Approval - Notify Requester (Seqno 0)
                    const requesterReq = new sql.Request(pool);
                    requesterReq.input('DocumentNo', sql.VarChar(13), documentNo);
                    requesterReq.input('ItemID', sql.VarChar(10), itemId);
                    requesterReq.input('Seqno', sql.Int, 0);
                    const requesterRes = await requesterReq.execute('mp_DocumentItemApproverGet'); // Get creator info
                    
                    if (requesterRes.recordset && requesterRes.recordset.length > 0) {
                        const requester = requesterRes.recordset[0];
                        if (requester.Email) {
                            const recipient = await resolveMailRecipient('SendMailTrans', requester.Email);
                            if (recipient) {
                                const subject = `[PTTSWP] คำขอ ${documentNo} ได้รับการอนุมัติครบถ้วนแล้ว`;
                                const body = `
                                    <h2>แจ้งเตือนสถานะคำขอระบบ PTTSWP</h2>
                                    <p>เรียน คุณ ${requester.Fullname},</p>
                                    <p>คำขอหมายเลข <b>${documentNo}</b> (รายการ: ${itemId}) ของท่านได้รับการอนุมัติเรียบร้อยแล้ว</p>
                                    <p>โปรดตรวจสอบรายละเอียดที่: <a href="http://localhost:3000/mkd/my-requests">My Requests</a></p>
                                    <hr/>
                                    <p style="color: gray; font-size: 12px;">นี่คือระบบเมลอัตโนมัติ</p>
                                `;
                                await sendMail(recipient, subject, body);
                            }
                        }
                    }
                }
            } catch (mailError) {
                console.error('Email notification failed in approveDocumentService:', mailError);
            }

            return { success: true, message: 'Approved successfully' };
        } catch (error) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {}
            throw error;
        }
    } catch (error) {
        console.error('Error in approveDocumentService:', error);
        throw error;
    }
};

export const rejectDocumentService = async (documentNo: string, itemId: string, seqno: number, remark: string, updateBy: string) => {
    try {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const today = new Date();

            // 1. Update current and future approvers to Rejected (-1)
            const updateCurrentReq = new sql.Request(transaction);
            updateCurrentReq.input('DocumentNo', sql.VarChar(13), documentNo);
            updateCurrentReq.input('ItemID', sql.VarChar(10), itemId);
            updateCurrentReq.input('Seqno', sql.Int, seqno);
            updateCurrentReq.input('AuditStatus', sql.Int, -1); // -1 = Rejected
            updateCurrentReq.input('AuditDate', sql.DateTime, today);
            await updateCurrentReq.execute('mp_DocumentItemsUpdateAuditStatus');

            const updateFutureReq = new sql.Request(transaction);
            updateFutureReq.input('DocumentNo', sql.VarChar(13), documentNo);
            updateFutureReq.input('ItemID', sql.VarChar(10), itemId);
            updateFutureReq.input('Seqno', sql.Int, seqno);
            updateFutureReq.input('AuditDate', sql.DateTime, today);
            await updateFutureReq.execute('mp_DocumentItemsFutureRejectUpdate');

            // 2. Insert Remark
            const remarkReq = new sql.Request(transaction);
            remarkReq.input('DocumentNo', sql.VarChar(13), documentNo);
            remarkReq.input('ItemID', sql.VarChar(10), itemId);
            remarkReq.input('Remark', sql.NVarChar(500), remark);
            remarkReq.input('CreateBy', sql.VarChar(20), updateBy);
            remarkReq.input('CreateDate', sql.DateTime, today);
            await remarkReq.execute('mp_DocumentRemarkInsert');

            // 3. Update MP_Transactions Status to 0
            const trUpdateReq = new sql.Request(transaction);
            trUpdateReq.input('TransactionNo', sql.VarChar(10), itemId);
            trUpdateReq.input('Status', sql.Int, 0);
            trUpdateReq.input('UpdateBy', sql.VarChar(20), updateBy);
            trUpdateReq.input('UpdateDate', sql.DateTime, today);
            await trUpdateReq.execute('mp_TransactionsUpdateStatus');

            // 4. Check if the original DocumentNo is now fully approved or rejected
            const checkDocReq = new sql.Request(transaction);
            checkDocReq.input('DocumentNo', sql.VarChar(13), documentNo);
            const checkDocRes = await checkDocReq.execute('mp_DocumentPendingCheck');
            
            if (!checkDocRes.recordset || checkDocRes.recordset.length === 0) {
                // If no remaining active/pending items, update DocumentStatus
                const allRejectedRes = await checkDocReq.execute('mp_DocumentAllRejectedCheck');

                const docUpdateReq = new sql.Request(transaction);
                docUpdateReq.input('DocumentNo', sql.VarChar(13), documentNo);
                docUpdateReq.input('UpdateBy', sql.VarChar(20), updateBy);
                docUpdateReq.input('UpdateDate', sql.DateTime, today);

                if (!allRejectedRes.recordset || allRejectedRes.recordset.length === 0) {
                    // All rejected
                    docUpdateReq.input('DocumentStatus', sql.Int, 0); 
                } else {
                    docUpdateReq.input('DocumentStatus', sql.Int, 2); 
                }
                
                await docUpdateReq.execute('mp_DocumentUpdateStatus');
            }

            await transaction.commit();

            // Notify Requester about rejection
            try {
                const requesterReq = new sql.Request(pool);
                requesterReq.input('DocumentNo', sql.VarChar(13), documentNo);
                requesterReq.input('ItemID', sql.VarChar(10), itemId);
                requesterReq.input('Seqno', sql.Int, 0);
                const requesterRes = await requesterReq.execute('mp_DocumentItemApproverGet');
                
                if (requesterRes.recordset && requesterRes.recordset.length > 0) {
                    const requester = requesterRes.recordset[0];
                    if (requester.Email) {
                        const recipient = await resolveMailRecipient('SendMailTrans', requester.Email);
                        if (recipient) {
                            const subject = `[PTTSWP] คำขอ ${documentNo} ถูกส่งคืน (Rejected)`;
                            const body = `
                                <h2>แจ้งเตือนการส่งคืนคำขอระบบ PTTSWP</h2>
                                <p>เรียน คุณ ${requester.Fullname},</p>
                                <p>คำขอหมายเลข <b>${documentNo}</b> (รายการ: ${itemId}) ของท่านถูกส่งคืน/ไม่ได้รับการอนุมัติ</p>
                                <p><b>เหตุผล:</b> ${remark}</p>
                                <p>โปรดตรวจสอบและแก้ไขได้ที่: <a href="http://localhost:3000/mkd/my-requests">My Requests</a></p>
                                <hr/>
                                <p style="color: gray; font-size: 12px;">นี่คือระบบเมลอัตโนมัติ</p>
                            `;
                            await sendMail(recipient, subject, body);
                        }
                    }
                }
            } catch (mailError) {
                console.error('Email notification failed in rejectDocumentService:', mailError);
            }

            return { success: true, message: 'Rejected transaction successfully.' };
        } catch (error) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {}
            throw error;
        }
    } catch (error) {
        console.error('Error in rejectDocumentService:', error);
        throw error;
    }
};

export const getMyRequestsService = async (employeeId: string) => {
    try {
        const pool = await poolPromise;
        const req = new sql.Request(pool);
        
        req.input('EmployeeID', sql.VarChar(20), employeeId);
        
        const result = await req.execute('mp_MyRequestsGet');
        return result.recordset || [];
    } catch (error) {
        console.error('Error in getMyRequestsService:', error);
        throw error;
    }
};

export const getDocumentDetailService = async (documentNo: string, employeeId: string) => {
    try {
        const pool = await poolPromise;
        const req = new sql.Request(pool);
        req.input('DocumentNo', sql.VarChar(13), documentNo);

        // Get document info
        const docRes = await req.execute('mp_DocumentInfoGet');
        if (!docRes.recordset?.length) return null;
        const document = docRes.recordset[0];

        const itemsReq = new sql.Request(pool);
        itemsReq.input('DocumentNo', sql.VarChar(13), documentNo);
        itemsReq.input('EmployeeID', sql.VarChar(20), employeeId);
        const itemsRes = await itemsReq.execute('mp_DocumentItemsDetailGet');

        const logsReq = new sql.Request(pool);
        logsReq.input('DocumentNo', sql.VarChar(13), documentNo);
        const logsRes = await logsReq.execute('mp_DocumentLogsGet');

        return {
            document,
            items: itemsRes.recordset || [],
            logs: logsRes.recordset || []
        };
    } catch (error) {
        console.error('Error in getDocumentDetailService:', error);
        throw error;
    }
};

export const rejectAllDocumentService = async (documentNo: string, remark: string, updateBy: string) => {
    try {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        const today = new Date();

        try {
            // 1. Update Document Status to -1 (Rejected All)
            const docReq = new sql.Request(transaction);
            docReq.input('DocumentNo', sql.VarChar(13), documentNo);
            docReq.input('DocumentStatus', sql.Int, -1);
            docReq.input('UpdateBy', sql.VarChar(20), updateBy);
            docReq.input('UpdateDate', sql.DateTime, today);
            await docReq.execute('mp_DocumentUpdateStatus');

            // 2. Fetch all Items in Document
            const itemsReq = new sql.Request(transaction);
            itemsReq.input('DocumentNo', sql.VarChar(13), documentNo);
            const itemsRes = await itemsReq.query('SELECT DISTINCT ItemID FROM MP_DocumentItems WHERE DocumentNo = @DocumentNo');
            
            if (itemsRes.recordset && itemsRes.recordset.length > 0) {
                // 3. For each item, insert remark and update transaction status to 0
                for (const row of itemsRes.recordset) {
                    const itemId = row.ItemID;

                    // Insert Remark per item
                    const rmReq = new sql.Request(transaction);
                    rmReq.input('DocumentNo', sql.VarChar(13), documentNo);
                    rmReq.input('ItemID', sql.VarChar(10), itemId);
                    rmReq.input('Remark', sql.NVarChar(500), remark);
                    rmReq.input('CreateBy', sql.VarChar(10), updateBy);
                    rmReq.input('CreateDate', sql.DateTime, today);
                    await rmReq.execute('mp_DocumentRemarkInsert');

                    // Update MP_Transactions.Status = 0
                    const trUpdateReq = new sql.Request(transaction);
                    trUpdateReq.input('TransactionNo', sql.VarChar(10), itemId);
                    trUpdateReq.input('Status', sql.VarChar(20), '0');
                    trUpdateReq.input('UpdateBy', sql.VarChar(20), updateBy);
                    trUpdateReq.input('UpdateDate', sql.DateTime, today);
                    await trUpdateReq.execute('mp_TransactionsUpdateStatus');
                }
            }

            await transaction.commit();
            return { success: true, message: 'All items rejected successfully' };
        } catch (error) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {}
            throw error;
        }
    } catch (error) {
        console.error('Error in rejectAllDocumentService:', error);
        throw error;
    }
};

export const getProgressService = async (employeeId: string) => {
    try {
        const pool = await poolPromise;
        const req = new sql.Request(pool);
        req.input('EmployeeID', sql.VarChar(20), employeeId);

        const docsRes = await req.execute('mp_DocumentProgressListGet');
        if (!docsRes.recordset?.length) return [];

        const results = [];

        for (const doc of docsRes.recordset) {
            const docNo = doc.DocumentNo;

            const itemsReq = new sql.Request(pool);
            itemsReq.input('DocumentNo', sql.VarChar(13), docNo);
            itemsReq.input('EmployeeID', sql.VarChar(20), null);
            const itemsRes = await itemsReq.execute('mp_DocumentItemsDetailGet');

            // Get approval logs
            const logsReq = new sql.Request(pool);
            logsReq.input('DocumentNo', sql.VarChar(13), docNo);
            const logsQuery = `
                SELECT DISTINCT
                    di.Seqno,
                    di.EmployeeID,
                    di.Fullname,
                    di.AuditStatus,
                    di.AuditDate,
                    di.UserGroupNo,
                    di.UnitSide,
                    ug.UserGroupName
                FROM MP_DocumentItems di
                LEFT JOIN MP_UserGroup ug ON di.UserGroupNo = ug.UserGroupNo
                WHERE di.DocumentNo = @DocumentNo
                ORDER BY di.Seqno ASC
            `;
            const logsRes = await logsReq.query(logsQuery);

            // Determine process stage
            const hasActive = logsRes.recordset?.some((l: { AuditStatus: number }) => l.AuditStatus === 1);
            const allDone = logsRes.recordset?.every((l: { AuditStatus: number }) => l.AuditStatus === 2 || l.AuditStatus === -1);
            let processStage = 1;
            if (hasActive) processStage = 2;
            if (allDone && logsRes.recordset?.length > 0) processStage = 3;

            // Determine status label based on current active approver
            let statusLabel = 'Waiting';
            if (processStage === 3) {
                statusLabel = 'Complete';
            } else {
                const activeApprover = logsRes.recordset?.find((l: { AuditStatus: number; UserGroupName?: string }) => l.AuditStatus === 1);
                if (activeApprover?.UserGroupName) {
                    statusLabel = `Waiting ${activeApprover.UserGroupName}`;
                }
            }

            // Build first item description as resolution text
            const firstItem = itemsRes.recordset?.[0];
            const resolution = firstItem?.TransactionDesc || '';
            const category = firstItem?.TransactionType === 1 ? 'ภายใต้ ผช.' :
                             firstItem?.TransactionType === 2 ? 'โอนกรอบอื่นๆ' :
                             firstItem?.TransactionType === 3 ? 'ปรับสัดส่วน' :
                             firstItem?.TransactionType === 4 ? 'เพิ่ม/ลด' :
                             firstItem?.TransactionType === 6 ? 'ยืม' : 'อื่นๆ';

            const typeCategory = firstItem?.TransactionType === 1 ? 'transfer' :
                                 firstItem?.TransactionType === 4 ? 'add' :
                                 firstItem?.TransactionType === 3 ? 'adjust' : 'other';

            results.push({
                documentNo: docNo,
                effectiveDate: doc.EffectiveDate,
                documentType: doc.DocumentType,
                createDate: doc.CreateDate,
                createBy: doc.CreateBy,
                statusLabel,
                processStage,
                category,
                typeCategory,
                resolution,
                items: itemsRes.recordset || [],
                logs: logsRes.recordset || []
            });
        }

        return results;
    } catch (error) {
        console.error('Error in getProgressService:', error);
        throw error;
    }
};

export const getAllTransactionsService = async (employeeId: string) => {
    try {
        const pool = await poolPromise;
        const req = new sql.Request(pool);
        req.input('EmployeeID', sql.VarChar(20), employeeId);

        const docsRes = await req.execute('mp_AllDocumentsGet');
        if (!docsRes.recordset?.length) return [];

        const results = [];

        for (const doc of docsRes.recordset) {
            const docNo = doc.DocumentNo;

            // Get items (transactions) for this document
            const itemsReq = new sql.Request(pool);
            itemsReq.input('DocumentNo', sql.VarChar(13), docNo);
            itemsReq.input('EmployeeID', sql.VarChar(20), null);
            const itemsRes = await itemsReq.execute('mp_DocumentItemsDetailGet');

            // Get approval logs
            const logsReq = new sql.Request(pool);
            logsReq.input('DocumentNo', sql.VarChar(13), docNo);
            const logsRes = await logsReq.execute('mp_DocumentLogsGet');

            // Determine process stage
            const hasActive = logsRes.recordset?.some((l: { AuditStatus: number }) => l.AuditStatus === 1);
            const allDone = logsRes.recordset?.every((l: { AuditStatus: number }) => l.AuditStatus === 2 || l.AuditStatus === -1);
            let processStage = 1;
            if (hasActive) processStage = 2;
            if (allDone && logsRes.recordset?.length > 0) processStage = 3;

            // Determine status label based on current active approver or document status
            let statusLabel = 'Waiting';
            if (doc.DocumentStatus === -1) {
                statusLabel = 'Rejected';
            } else if (processStage === 3) {
                statusLabel = 'Complete';
            } else {
                const activeApprover = logsRes.recordset?.find((l: { AuditStatus: number; UserGroupName?: string }) => l.AuditStatus === 1);
                if (activeApprover?.UserGroupName) {
                    statusLabel = `Waiting ${activeApprover.UserGroupName}`;
                }
            }

            // Build first item description as resolution text
            const firstItem = itemsRes.recordset?.[0];
            const resolution = firstItem?.TransactionDesc || '';
            const category = firstItem?.TransactionType === 1 ? 'ภายใต้ ผช.' :
                             firstItem?.TransactionType === 2 ? 'โอนกรอบอื่นๆ' :
                             firstItem?.TransactionType === 3 ? 'ปรับสัดส่วน' :
                             firstItem?.TransactionType === 4 ? 'เพิ่ม/ลด' :
                             firstItem?.TransactionType === 6 ? 'ยืม' : 'อื่นๆ';

            const typeCategory = firstItem?.TransactionType === 1 ? 'transfer' :
                                 firstItem?.TransactionType === 4 ? 'add' :
                                 firstItem?.TransactionType === 3 ? 'adjust' : 'other';

            results.push({
                documentNo: docNo,
                effectiveDate: doc.EffectiveDate,
                documentType: doc.DocumentType,
                createDate: doc.CreateDate,
                createBy: doc.CreateBy,
                statusLabel,
                processStage,
                category,
                typeCategory,
                resolution,
                items: itemsRes.recordset || [],
                logs: logsRes.recordset || []
            });
        }

        return results;
    } catch (error) {
        console.error('Error in getAllTransactionsService:', error);
        throw error;
    }
};
