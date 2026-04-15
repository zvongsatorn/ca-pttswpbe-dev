import { Context } from 'hono';
import userRightService from '../services/userRightService.js';

const normalizeCode = (value: any, length: number) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    return /^\d+$/.test(raw) ? raw.padStart(length, '0') : raw;
};

class UserRightController {
    async getOrgUnitInGroup(c: Context) {
        try {
            const userGroupNo = c.req.query('userGroupNo');
            if (!userGroupNo) return c.json({ error: 'Missing userGroupNo' }, 400);
            const data = await userRightService.getOrgUnitInGroup(userGroupNo);
            return c.json(data);
        } catch (err: any) {
            console.error('Error in getOrgUnitInGroup:', err);
            return c.json({ error: err.message }, 500);
        }
    }

    async getOrgUnitInUser(c: Context) {
        try {
            const userGroupNo = c.req.query('userGroupNo');
            const employeeId = c.req.query('employeeId');
            if (!userGroupNo || !employeeId) return c.json({ error: 'Missing parameters' }, 400);
            const data = await userRightService.getOrgUnitInUser(userGroupNo, employeeId);
            return c.json(data);
        } catch (err: any) {
            return c.json({ error: err.message }, 500);
        }
    }

    async insertOrgUnitUser(c: Context) {
        try {
            const { UserGroupNo, EmployeeID, OrgUnitNo, CreateBy } = await c.req.json();
            const result = await userRightService.insertOrgUnitUser(UserGroupNo, EmployeeID, OrgUnitNo, CreateBy);
            if (!result.success) return c.json({ error: result.message }, 400);
            return c.json({ success: true, message: 'Inserted successfully' });
        } catch (err: any) {
            return c.json({ error: err.message }, 500);
        }
    }

    async deleteOrgUnitUser(c: Context) {
        try {
            const { UserGroupNo, EmployeeID, OrgUnitNo, UpdateBy } = await c.req.json();
            await userRightService.deleteOrgUnitUser(UserGroupNo, EmployeeID, OrgUnitNo, UpdateBy);
            return c.json({ success: true, message: 'Deleted successfully' });
        } catch (err: any) {
            return c.json({ error: err.message }, 500);
        }
    }

    async deleteAllOrgUnitUser(c: Context) {
        try {
            const { UserGroupNo, EmployeeID, UpdateBy } = await c.req.json();
            await userRightService.deleteAllOrgUnitUser(UserGroupNo, EmployeeID, UpdateBy);
            return c.json({ success: true, message: 'Deleted all successfully' });
        } catch (err: any) {
            return c.json({ error: err.message }, 500);
        }
    }

    async addUserInAllUnit(c: Context) {
        try {
            const { UserGroupNo, EmployeeID, CreateBy } = await c.req.json();
            await userRightService.addUserInAllUnit(UserGroupNo, EmployeeID, CreateBy);
            return c.json({ success: true, message: 'Added to all units successfully' });
        } catch (err: any) {
            return c.json({ error: err.message }, 500);
        }
    }

    async addUserInBUAll(c: Context) {
        try {
            const { UserGroupNo, EmployeeID, BGNo, CreateBy } = await c.req.json();
            await userRightService.addUserInBUAll(UserGroupNo, EmployeeID, BGNo, CreateBy);
            return c.json({ success: true, message: 'Added to BU successfully' });
        } catch (err: any) {
            return c.json({ error: err.message }, 500);
        }
    }

    async addUserInBelongAll(c: Context) {
        try {
            const { UserGroupNo, EmployeeID, OrgUnitNo, CreateBy } = await c.req.json();
            await userRightService.addUserInBelongAll(UserGroupNo, EmployeeID, OrgUnitNo, CreateBy);
            return c.json({ success: true, message: 'Added to Belong units successfully' });
        } catch (err: any) {
            return c.json({ error: err.message }, 500);
        }
    }

    // Combos
    async getBGCombo(c: Context) {
        try {
            const effectiveMonth = c.req.query('effectiveMonth');
            const effectiveYear = c.req.query('effectiveYear');
            if (!effectiveMonth || !effectiveYear) return c.json({ error: 'Missing parameters' }, 400);
            const data = await userRightService.getBGCombo(effectiveMonth, effectiveYear);
            return c.json(data);
        } catch (err: any) {
            return c.json({ error: err.message }, 500);
        }
    }

    async getOrgUnitInBelong(c: Context) {
        try {
            const employeeId = c.req.query('employeeId');
            if (!employeeId) return c.json({ error: 'Missing employeeId' }, 400);
            const data = await userRightService.getOrgUnitInBelong(employeeId);
            return c.json(data);
        } catch (err: any) {
            return c.json({ error: err.message }, 500);
        }
    }

    async getUnitAllCombo(c: Context) {
        try {
            const effectiveMonth = c.req.query('effectiveMonth');
            const effectiveYear = c.req.query('effectiveYear');
            if (!effectiveMonth || !effectiveYear) return c.json({ error: 'Missing parameters' }, 400);
            const data = await userRightService.getUnitAllCombo(effectiveMonth, effectiveYear);
            return c.json(data);
        } catch (err: any) {
            return c.json({ error: err.message }, 500);
        }
    }

    async getUsersByOrgUnit(c: Context) {
        try {
            const orgUnitNo = c.req.query('orgUnitNo');
            if (!orgUnitNo) return c.json({ error: 'Missing orgUnitNo' }, 400);
            const data = await userRightService.getUsersByOrgUnit(orgUnitNo);
            return c.json(data);
        } catch (err: any) {
            return c.json({ error: err.message }, 500);
        }
    }

    async copyOrg(c: Context) {
        try {
            const { UserGroupNo, EmployeeIDFrom, EmployeeIDTo, CreateBy } = await c.req.json();
            const normalizedUserGroupNo = normalizeCode(UserGroupNo, 2);
            const normalizedEmployeeIDFrom = normalizeCode(EmployeeIDFrom, 8);
            const normalizedEmployeeIDTo = normalizeCode(EmployeeIDTo, 8);
            const normalizedCreateBy = normalizeCode(CreateBy, 8) || 'SYSTEM';

            if (!normalizedUserGroupNo || !normalizedEmployeeIDFrom || !normalizedEmployeeIDTo || !normalizedCreateBy) {
                return c.json({ error: 'Missing parameters' }, 400);
            }

            await userRightService.copyOrg(
                normalizedUserGroupNo,
                normalizedEmployeeIDFrom,
                normalizedEmployeeIDTo,
                normalizedCreateBy
            );

            return c.json({ success: true, message: 'Copied organization rights successfully' });
        } catch (err: any) {
            console.error('Error in copyOrg:', err);
            return c.json({ error: err.message }, 500);
        }
    }

    async getUnitLineAsst(c: Context) {
        try {
            const effectiveMonth = c.req.query('effectiveMonth');
            const effectiveYear = c.req.query('effectiveYear');
            
            if (!effectiveMonth || !effectiveYear) {
                return c.json({ error: 'Missing parameters' }, 400);
            }
            
            const data = await userRightService.getUnitLineAsst(effectiveMonth, effectiveYear);
            return c.json(data);
        } catch (err: any) {
            return c.json({ error: err.message }, 500);
        }
    }
}

export default new UserRightController();
