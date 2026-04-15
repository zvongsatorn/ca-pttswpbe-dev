import { Context } from 'hono';
import {
    CostPayload,
    deleteCostRecordService,
    exportCostRecordsService,
    getCostLevelGroupsService,
    getCostRecordsService,
    getCostTemplateMetaService,
    importCostRowsService,
    updateCostRecordService,
    upsertCostRecordService
} from '../services/costService.js';

interface CostBody {
    orgUnitNo?: unknown;
    levelGroupNo?: unknown;
    effectiveDate?: unknown;
    note?: unknown;
    cost?: unknown;
}

const toTrimmedText = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    return String(value).trim();
};

const toFiniteNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

const isValidDateOnly = (value: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return false;
    return d.toISOString().slice(0, 10) === value;
};

const normalizeCostPayload = (raw: CostBody): { data?: CostPayload; message?: string } => {
    const orgUnitNo = toTrimmedText(raw.orgUnitNo);
    const levelGroupNo = toTrimmedText(raw.levelGroupNo);
    const effectiveDate = toTrimmedText(raw.effectiveDate);
    const note = toTrimmedText(raw.note);
    const cost = toFiniteNumber(raw.cost);

    if (!orgUnitNo) {
        return { message: 'กรุณาระบุ OrgUnitNo' };
    }

    if (!levelGroupNo) {
        return { message: 'กรุณาระบุ LevelGroupNo' };
    }

    if (!effectiveDate) {
        return { message: 'กรุณาระบุ EffectiveDate' };
    }

    if (!isValidDateOnly(effectiveDate)) {
        return { message: 'รูปแบบ EffectiveDate ไม่ถูกต้อง (YYYY-MM-DD)' };
    }

    if (cost === null) {
        return { message: 'กรุณาระบุ Cost ให้ถูกต้อง' };
    }

    return {
        data: {
            orgUnitNo,
            levelGroupNo,
            effectiveDate,
            note,
            cost
        }
    };
};

const normalizePeriod = (
    fromDate: string | undefined,
    toDate: string | undefined
): { fromDate?: string; toDate?: string; message?: string } => {
    const from = toTrimmedText(fromDate);
    const to = toTrimmedText(toDate);

    if (!from || !to) {
        return { message: 'กรุณาระบุ fromDate และ toDate' };
    }

    if (!isValidDateOnly(from) || !isValidDateOnly(to)) {
        return { message: 'รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)' };
    }

    if (from > to) {
        return { message: 'fromDate ต้องน้อยกว่าหรือเท่ากับ toDate' };
    }

    return { fromDate: from, toDate: to };
};

export const getCostList = async (c: Context) => {
    try {
        const normalized = normalizePeriod(c.req.query('fromDate'), c.req.query('toDate'));
        if (!normalized.fromDate || !normalized.toDate) {
            return c.json({ success: false, message: normalized.message || 'Invalid period' }, 400);
        }

        const result = await getCostRecordsService(normalized.fromDate, normalized.toDate);
        return c.json({ success: true, data: result }, 200);
    } catch (error: any) {
        console.error('Error in getCostList controller:', error);
        return c.json({ success: false, message: error?.message || 'Internal server error' }, 500);
    }
};

export const upsertCost = async (c: Context) => {
    try {
        const body = await c.req.json<CostBody>();
        const normalized = normalizeCostPayload(body);

        if (!normalized.data) {
            return c.json({ success: false, message: normalized.message || 'Invalid payload' }, 400);
        }

        const action = await upsertCostRecordService(normalized.data);
        return c.json({ success: true, message: action === 'inserted' ? 'Inserted successfully' : 'Updated successfully', action }, 200);
    } catch (error: any) {
        console.error('Error in upsertCost controller:', error);
        return c.json({ success: false, message: error?.message || 'Internal server error' }, 500);
    }
};

