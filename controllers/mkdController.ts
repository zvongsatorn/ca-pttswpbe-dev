import { Context } from 'hono';
import { randomUUID } from 'crypto';
import {
    getStartYearService,
    getHistoryManDriverService,
    checkDupManDriverService,
    insertManDriverService,
    getMKDDetailsService,
    createMainKeyService,
    updateMainKeyService,
    createDetailKeyService,
    updateDetailKeyService,
    deleteKeyService,
    uploadFileService,
    deleteFileService,
    getMasterKeysService,
    updateManDriverStatusService,
    getHeadCountService,
    updateHeadCountService,
    updateUnitNameService,
    updateNoteService,
    getHistoryManDriverApproveService,
    getFlowHistoryService,
    approveManDriverService,
    getMKDDashboardService,
    updateProductivityRateService,
    requestApproveMKDService,
    exportListKeymanService,
    createMasterKeyMasterService,
    updateMasterKeyMasterService,
    exportPositionService,
    getInboxManDriverService,
    getMyRequestsMKDService,
    submitMKDApproveActionService,
    copyMKDService,
    getMKDHistoryService,
    cancelMKDService
} from '../services/mkdService.js';

export const getStartYear = async (c: Context) => {
    try {
        const result = await getStartYearService();
        return c.json({
            success: true,
            data: result
        }, 200);
    } catch (error: any) {
        console.error('Error fetching StartYear:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while fetching StartYear',
            error: error.message 
        }, 500);
    }
};

export const getMasterKeys = async (c: Context) => {
    try {
        const result = await getMasterKeysService();
        return c.json({
            success: true,
            data: result
        }, 200);
    } catch (error: any) {
        console.error('Error fetching MasterKeys:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while fetching MasterKeys',
            error: error.message 
        }, 500);
    }
};

export const getHistoryManDriver = async (c: Context) => {
    try {
        const effectiveMonth = c.req.query('EffectiveMonth');
        const effectiveYear = c.req.query('EffectiveYear') || new Date().getFullYear().toString();
        const requestType = c.req.query('RequestType') ? parseInt(c.req.query('RequestType') as string) : 1;
        const employeeId = c.req.query('EmployeeID') || '';
        const orgUnitNo = c.req.query('OrgUnitNo') || '';
        const userGroupNo = c.req.query('UserGroupNo') || '';
        const division = c.req.query('division') || '';

        if (!effectiveYear) {
            return c.json({ message: 'Missing EffectiveYear parameter' }, 400);
        }

        const result = await getHistoryManDriverService(
            effectiveMonth,
            effectiveYear,
            requestType,
            employeeId,
            orgUnitNo,
            userGroupNo,
            division
        );
        
        return c.json({
            success: true,
            data: result
        }, 200);
    } catch (error: any) {
        console.error('Error fetching HistoryManDriver:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while fetching history',
            error: error.message 
        }, 500);
    }
};

export const checkDupManDriver = async (c: Context) => {
    try {
        const body = await c.req.json();
        const effectiveYear = body.EffectiveYear || body.effectiveYear;
        const requestType = body.RequestType || body.requestType || 1;
        const orgUnitNo = body.OrgUnitNo !== undefined ? body.OrgUnitNo : (body.orgUnitNo || '');
        const orgUnitName = body.OrgUnitName || body.orgUnitName || '';

        if (!effectiveYear || (orgUnitNo === '' && orgUnitName === '')) {
            return c.json({ message: 'Missing required parameters' }, 400);
        }

        const isDup = await checkDupManDriverService(
            effectiveYear,
            requestType,
            orgUnitNo,
            orgUnitName
        );
        
        return c.json({
            success: true,
            isDuplicate: isDup
        }, 200);
    } catch (error: any) {
        console.error('Error checking duplicate ManDriver:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while checking duplicate',
            error: error.message 
        }, 500);
    }
};

