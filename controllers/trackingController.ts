import { Context } from 'hono';
import { 
    getTrackingUserLogService, 
    getTrackingUnitLogService 
} from '../services/trackingService.js';

export const getTrackingUsers = async (c: Context) => {
    try {
        const dmonth = c.req.query('dmonth');
        const dyear = c.req.query('dyear'); 
        const userGroupNo = c.req.query('UserGroupNo') || c.req.query('userGroupNo');
        const employeeId = c.req.query('EmployeeID') || c.req.query('employeeId');

        console.log('--- API: getTrackingUsers ---');
        console.log('Month:', dmonth, 'Year:', dyear, 'UserGroup:', userGroupNo, 'EmpID:', employeeId);

        if (!dmonth || !dyear || !userGroupNo || !employeeId) {
            console.warn('Missing parameters in getTrackingUsers');
            return c.json({ error: 'Missing required query parameters.' }, 400);
        }

        const paddedMonth = dmonth.padStart(2, '0');
        // Construct the EffectiveDate based on legacy '01/' + dmonth + '/' + dyear (DD/MM/YYYY)
        // Here we build it as YYYY-MM-DD for SQL Server
        const effectiveDate = `${dyear}-${paddedMonth}-01`;

        const data = await getTrackingUserLogService(effectiveDate, userGroupNo as string, employeeId as string);
        return c.json(data);
    } catch (error) {
        console.error('Error in getTrackingUsers:', error);
        return c.json({ error: 'Internal Server Error' }, 500);
    }
};

export const getTrackingUnits = async (c: Context) => {
    try {
        const dmonth = c.req.query('dmonth');
        const dyear = c.req.query('dyear');
        const userGroupNo = c.req.query('UserGroupNo') || c.req.query('userGroupNo');
        const employeeId = c.req.query('employeeID') || c.req.query('EmployeeID') || c.req.query('employeeId');

        console.log('--- API: getTrackingUnits ---');
        console.log('Month:', dmonth, 'Year:', dyear, 'UserGroup:', userGroupNo, 'EmpID:', employeeId);

        if (!dmonth || !dyear || !userGroupNo || !employeeId) {
            console.warn('Missing parameters in getTrackingUnits');
            return c.json({ error: 'Missing required query parameters.' }, 400);
        }

        const paddedMonth = dmonth.padStart(2, '0');
        const effectiveDate = `${dyear}-${paddedMonth}-01`;

        const data = await getTrackingUnitLogService(effectiveDate, userGroupNo as string, employeeId as string);
        return c.json(data);
    } catch (error) {
        console.error('Error in getTrackingUnits:', error);
        return c.json({ error: 'Internal Server Error' }, 500);
    }
};
