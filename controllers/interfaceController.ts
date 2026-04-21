import { Context } from 'hono';
import {
    importHrpDataFromFile,
    importInfoDataFromFile,
    resolveRequestedHrpTargetTable
} from '../services/interfaceService.js';

const parseReplaceExisting = (value: unknown): boolean => {
    if (value === undefined || value === null || value === '') return true;
    const text = String(value).trim().toLowerCase();
    return !(text === 'false' || text === '0' || text === 'no');
};

const toUploadFile = (value: unknown): { name: string; arrayBuffer: () => Promise<ArrayBuffer> } | null => {
    if (!value || typeof value !== 'object') return null;

    const candidate = value as { name?: unknown; arrayBuffer?: unknown };
    if (typeof candidate.name !== 'string') return null;
    if (typeof candidate.arrayBuffer !== 'function') return null;

    return {
        name: candidate.name,
        arrayBuffer: () => (candidate.arrayBuffer as () => Promise<ArrayBuffer>).call(value)
    };
};

export const uploadInfoData = async (c: Context) => {
    try {
        const formData = await c.req.formData();
        const file = toUploadFile(formData.get('file'));

        if (!file) {
            return c.json({ success: false, message: 'No file uploaded' }, 400);
        }

        const replaceExisting = parseReplaceExisting(formData.get('replaceExisting'));
        const fileBuffer = await file.arrayBuffer();

        const result = await importInfoDataFromFile(fileBuffer, file.name, replaceExisting);

        return c.json({
            success: true,
            message: 'InfoData uploaded successfully',
            data: result
        }, 200);
    } catch (error: any) {
        console.error('Error in uploadInfoData controller:', error);
        const errorMessage = String(error?.message || '').toLowerCase();
        if (errorMessage.includes('aborted')) {
            return c.json({
                success: false,
                message: 'การอัปโหลดถูกยกเลิกหรือไฟล์มีขนาดใหญ่เกินระบบรองรับ กรุณาลองใหม่อีกครั้ง'
            }, 400);
        }

        return c.json({
            success: false,
            message: error?.message || 'Internal server error while uploading InfoData'
        }, 500);
    }
};

export const uploadHrpData = async (c: Context) => {
    try {
        const formData = await c.req.formData();
        const file = toUploadFile(formData.get('file'));

        if (!file) {
            return c.json({ success: false, message: 'No file uploaded' }, 400);
        }

        const replaceExisting = parseReplaceExisting(formData.get('replaceExisting'));
        const requestedTargetTable = resolveRequestedHrpTargetTable(formData.get('targetTable'));
        const fileBuffer = await file.arrayBuffer();

        const result = await importHrpDataFromFile(
            fileBuffer,
            file.name,
            replaceExisting,
            requestedTargetTable
        );

        return c.json({
            success: true,
            message: `${result.targetTable} uploaded successfully`,
            data: result
        }, 200);
    } catch (error: any) {
        console.error('Error in uploadHrpData controller:', error);
        const errorMessage = String(error?.message || '').toLowerCase();
        if (errorMessage.includes('aborted')) {
            return c.json({
                success: false,
                message: 'การอัปโหลดถูกยกเลิกหรือไฟล์มีขนาดใหญ่เกินระบบรองรับ กรุณาลองใหม่อีกครั้ง'
            }, 400);
        }

        return c.json({
            success: false,
            message: error?.message || 'Internal server error while uploading HRP data'
        }, 500);
    }
};
