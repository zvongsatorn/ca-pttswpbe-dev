import { Context } from 'hono';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
    getPIRService,
    insertPIRService,
    deletePIRService,
    copyPIRService,
    getPIROrgService,
    getFileAttachService,
    insertFileAttachService,
    deleteFileAttachService,
    getRemarkService,
    insertRemarkService,
    deleteRemarkService,
    getExportExcelService
} from '../services/pirService.js';

// --- Tab 1: PIR ---
export const getPIR = async (c: Context) => {
    try {
        const effectiveYear = c.req.query('effectiveYear');
        const orgUnitNo = c.req.query('orgUnitNo') || '';

        if (!effectiveYear) {
            return c.json({ message: 'Missing effectiveYear parameter' }, 400);
        }

        const result = await getPIRService(effectiveYear, orgUnitNo);
        return c.json({ success: true, data: result }, 200);
    } catch (error: any) {
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};

export const insertPIR = async (c: Context) => {
    try {
        const body = await c.req.json();
        const { effectiveYear, year, rate, orgUnitNo, createBy, import: isImport } = body;
        const effectiveYearNum = Number(effectiveYear);
        const yearNum = Number(year);
        const normalizedRate = rate === '' || rate === null || rate === undefined ? null : Number(rate);

        if (!effectiveYear || !year || Number.isNaN(effectiveYearNum) || Number.isNaN(yearNum)) {
            return c.json({ message: 'Missing required parameters' }, 400);
        }

        if (yearNum > effectiveYearNum && (normalizedRate === null || Number.isNaN(normalizedRate))) {
            return c.json({ success: false, message: 'Rate is required for year greater than effective year' }, 400);
        }

        const rateForInsert = normalizedRate === null || Number.isNaN(normalizedRate) ? 0 : normalizedRate;
        const result = await insertPIRService(effectiveYear, year, rateForInsert, orgUnitNo, createBy, isImport || 0);

        // From legacy: if result has a 'result' column == 1, it means duplicate
        if (result && result.length > 0 && result[0].result === 1) {
            return c.json({ success: false, duplicate: true, message: 'ข้อมูลซ้ำ (Duplicate data)' }, 400);
        }

        return c.json({ success: true, data: result }, 201);
    } catch (error: any) {
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};

export const deletePIR = async (c: Context) => {
    try {
        const body = await c.req.json();
        const { improveRateID, updateBy } = body;

        if (!improveRateID) {
            return c.json({ message: 'Missing improveRateID parameter' }, 400);
        }

        await deletePIRService(improveRateID, updateBy);
        return c.json({ success: true, message: 'Deleted successfully' }, 200);
    } catch (error: any) {
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};

export const copyPIR = async (c: Context) => {
    try {
        const body = await c.req.json();
        const { effectiveYear, orgUnitNo, createBy } = body;

        if (!effectiveYear) {
            return c.json({ message: 'Missing effectiveYear parameter' }, 400);
        }

        await copyPIRService(effectiveYear, orgUnitNo, createBy);
        return c.json({ success: true, message: 'Copied successfully' }, 200);
    } catch (error: any) {
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};

export const getPIROrg = async (c: Context) => {
    try {
        const effectiveYear = c.req.query('effectiveYear');
        if (!effectiveYear) {
            return c.json({ message: 'Missing effectiveYear parameter' }, 400);
        }

        const result = await getPIROrgService(effectiveYear);
        return c.json({ success: true, data: result }, 200);
    } catch (error: any) {
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};

// --- Tab 2: File Attach ---
export const getFileAttach = async (c: Context) => {
    try {
        const effectiveYear = c.req.query('effectiveYear');
        if (!effectiveYear) {
            return c.json({ message: 'Missing effectiveYear parameter' }, 400);
        }

        const result = await getFileAttachService(effectiveYear);
        return c.json({ success: true, data: result }, 200);
    } catch (error: any) {
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};

export const uploadFilePIR = async (c: Context) => {
    try {
        const body = await c.req.parseBody();
        const file = body['file'] as any; 
        const user = body['user'] as string || 'SYSTEM';
        const displayFileName = body['fileName'] as string;
        const effYear = body['effYear'] as string;
        
        if (!file || !effYear || !displayFileName) {
            return c.json({ message: 'Missing file, effYear, or fileName' }, 400);
        }

        const fileName = file.name;
        const fileBuffer = await file.arrayBuffer();
        
        const uploadDir = path.join(process.cwd(), 'uploads', 'pir', effYear);
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        
        let extension = path.extname(fileName).toLowerCase();
        if (!extension) extension = ".pdf";
        
        const safeName = `${randomUUID()}${extension}`;
        const filePath = path.join(uploadDir, safeName);
        fs.writeFileSync(filePath, Buffer.from(fileBuffer));
        
        await insertFileAttachService(effYear, displayFileName, safeName, user);
        return c.json({ success: true, message: "File uploaded successfully" }, 200);
    } catch (error: any) {
        console.error('Error uploading file:', error);
        return c.json({ success: false, message: 'Internal server error' }, 500);
    }
};

export const downloadFilePIR = async (c: Context) => {
    try {
        const effYear = c.req.param('effYear');
        const fileId = c.req.param('fileId');

        if (!effYear || !fileId) {
            return c.json({ message: 'Missing parameters' }, 400);
        }
        
        const filePath = path.join(process.cwd(), 'uploads', 'pir', effYear, fileId);
        
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

export const deleteFileAttach = async (c: Context) => {
    try {
        const body = await c.req.json();
        const { improveRateUploadID, fileUpload, effYear } = body;

        if (!improveRateUploadID) {
            return c.json({ message: 'Missing improveRateUploadID parameter' }, 400);
        }

        await deleteFileAttachService(improveRateUploadID, fileUpload, effYear);
        return c.json({ success: true, message: 'Deleted successfully' }, 200);
    } catch (error: any) {
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};

// --- Tab 3: Remark ---
export const getRemark = async (c: Context) => {
    try {
        const effectiveYear = c.req.query('effectiveYear');
        if (!effectiveYear) {
            return c.json({ message: 'Missing effectiveYear parameter' }, 400);
        }

        const result = await getRemarkService(effectiveYear);
        return c.json({ success: true, data: result }, 200);
    } catch (error: any) {
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};

export const insertRemark = async (c: Context) => {
    try {
        const body = await c.req.json();
        const { effYear, remark, createBy } = body;

        if (!effYear || !remark) {
            return c.json({ message: 'Missing required parameters' }, 400);
        }

        await insertRemarkService(effYear, remark, createBy);
        return c.json({ success: true, message: 'Inserted successfully' }, 201);
    } catch (error: any) {
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};

export const deleteRemark = async (c: Context) => {
    try {
        const body = await c.req.json();
        const { improveRateRemarkID, updateBy } = body;

        if (!improveRateRemarkID) {
            return c.json({ message: 'Missing improveRateRemarkID parameter' }, 400);
        }

        await deleteRemarkService(improveRateRemarkID, updateBy);
        return c.json({ success: true, message: 'Deleted successfully' }, 200);
    } catch (error: any) {
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};

// --- Tab 4: Export ---
export const exportExcel = async (c: Context) => {
    try {
        const effectiveMonth = c.req.query('effectiveMonth') || '1';
        const effectiveYear = c.req.query('effectiveYear');
        const employeeId = c.req.query('employeeId') || '';
        const userGroupNo = c.req.query('userGroupNo') || '';
        const bgNo = c.req.query('bgNo') || '';
        const divisionNo = c.req.query('divisionNo') || '';
        const orgUnitNo = c.req.query('orgUnitNo') || '';

        if (!effectiveYear) {
            return c.json({ message: 'Missing effectiveYear parameter' }, 400);
        }

        const effMonthStr = effectiveMonth.length === 1 ? `0${effectiveMonth}` : effectiveMonth;
        const formattedDate = `${effectiveYear}-${effMonthStr}-01`;

        console.log('Export Params:', { formattedDate, userGroupNo, employeeId, effectiveYear, bgNo, divisionNo, orgUnitNo });
        const result = await getExportExcelService(
            formattedDate,
            userGroupNo,
            employeeId,
            effectiveYear,
            bgNo,
            divisionNo,
            orgUnitNo
        );
        console.log('Export Result Length:', result.length);

        return c.json({ success: true, data: result }, 200);
    } catch (error: any) {
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};
export const getPIRTemplate = async (c: Context) => {
    try {
        const filePath = path.join(process.cwd(), 'template', 'templateimproverate.xlsx');
        
        if (!fs.existsSync(filePath)) {
            return c.json({ success: false, message: 'Template file not found' }, 404);
        }

        const fileBuffer = fs.readFileSync(filePath);
        return c.body(fileBuffer, 200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': 'attachment; filename="templateimproverate.xlsx"'
        });
    } catch (error: any) {
        console.error('Error downloading template:', error);
        return c.json({ success: false, message: 'Internal server error' }, 500);
    }
};
