import { Context } from 'hono';
import userGroupService from '../services/userGroupService.js';

class UserGroupController {
    async getAll(c: Context) {
        try {
            const result = await userGroupService.getUserGroups();
            return c.json(result);
        } catch (err: any) {
            return c.json({ error: err.message }, 500);
        }
    }

    async getLevels(c: Context) {
        try {
            const userGroupNo = c.req.query('userGroupNo');
            const levelFlag = c.req.query('levelFlag');

            if (!userGroupNo || levelFlag === undefined) {
                return c.json({ error: "Missing parameters" }, 400);
            }

            const result = await userGroupService.getLevelsInGroup(userGroupNo, parseInt(levelFlag));
            return c.json(result);
        } catch (err: any) {
            return c.json({ error: err.message }, 500);
        }
    }

    async getLevelCombo(c: Context) {
        try {
            const levelFlag = c.req.query('levelFlag');
            const userGroupNo = c.req.query('userGroupNo');

            if (!userGroupNo || levelFlag === undefined) {
                return c.json({ error: "Missing parameters" }, 400);
            }

            const result = await userGroupService.getLevelCombo(parseInt(levelFlag), userGroupNo);
            return c.json(result);
        } catch (err: any) {
            return c.json({ error: err.message }, 500);
        }
    }

    async addLevel(c: Context) {
        try {
            const { UserGroupNo, LevelGroupNo, CreateBy } = await c.req.json();
            const success = await userGroupService.insertLevelInGroup(UserGroupNo, LevelGroupNo, CreateBy);
            if (success) {
                return c.json("Success", 200);
            } else {
                return c.json("ระดับซ้ำในกลุ่มผู้ใช้งานเดียวกัน", 400);
            }
        } catch (err: any) {
            return c.json({ error: err.message }, 500);
        }
    }

    async getAllUsers(c: Context) {
        try {
            const result = await userGroupService.getAllUsers();
            return c.json(result);
        } catch (err: any) {
            return c.json({ error: err.message }, 500);
        }
    }

    async getMembers(c: Context) {
        try {
            const userGroupNo = c.req.query('userGroupNo');
            if (!userGroupNo) return c.json({ error: "Missing userGroupNo" }, 400);

            const result = await userGroupService.getUsersInGroup(userGroupNo);
            return c.json(result);
        } catch (err: any) {
            return c.json({ error: err.message }, 500);
        }
    }

    async addMember(c: Context) {
        try {
            const { UserGroupNo, EmployeeID, CreateBy } = await c.req.json();
            const success = await userGroupService.insertUserInGroup(UserGroupNo, EmployeeID, CreateBy);
            if (success) {
                return c.json("Success", 200);
            } else {
                return c.json("รายชื่อซ้ำในกลุ่มผู้ใช้งานเดียวกัน", 400);
            }
        } catch (err: any) {
            return c.json({ error: err.message }, 500);
        }
    }

    async deleteMember(c: Context) {
        try {
            const { UserGroupNo, EmployeeID, UpdateBy } = await c.req.json();
            await userGroupService.deleteUserInGroup(UserGroupNo, EmployeeID, UpdateBy);
            return c.json("Success", 200);
        } catch (err: any) {
            return c.json({ error: err.message }, 500);
        }
    }

    async deleteLevel(c: Context) {
        try {
            const { UserGroupNo, LevelGroupNo, UpdateBy } = await c.req.json();
            await userGroupService.deleteLevelInGroup(UserGroupNo, LevelGroupNo, UpdateBy);
            return c.json("Success", 200);
        } catch (err: any) {
            return c.json({ error: err.message }, 500);
        }
    }
}

export default new UserGroupController();