export const updateCost = async (c: Context) => {
    try {
        const body = await c.req.json<{ original?: CostBody; next?: CostBody }>();

        if (!body.original || !body.next) {
            return c.json({ success: false, message: 'Missing original or next payload' }, 400);
        }

        const original = normalizeCostPayload(body.original);
        const next = normalizeCostPayload(body.next);

        if (!original.data || !next.data) {
            return c.json({ success: false, message: original.message || next.message || 'Invalid payload' }, 400);
        }

        const updated = await updateCostRecordService(original.data, next.data);
        if (!updated) {
            return c.json({ success: false, message: 'Cost record not found' }, 404);
        }

        return c.json({ success: true, message: 'Updated successfully' }, 200);
    } catch (error: any) {
        console.error('Error in updateCost controller:', error);
        return c.json({ success: false, message: error?.message || 'Internal server error' }, 500);
    }
};

export const deleteCost = async (c: Context) => {
    try {
        const body = await c.req.json<{ original?: CostBody }>();

        if (!body.original) {
            return c.json({ success: false, message: 'Missing original payload' }, 400);
        }

        const original = normalizeCostPayload(body.original);
        if (!original.data) {
            return c.json({ success: false, message: original.message || 'Invalid payload' }, 400);
        }

        const deleted = await deleteCostRecordService(original.data);
        if (!deleted) {
            return c.json({ success: false, message: 'Cost record not found' }, 404);
        }

        return c.json({ success: true, message: 'Deleted successfully' }, 200);
    } catch (error: any) {
        console.error('Error in deleteCost controller:', error);
        return c.json({ success: false, message: error?.message || 'Internal server error' }, 500);
    }
};

export const importCost = async (c: Context) => {
    try {
        const body = await c.req.json<{ rows?: CostBody[] }>();
        if (!Array.isArray(body.rows) || body.rows.length === 0) {
            return c.json({ success: false, message: 'rows must be a non-empty array' }, 400);
        }

        const parsedRows: CostPayload[] = [];
        const invalidRows: string[] = [];

        body.rows.forEach((raw, index) => {
            const normalized = normalizeCostPayload(raw);
            if (!normalized.data) {
                invalidRows.push(`Row ${index + 1}: ${normalized.message || 'Invalid payload'}`);
                return;
            }
            parsedRows.push(normalized.data);
        });

        if (invalidRows.length > 0) {
            return c.json({
                success: false,
                message: 'พบข้อมูลไม่ถูกต้องในไฟล์นำเข้า',
                errors: invalidRows.slice(0, 20)
            }, 400);
        }

        const result = await importCostRowsService(parsedRows);
        return c.json({ success: true, data: result }, 200);
    } catch (error: any) {
        console.error('Error in importCost controller:', error);
        return c.json({ success: false, message: error?.message || 'Internal server error' }, 500);
    }
};

export const exportCost = async (c: Context) => {
    try {
        const normalized = normalizePeriod(c.req.query('fromDate'), c.req.query('toDate'));
        if (!normalized.fromDate || !normalized.toDate) {
            return c.json({ success: false, message: normalized.message || 'Invalid period' }, 400);
        }

        const result = await exportCostRecordsService(normalized.fromDate, normalized.toDate);
        return c.json({ success: true, data: result }, 200);
    } catch (error: any) {
        console.error('Error in exportCost controller:', error);
        return c.json({ success: false, message: error?.message || 'Internal server error' }, 500);
    }
};

export const getCostTemplate = async (c: Context) => {
    try {
        const result = await getCostTemplateMetaService();
        return c.json({ success: true, data: result }, 200);
    } catch (error: any) {
        console.error('Error in getCostTemplate controller:', error);
        return c.json({ success: false, message: error?.message || 'Internal server error' }, 500);
    }
};

export const getCostLevelGroups = async (c: Context) => {
    try {
        const requestedDate = toTrimmedText(c.req.query('effectiveDate'));
        const effectiveDate = requestedDate || new Date().toISOString().slice(0, 10);

        if (!isValidDateOnly(effectiveDate)) {
            return c.json({ success: false, message: 'รูปแบบ effectiveDate ไม่ถูกต้อง (YYYY-MM-DD)' }, 400);
        }

        const result = await getCostLevelGroupsService(effectiveDate);
        return c.json({ success: true, data: result }, 200);
    } catch (error: any) {
        console.error('Error in getCostLevelGroups controller:', error);
        return c.json({ success: false, message: error?.message || 'Internal server error' }, 500);
    }
};
