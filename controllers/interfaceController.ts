import { Context } from 'hono';
import { importInfoDataFromFile } from '../services/interfaceService.js';

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
        const body = await c.req.parseBody();
        const file = toUploadFile(body.file);

        if (!file) {
            return c.json({ success: false, message: 'No file uploaded' }, 400);
        }

        const replaceExisting = parseReplaceExisting(body.replaceExisting);
        const fileBuffer = await file.arrayBuffer();

        const result = await importInfoDataFromFile(fileBuffer, file.name, replaceExisting);

        return c.json({
            success: true,
            message: 'InfoData uploaded successfully',
            data: result
        }, 200);
    } catch (error: any) {
        console.error('Error in uploadInfoData controller:', error);
        return c.json({
            success: false,
            message: error?.message || 'Internal server error while uploading InfoData'
        }, 500);
    }
};