export const createManDriver = async (c: Context) => {
    try {
        const body = await c.req.json();
        const effectiveYear = body.EffectiveYear || body.effectiveYear;
        const requestType = body.RequestType || body.requestType || 1;
        const orgUnitNo = body.OrgUnitNo !== undefined ? body.OrgUnitNo : (body.orgUnitNo || '');
        const orgUnitName = body.OrgUnitName || body.orgUnitName || '';
        const createBy = body.CreateBy || body.createBy;

        if (!effectiveYear || (orgUnitNo === '' && orgUnitName === '') || !createBy) {
            return c.json({ message: 'Missing required parameters' }, 400);
        }

        const result = await insertManDriverService(
            effectiveYear,
            requestType,
            orgUnitNo,
            orgUnitName,
            createBy
        );
        
        return c.json({
            success: true,
            data: result
        }, 201);
    } catch (error: any) {
        console.error('Error inserting ManDriver:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while creating record',
            error: error.message 
        }, 500);
    }
};

export const getMKDDetails = async (c: Context) => {
    try {
        const id = c.req.param('id');
        if (!id) {
            return c.json({ message: 'Missing MKD ID' }, 400);
        }

        const result = await getMKDDetailsService(id);
        
        return c.json({
            success: true,
            data: result
        }, 200);
    } catch (error: any) {
        console.error('Error fetching MKD Details:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while fetching MKD details',
            error: error.message 
        }, 500);
    }
};

export const upsertMainKey = async (c: Context) => {
    try {
        const id = c.req.param('id');
        const body = await c.req.json();

        if (!id) {
             return c.json({ message: 'Missing MKD ID' }, 400);
        }

        const {
            manDriverKeyId,
            keyManId,
            unit,
            keyType,
            weight,
            user,
            insertType,
            effectiveYear,
            parentId
        } = body;

        if (manDriverKeyId) {
             // Update
             await updateMainKeyService(manDriverKeyId, unit, keyType, weight, user || 'SYSTEM');
        } else {
             // Insert
             await createMainKeyService(
                 id, 
                 keyManId, 
                 unit, 
                 keyType, 
                 weight, 
                 user || 'SYSTEM', 
                 insertType, 
                 effectiveYear, 
                 parentId
             );
        }

        return c.json({ success: true, message: 'Main key saved' }, 200);

    } catch (error: any) {
        console.error('Error upserting main key:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while saving main key',
            error: error.message 
        }, 500);
    }
};

export const updateDetailKey = async (c: Context) => {
    try {
        const id = c.req.param('id');
        const body = await c.req.json();

        if (!id) {
             return c.json({ message: 'Missing MKD ID' }, 400);
        }

        const {
            manDriverKeyId,
            definition,
            coefficient,
            remark,
            user,
            yearlyData, // Expected format: [{ id: ManDriverKeyYearID, year: '2565', amount: 10 }, ...]
            insertType,
            effectiveYear
        } = body;

        if (!manDriverKeyId) {
             return c.json({ message: 'Missing Key ID' }, 400);
        }

        if (insertType === 2 || insertType === '2') {
            await createDetailKeyService(
                id,
                manDriverKeyId, // This is parentId in insert case
                definition,
                coefficient,
                remark,
                user || 'SYSTEM',
                effectiveYear,
                yearlyData
            );
        } else {
            await updateDetailKeyService(
                id,
                manDriverKeyId,
                definition,
                coefficient,
                remark,
                user || 'SYSTEM',
                yearlyData
            );
        }

        return c.json({ success: true, message: 'Detail key saved' }, 200);

    } catch (error: any) {
        console.error('Error updating detail key:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while updating detail key',
            error: error.message 
        }, 500);
    }
};

export const deleteKey = async (c: Context) => {
    try {
        const id = c.req.param('id');
        const keyId = c.req.param('keyId');
        const user = c.req.query('user') || 'SYSTEM';

        if (!id || !keyId) {
             return c.json({ message: 'Missing IDs' }, 400);
        }

        await deleteKeyService(keyId, user);
        return c.json({ success: true, message: 'Key deleted' }, 200);

    } catch (error: any) {
        console.error('Error deleting key:', error);
        return c.json({ success: false, message: 'Internal server error' }, 500);
    }
};

import * as fs from 'fs';
import * as path from 'path';

