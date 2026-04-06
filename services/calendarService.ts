import { sql, poolPromise } from '../config/db.js';
import configService from './configService.js';

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
        const selectDate = new Date(year, month - 1, day, hour, minute);

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
