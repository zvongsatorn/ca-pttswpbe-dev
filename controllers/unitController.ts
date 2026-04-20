import { Context } from 'hono';
import {
    getUnitsByRoleService,
    getLevelsByUnitService,
    getAllUnitsByEffectiveDateService,
    getTransferUnitsByReceiveService
} from '../services/unitService.js';


// Controller to handle fetching units by user ID and role
export const getUnitsByRole = async (c: Context) => {
    try {
        const empId = c.req.query('empId');
        const roleId = c.req.query('roleId');

        if (!empId || !roleId) {
            return c.json({ message: 'Missing empId or roleId parameters' }, 400);
        }

        const result = await getUnitsByRoleService(empId, roleId);
        
        return c.json({
            success: true,
            data: result
        }, 200);
    } catch (error: any) {
        console.error('Error fetching units by role:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while fetching units',
            error: error.message 
        }, 500);
    }
};

export const getLevelsByUnit = async (c: Context) => {
    try {
        const checkDate = c.req.query('checkDate');
        const unit = c.req.query('unit');
        const userGroupNo = c.req.query('userGroupNo');

        if (!checkDate || !unit || !userGroupNo) {
            return c.json({ message: 'Missing checkDate, unit, or userGroupNo parameters' }, 400);
        }

        const result = await getLevelsByUnitService(checkDate, unit, userGroupNo);
        
        return c.json({
            success: true,
            data: result
        }, 200);
    } catch (error: any) {
        console.error('Error fetching levels by unit:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while fetching levels',
            error: error.message 
        }, 500);
    }
};

export const getAllUnitsByEffectiveDate = async (c: Context) => {
    try {
        const effectiveDate = c.req.query('effectiveDate');

        if (!effectiveDate) {
            return c.json({ message: 'Missing effectiveDate parameter (format: YYYY-MM-DD)' }, 400);
        }

        const result = await getAllUnitsByEffectiveDateService(effectiveDate);

        return c.json({
            success: true,
            data: result
        }, 200);
    } catch (error: any) {
        console.error('Error fetching all units by effective date:', error);
        return c.json({
            success: false,
            message: 'Internal server error while fetching units',
            error: error.message
        }, 500);
    }
};

export const getTransferUnitsByReceive = async (c: Context) => {
    try {
        const effectiveDate = c.req.query('effectiveDate');
        const division = c.req.query('division') || '';
        const orgUnitReceive = c.req.query('orgUnitReceive') || '';
        const userGroupNo = c.req.query('userGroupNo') || '';
        const employeeId = c.req.query('employeeId') || '';
        const selectTypeRaw = c.req.query('selectType') || '0';
        const parsedSelectType = Number.parseInt(selectTypeRaw, 10);
        const selectType = Number.isNaN(parsedSelectType) ? 0 : parsedSelectType;

        if (!effectiveDate || !userGroupNo || !employeeId) {
            return c.json({
                message: 'Missing effectiveDate, userGroupNo, or employeeId parameter'
            }, 400);
        }

        if (!division || !orgUnitReceive) {
            return c.json({
                success: true,
                data: []
            }, 200);
        }

        const result = await getTransferUnitsByReceiveService({
            effectiveDate,
            division,
            orgUnitReceive,
            userGroupNo,
            employeeId,
            selectType
        });

        return c.json({
            success: true,
            data: result
        }, 200);
    } catch (error: any) {
        console.error('Error fetching transfer units by receive:', error);
        return c.json({
            success: false,
            message: 'Internal server error while fetching transfer units',
            error: error.message
        }, 500);
    }
};