export const uploadFile = async (c: Context) => {
    try {
        const id = c.req.param('id');
        const body = await c.req.parseBody();
        const file = body['file'] as any; 
        const user = body['user'] as string || 'SYSTEM';
        const customFileName = body['fileName'] as string;
        
        if (!file) {
            return c.json({ message: 'No file uploaded' }, 400);
        }

        const fileName = file.name;
        const displayFileName = customFileName || fileName;
        const fileBuffer = await file.arrayBuffer();
        
        // Fetch RequestNo to use as folder name
        const details = await getMKDDetailsService(id);
        const requestNo = details?.header?.RequestNo || `ID_${id}`;
        
        const uploadDir = path.join(process.cwd(), 'uploads', 'mkd', requestNo);
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        
        let extension = path.extname(fileName).toLowerCase();
        if (!extension) extension = ".pdf";
        
        const safeName = `${randomUUID()}${extension}`;
        const filePath = path.join(uploadDir, safeName);
        fs.writeFileSync(filePath, Buffer.from(fileBuffer));
        
        // Save ONLY the filename in FileUpload column to match 50-char limit
        await uploadFileService(id, displayFileName, safeName, user);
        return c.json({ success: true, message: "File uploaded" }, 200);

    } catch (error: any) {
        console.error('Error uploading file:', error);
        return c.json({ success: false, message: 'Internal server error' }, 500);
    }
};

export const deleteFile = async (c: Context) => {
    try {
        const id = c.req.param('id');
        const fileId = c.req.param('fileId');

        if (!id || !fileId) {
             return c.json({ message: 'Missing IDs' }, 400);
        }

        await deleteFileService(fileId);
        return c.json({ success: true, message: 'File deleted' }, 200);

    } catch (error: any) {
        console.error('Error deleting file:', error);
        return c.json({ success: false, message: 'Internal server error' }, 500);
    }
};

export const updateManDriverStatus = async (c: Context) => {
    try {
        const id = c.req.param('id');
        const body = await c.req.json();
        const { status, user } = body;

        if (!id || status === undefined) {
             return c.json({ message: 'Missing ID or Status' }, 400);
        }

        await updateManDriverStatusService(id, status, user || 'SYSTEM');
        return c.json({ success: true, message: 'Status updated' }, 200);

    } catch (error: any) {
        console.error('Error updating status:', error);
        return c.json({ success: false, message: 'Internal server error' }, 500);
    }
};

export const getHeadCount = async (c: Context) => {
    try {
        const id = c.req.param('id');
        const effectiveYearStr = c.req.query('effectiveYear');
        const effectiveYear = effectiveYearStr ? parseInt(effectiveYearStr) : 0;

        if (!id) {
            return c.json({ message: 'Missing MKD ID' }, 400);
        }

        let year = effectiveYear;
        if (year === 0) {
            const details = await getMKDDetailsService(id);
            year = details?.header?.EffectiveYear || 0;
        }

        const result = await getHeadCountService(id, year);
        return c.json({
            success: true,
            data: result
        }, 200);
    } catch (error: any) {
        console.error('Error fetching HeadCount:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while fetching HeadCount',
            error: error.message 
        }, 500);
    }
};

export const updateHeadCount = async (c: Context) => {
    try {
        const id = c.req.param('id');
        const body = await c.req.json();
        const { data } = body;

        if (!id || !data) {
            return c.json({ message: 'Missing ID or Data' }, 400);
        }

        await updateHeadCountService(id, data);
        return c.json({ success: true, message: 'HeadCount updated' }, 200);
    } catch (error: any) {
        console.error('Error updating HeadCount:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while updating HeadCount',
            error: error.message 
        }, 500);
    }
};

export const updateUnitName = async (c: Context) => {
    try {
        const id = c.req.param('id');
        const body = await c.req.json();
        const { orgUnitName, user } = body;

        if (!id || !orgUnitName) {
            return c.json({ message: 'Missing ID or OrgUnitName' }, 400);
        }

        await updateUnitNameService(id, orgUnitName, user || 'SYSTEM');
        return c.json({ success: true, message: 'Unit name updated' }, 200);
    } catch (error: any) {
        console.error('Error updating UnitName:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while updating UnitName',
            error: error.message 
        }, 500);
    }
};

export const updateNote = async (c: Context) => {
    try {
        const id = c.req.param('id');
        const body = await c.req.json();
        const { note } = body;

        if (!id) {
            return c.json({ message: 'Missing ID' }, 400);
        }

        await updateNoteService(id, note);
        return c.json({ success: true, message: 'Note updated' }, 200);
    } catch (error: any) {
        console.error('Error updating Note:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while updating Note',
            error: error.message 
        }, 500);
    }
};

