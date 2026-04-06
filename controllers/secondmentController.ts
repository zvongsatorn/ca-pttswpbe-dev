import { Context } from 'hono';
import {
    getSecondmentPoolsService,
    insertSecondmentPoolService,
    updateSecondmentPoolService,
    getParentUnitsService,
    getUnitComboService,
    searchUnitsService
} from '../services/secondmentService.js';

export const getSecondmentPools = async (c: Context) => {
    try {
        const orgUnitNo = c.req.query('OrgUnitNo');
        if (!orgUnitNo) {
            return c.json({ status: 400, message: 'OrgUnitNo is required' }, 400);
        }
        const pools = await getSecondmentPoolsService(orgUnitNo);
        return c.json({ status: 200, data: pools });
    } catch (error: any) {
        console.error('Error fetching secondment pools:', error);
        return c.json({ status: 500, message: 'Internal server error', error: error.message }, 500);
    }
};

export const createSecondmentPool = async (c: Context) => {
    try {
        const body = await c.req.json();
        const { orgUnitNo, parentOrgUnitNo, createBy } = body;

        if (!orgUnitNo || !parentOrgUnitNo) {
            return c.json({ status: 400, message: 'Missing required parameters' }, 400);
        }

        const employeeId = c.get('user')?.employeeId || createBy || 'SYSTEM';
        const result = await insertSecondmentPoolService({
            orgUnitNo,
            parentOrgUnitNo,
            createBy: employeeId
        });

        return c.json({ status: 200, ...result });
    } catch (error: any) {
        console.error('Error creating secondment pool:', error);
        return c.json({ status: 500, message: 'Internal server error', error: error.message }, 500);
    }
};

export const updateSecondmentPool = async (c: Context) => {
    try {
        const body = await c.req.json();
        const { orgUnitNo, parentOrgUnitNo, updateBy } = body;

        if (!orgUnitNo || !parentOrgUnitNo) {
            return c.json({ status: 400, message: 'Missing required parameters' }, 400);
        }

        const employeeId = c.get('user')?.employeeId || updateBy || 'SYSTEM';
        const result = await updateSecondmentPoolService({
            orgUnitNo,
            parentOrgUnitNo,
            updateBy: employeeId
        });

        return c.json({ status: 200, ...result });
    } catch (error: any) {
        console.error('Error updating secondment pool:', error);
        return c.json({ status: 500, message: 'Internal server error', error: error.message }, 500);
    }
};

export const getParentUnits = async (c: Context) => {
    try {
        const units = await getParentUnitsService();
        return c.json({ status: 200, data: units });
    } catch (error: any) {
        console.error('Error fetching parent units:', error);
        return c.json({ status: 500, message: 'Internal server error', error: error.message }, 500);
    }
};

export const getUnitCombo = async (c: Context) => {
    try {
        const month = c.req.query('month') || (new Date().getMonth() + 1).toString();
        const year = c.req.query('year') || new Date().getFullYear().toString();
        
        const units = await getUnitComboService(month, year);
        return c.json({ status: 200, data: units });
    } catch (error: any) {
        console.error('Error fetching unit combo:', error);
        return c.json({ status: 500, message: 'Internal server error', error: error.message }, 500);
    }
};

export const searchUnits = async (c: Context) => {
    try {
        const keyword = c.req.query('q') || '';
        const units = await searchUnitsService(keyword);
        return c.json({ status: 200, data: units });
    } catch (error: any) {
        console.error('Error searching units:', error);
        return c.json({ status: 500, message: 'Internal server error', error: error.message }, 500);
    }
};
