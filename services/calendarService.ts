import { sql, poolPromise } from '../config/db.js';
import configService from './configService.js';

const CALENDAR_TYPE_END = 1;
const CALENDAR_TYPE_START = 3;

export interface TransactionCalendarWindowValidationResult {
    isAllowed: boolean;
    message: string;
    startDate: string | null;
    endDate: string | null;
}

const parseAdYear = (value: string | number): number | null => {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    if (!Number.isInteger(parsed)) return null;
    return parsed > 2400 ? parsed - 543 : parsed;
};

const formatDateTime = (date: Date): string => {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hour}:${minute}`;
};

// SQL DateTime fields are typically read as UTC by driver settings.
// Convert them to local wall-clock values so checks align with configured calendar time.
const normalizeUtcDateToLocalClock = (date: Date): Date => {
    return new Date(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds(),
        date.getUTCMilliseconds()
    );
};

const parseCalendarDate = (value: unknown): Date | null => {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        return normalizeUtcDateToLocalClock(value);
    }
    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return null;

        if (typeof value === 'string') {
            const trimmed = value.trim();
            const hasTimezoneHint = /([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed);
            if (hasTimezoneHint) {
                return normalizeUtcDateToLocalClock(parsed);
            }
        }

        return parsed;
    }
    return null;
};

const extractCalendarDateFromRow = (row: Record<string, unknown>): Date | null => {
    const candidates = [
        row.ConfigDateLimit,
        row.ConfigDate,
        row.start,
        row.Start,
        row.end,
        row.End
    ];

    for (const candidate of candidates) {
        const parsed = parseCalendarDate(candidate);
        if (parsed) return parsed;
    }

    return null;
};

const getCalendarTypeDatesByMonthYear = async (
    month: number,
    yearAd: number,
    configType: number
): Promise<Date[]> => {
    const pool = await poolPromise;
    const request = new sql.Request(pool);
    request.input('ConfigType', sql.Int, configType);
    request.input('ConfigMonth', sql.Int, month);
    request.input('ConfigYear', sql.VarChar(50), String(yearAd));

    const result = await request.execute('MP_CheckConfigCalendar');
    const rows = (result.recordset || []) as Record<string, unknown>[];

    return rows
        .map((row) => extractCalendarDateFromRow(row))
        .filter((date): date is Date => Boolean(date));
};

export const getCalendarConfigsService = async () => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().execute('mp_ConfigCalendarGetAll');
        
        // Transform the results to be compatible with FullCalendar/AntD Calendar
        // mp_ConfigCalendarGetAll expected to return: ConfigCalendarID, ConfigDate, ConfigType, etc.
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing mp_ConfigCalendarGetAll:', error);
        throw error;
    }
};

export const insertCalendarConfigService = async (params: {
    configDate: string; // "dd/MM/yyyy"
    configType: number;
    createBy: string;
    timeWarning?: string; // "HH:mm"
}) => {
    try {
        const { configDate, configType, createBy, timeWarning } = params;
        const pool = await poolPromise;
        
        let finalTimeWarning = "";
        if (configType === 1) {
            finalTimeWarning = timeWarning || "00:00";
        } else {
            // Get from config "TimeWarning"
            finalTimeWarning = await configService.getConfig('TimeWarning');
            if (!finalTimeWarning) finalTimeWarning = "00:00";
        }

        // Parse date for SQL
        // In legacy: DateTime.ParseExact(ConfigDate + " " + time_warning, "dd/MM/yyyy HH:mm", ...)
        const [day, month, year] = configDate.split('/').map(Number);
        const [hour, minute] = finalTimeWarning.split(':').map(Number);
        // mssql (tedious) typically serializes DateTime using UTC.
        // Build the date in UTC to preserve wall-clock value from UI (e.g. 23:00 stays 23:00 in SQL DATETIME).
        const selectDate = new Date(Date.UTC(year, month - 1, day, hour, minute));

        const request = new sql.Request(pool);
        request.input('ConfigType', sql.Int, configType);
        request.input('ConfigDate', sql.DateTime, selectDate);
        request.input('ConfigStatus', sql.Int, 1);
        request.input('CreateBy', sql.VarChar(50), createBy);
        request.input('CreateDate', sql.DateTime, new Date());

        const result = await request.execute('mp_ConfigCalendarInsert');
        return { success: true, result: result.recordset };
    } catch (error) {
        console.error('Error executing mp_ConfigCalendarInsert:', error);
        throw error;
    }
};

export const deleteCalendarConfigService = async (configCalendarId: string, deleteBy: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('ConfigCalendarID', sql.Decimal(18, 0), configCalendarId);
        request.input('ConfigStatus', sql.Int, 0);
        request.input('DeleteBy', sql.VarChar(50), deleteBy);
        request.input('DeleteDate', sql.DateTime, new Date());

        await request.execute('mp_ConfigCalendarDelete');
        return { success: true };
    } catch (error) {
        console.error('Error executing mp_ConfigCalendarDelete:', error);
        throw error;
    }
};

export const checkCalendarDuplicateService = async (month: number, year: string, configType: number) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('ConfigType', sql.Int, configType);
        request.input('ConfigMonth', sql.Int, month);
        request.input('ConfigYear', sql.VarChar(50), year);

        const result = await request.execute('MP_CheckConfigCalendar');
        return result.recordset.length;
    } catch (error) {
        console.error('Error executing MP_CheckConfigCalendar:', error);
        throw error;
    }
};

export const validateTransactionCreationWindowService = async (
    month: number,
    year: string | number,
    currentDate: Date = new Date()
): Promise<TransactionCalendarWindowValidationResult> => {
    const adYear = parseAdYear(year);

    if (!Number.isInteger(month) || month < 1 || month > 12 || !adYear) {
        return {
            isAllowed: false,
            message: 'ข้อมูลเดือนหรือปีที่ใช้ตรวจสอบปฏิทินไม่ถูกต้อง',
            startDate: null,
            endDate: null
        };
    }

    const [startDates, endDates] = await Promise.all([
        getCalendarTypeDatesByMonthYear(month, adYear, CALENDAR_TYPE_START),
        getCalendarTypeDatesByMonthYear(month, adYear, CALENDAR_TYPE_END)
    ]);

    if (!startDates.length || !endDates.length) {
        return {
            isAllowed: false,
            message: 'ยังไม่ได้กำหนดช่วงเวลาเปิด-ปิดบันทึกในปฏิทินของเดือนนี้',
            startDate: null,
            endDate: null
        };
    }

    const startDate = new Date(Math.min(...startDates.map((date) => date.getTime())));
    const endDate = new Date(Math.max(...endDates.map((date) => date.getTime())));

    if (startDate.getTime() > endDate.getTime()) {
        return {
            isAllowed: false,
            message: 'ช่วงเวลาในปฏิทินไม่ถูกต้อง (START มากกว่า END)',
            startDate: formatDateTime(startDate),
            endDate: formatDateTime(endDate)
        };
    }

    const nowTime = currentDate.getTime();
    const inRange = nowTime >= startDate.getTime() && nowTime <= endDate.getTime();
    if (!inRange) {
        return {
            isAllowed: false,
            message: `ไม่สามารถบันทึกรายการได้ เนื่องจากเวลาปัจจุบันอยู่นอกช่วงปฏิทินที่กำหนด (${formatDateTime(startDate)} - ${formatDateTime(endDate)})`,
            startDate: formatDateTime(startDate),
            endDate: formatDateTime(endDate)
        };
    }

    return {
        isAllowed: true,
        message: 'อยู่ในช่วงเวลาบันทึกตามปฏิทิน',
        startDate: formatDateTime(startDate),
        endDate: formatDateTime(endDate)
    };
};