export const getMKDDashboardData = async (c: Context) => {
    try {
        const id = c.req.param('id');
        if (!id) {
            return c.json({ message: 'Missing MKD ID' }, 400);
        }

        const result = await getMKDDashboardService(id);
        
        return c.json({
            success: true,
            data: result
        }, 200);
    } catch (error: any) {
        console.error('Error fetching MKD Dashboard:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while fetching MKD dashboard',
            error: error.message 
        }, 500);
    }
};

export const updateProductivityRate = async (c: Context) => {
    try {
        const id = c.req.param('id');
        const body = await c.req.json();
        const { data } = body;

        if (!id || !data) {
            return c.json({ message: 'Missing ID or Data' }, 400);
        }

        await updateProductivityRateService(id, data);
        return c.json({ success: true, message: 'Productivity Rate updated' }, 200);
    } catch (error: any) {
        console.error('Error updating Productivity Rate:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while updating Productivity Rate',
            error: error.message 
        }, 500);
    }
};

export const getHistoryApprove = async (c: Context) => {
    try {
        const query = c.req.query();
        const effectiveYear = query.EffectiveYear || new Date().getFullYear().toString();
        const month = query.EffectiveMonth;
        const employeeId = query.EmployeeID || '';
        const orgUnitNo = query.OrgUnitNo || '';
        const userGroupNo = query.UserGroupNo || '';
        const division = query.division || '';

        const result = await getHistoryManDriverApproveService(
            month,
            effectiveYear,
            1,
            employeeId,
            orgUnitNo,
            userGroupNo,
            division
        );
        return c.json({ success: true, data: result }, 200);
    } catch (error: any) {
        console.error('Error fetching history-approve:', error);
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};

export const getInboxManDriver = async (c: Context) => {
    try {
        const employeeId = c.req.query('employeeId') || '';
        if (!employeeId) return c.json({ message: 'Missing employeeId' }, 400);
        
        const result = await getInboxManDriverService(employeeId);
        return c.json({ success: true, data: result }, 200);
    } catch (error: any) {
        console.error('Error fetching inbox man driver:', error);
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};

export const getMyRequestsMKD = async (c: Context) => {
    try {
        const employeeId = c.req.query('employeeId') || '';
        if (!employeeId) return c.json({ message: 'Missing employeeId' }, 400);
        
        const result = await getMyRequestsMKDService(employeeId);
        return c.json({ success: true, data: result }, 200);
    } catch (error: any) {
        console.error('Error fetching my requests mkd:', error);
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};

export const getFlowHistory = async (c: Context) => {
    try {
        const id = c.req.param('id');
        const approveId = c.req.query('approveId') || '0';
        if (!id) return c.json({ message: 'Missing MKD ID' }, 400);
        const result = await getFlowHistoryService(id, approveId);
        return c.json({ success: true, data: result }, 200);
    } catch (error: any) {
        console.error('Error fetching flow history:', error);
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};

export const approveManDriver = async (c: Context) => {
    try {
        const id = c.req.param('id');
        const body = await c.req.parseBody();
        
        const approveId = body['approveId'] as string || '0';
        const status = parseInt(body['status'] as string) || 3;
        const remark = body['remark'] as string || '';
        const conclusionNo = body['conclusionNo'] as string || '';
        const mkdApproveCount = parseInt(body['mkdApproveCount'] as string) || 0;
        const file = body['file'] as any;
        const updateBy = body['updateBy'] as string || 'SYSTEM';

        if (!id) return c.json({ message: 'Missing MKD ID' }, 400);

        let safeName = '';
        let displayFileName = '';

        if (file && file instanceof File) {
            displayFileName = file.name;
            const fileBuffer = await file.arrayBuffer();
            
            // Fetch RequestNo for folder
            const details = await getMKDDetailsService(id);
            const requestNo = details?.header?.RequestNo || `ID_${id}`;
            
            const uploadDir = path.join(process.cwd(), 'uploads', 'mkd', requestNo);
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }
            
            let extension = path.extname(displayFileName).toLowerCase();
            if (!extension) extension = ".pdf";
            
            safeName = `${randomUUID()}${extension}`;
            const filePath = path.join(uploadDir, safeName);
            fs.writeFileSync(filePath, Buffer.from(fileBuffer));
        }

        await approveManDriverService(
            id, 
            conclusionNo, 
            updateBy,
            mkdApproveCount,
            status,
            displayFileName,
            safeName
        );

        return c.json({ success: true, message: 'Approved successfully' }, 200);
    } catch (error: any) {
        console.error('Error approving ManDriver:', error);
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};

export const getFile = async (c: Context) => {
    try {
        const id = c.req.param('id');
        const fileId = c.req.param('fileId');

        if (!id || !fileId) {
            return c.json({ message: 'Missing parameters' }, 400);
        }

        // Fetch RequestNo to find the correct folder
        const details = await getMKDDetailsService(id);
        const requestNo = details?.header?.RequestNo || `ID_${id}`;
        
        const filePath = path.join(process.cwd(), 'uploads', 'mkd', requestNo, fileId);
        console.log('[DEBUG] getFile:', { id, fileId, requestNo, filePath, exists: fs.existsSync(filePath) });
        
        if (!fs.existsSync(filePath)) {
            return c.json({ message: 'File not found' }, 404);
        }

        const fileBuffer = fs.readFileSync(filePath);
        return c.body(fileBuffer, 200, {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="${fileId}"`
        });
    } catch (error: any) {
        console.error('Error getting file:', error);
        return c.json({ success: false, message: 'Internal server error' }, 500);
    }
};

export const filesProxy = async (c: Context) => {
    try {
        const filePathParam = c.req.query('path');
        if (!filePathParam) {
            return c.json({ message: 'Missing path parameter' }, 400);
        }

        // Basic safety check: Prevent directory traversal
        if (filePathParam.includes('..')) {
            return c.json({ message: 'Invalid path' }, 403);
        }

        const fullPath = path.join(process.cwd(), 'uploads', 'mkd', filePathParam);
        
        if (!fs.existsSync(fullPath)) {
            console.log('[Proxy Logic] File not found:', fullPath);
            return c.json({ message: 'File not found' }, 404);
        }

        const fileBuffer = fs.readFileSync(fullPath);
        const fileName = path.basename(fullPath);
        const extension = path.extname(fileName).toLowerCase();

        // Map extension to content type
        let contentType = 'application/octet-stream';
        if (extension === '.pdf') contentType = 'application/pdf';
        else if (extension === '.jpg' || extension === '.jpeg') contentType = 'image/jpeg';
        else if (extension === '.png') contentType = 'image/png';
        else if (extension === '.xlsx') contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

        return c.body(fileBuffer, 200, {
            'Content-Type': contentType,
            'Content-Disposition': `inline; filename="${fileName}"`
        });
    } catch (error: any) {
        console.error('Error in filesProxy:', error);
        return c.json({ success: false, message: 'Internal server error' }, 500);
    }
};

export const requestApproveMKD = async (c: Context) => {
    const id = c.req.param('id');
    try {
        const body = await c.req.json();
        const { user, approveId } = body;

        if (!id || !user) {
            return c.json({ success: false, message: 'Missing required parameters' }, 400);
        }

        const result = await requestApproveMKDService(id, user, approveId);
        return c.json(result, 200);
    } catch (error: any) {
        console.error('Error in requestApproveMKD controller:', error);
        return c.json({ 
            success: false, 
            message: error.message || 'เกิดข้อผิดพลาดในการส่งคำขออนุมัติ'
        }, 400); // 400 since it is likely a data or flow issue, not server crash
    }
};

export const exportListKeyman = async (c: Context) => {
    try {
        const result = await exportListKeymanService();
        return c.json({
            success: true,
            data: result
        }, 200);
    } catch (error: any) {
        console.error('Error exporting MKD List:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while exporting MKD list',
            error: error.message 
        }, 500);
    }
};

export const createMasterKeyMaster = async (c: Context) => {
    try {
        const body = await c.req.json();
        const keyManName = body.KeyManName || body.keyManName;
        const createBy = body.CreateBy || body.createBy || 'SYSTEM';

        if (!keyManName) {
            return c.json({ message: 'Missing KeyManName' }, 400);
        }

        await createMasterKeyMasterService(keyManName, createBy);
        
        return c.json({ success: true, message: 'Master Key created' }, 201);
    } catch (error: any) {
        console.error('Error creating Master Key:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while creating Master Key',
            error: error.message 
        }, 500);
    }
};

export const updateMasterKeyMaster = async (c: Context) => {
    try {
        const id = c.req.param('id');
        const body = await c.req.json();
        const updateBy = body.UpdateBy || body.updateBy || 'SYSTEM';

        if (!id) {
            return c.json({ message: 'Missing ID' }, 400);
        }

        await updateMasterKeyMasterService(id, updateBy);
        
        return c.json({ success: true, message: 'Master Key updated' }, 200);
    } catch (error: any) {
        console.error('Error updating Master Key:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while updating Master Key',
            error: error.message 
        }, 500);
    }
};

export const exportPosition = async (c: Context) => {
    try {
        const query = c.req.query();
        console.log('--- ExportPosition API Query ---', query);
        const effYear = query.effYear || null;
        const effDate = query.effDate || null;
        const employeeId = query.employeeId || '';
        const userGroupNo = query.userGroupNo || '';
        const exportType = query.exportType ? parseInt(query.exportType) : 2;


        const result = await exportPositionService(
            effYear,
            effDate,
            employeeId,
            userGroupNo,
            exportType
        );
        
        return c.json({
            success: true,
            data: result
        }, 200);
    } catch (error: any) {
        console.error('Error exporting Position:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while exporting Position',
            error: error.message 
        }, 500);
    }
};

export const downloadMasterKeyTemplate = async (c: Context) => {
    try {
        const templatePath = path.join(process.cwd(), 'template', 'templatekeyman.xlsx');
        
        if (!fs.existsSync(templatePath)) {
            return c.json({ message: 'Template file not found' }, 404);
        }

        // Check if populate=true query param => export with data
        const populate = c.req.query('populate');
        
        if (populate === 'true') {
            // Dynamic import ExcelJS
            const ExcelJS = (await import('exceljs')).default;
            
            // Load template into ExcelJS
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(templatePath);
            const worksheet = workbook.worksheets[0];
            
            // Fetch master keys data
            const masterKeys = await getMasterKeysService();
            
            // Populate data starting from row 2
            masterKeys.forEach((item: any, index: number) => {
                const rowIndex = index + 2;
                const row = worksheet.getRow(rowIndex);
                row.getCell(1).value = item.KeyManName || '';
                row.commit();
            });
            
            // Write to buffer
            const buffer = await workbook.xlsx.writeBuffer();
            
            return c.body(Buffer.from(buffer), 200, {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="export_master_keyman.xlsx"`,
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
        }

        // Default: just return the raw template
        const fileBuffer = fs.readFileSync(templatePath);
        return c.body(fileBuffer, 200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="templatekeyman.xlsx"`
        });
    } catch (error: any) {
        console.error('Error downloading template:', error);
        return c.json({ success: false, message: 'Internal server error' }, 500);
    }
};

export const submitMKDApproveAction = async (c: Context) => {
    try {
        const id = parseInt(c.req.param('id'));
        const { approveId, employeeId, action, remark } = await c.req.json();
        const result = await submitMKDApproveActionService(id, approveId, employeeId, action, remark);
        return c.json(result, 200);
    } catch (error: any) {
        console.error('Error in submitMKDApproveAction:', error);
        return c.json({ success: false, message: error.message }, 500);
    }
};

export const copyMKD = async (c: Context) => {
    try {
        const id = parseInt(c.req.param('id'));
        const { copyFromId, employeeId, effectiveYear } = await c.req.json();
        const result = await copyMKDService(copyFromId, id, employeeId, effectiveYear);
        return c.json(result, 200);
    } catch (error: any) {
        console.error('Error in copyMKD:', error);
        return c.json({ success: false, message: error.message }, 500);
    }
};

export const getMKDHistory = async (c: Context) => {
    try {
        const employeeId = c.req.query('employeeId') || '';
        const result = await getMKDHistoryService(employeeId);
        return c.json({ success: true, data: result }, 200);
    } catch (error: any) {
        console.error('Error in getMKDHistory:', error);
        return c.json({ success: false, message: error.message }, 500);
    }
};

export const cancelMKD = async (c: Context) => {
    try {
        const id = parseInt(c.req.param('id'));
        const result = await cancelMKDService(id);
        return c.json(result, 200);
    } catch (error: any) {
        console.error('Error in cancelMKD:', error);
        return c.json({ success: false, message: error.message }, 500);
    }
};
