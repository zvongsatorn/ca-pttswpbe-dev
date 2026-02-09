import { sql, poolPromise } from '../config/db.js';

class UserGroupService {
    async getUserGroups() {
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('mp_UserGroupGet');
        return result.recordset.map((row: any) => ({
            userGroupNo: row.UserGroupNo,
            userGroupName: row.UserGroupName,
            levelFlag: row.LevelFlag,
            chkuser: row.ChkUser
        }));
    }

    async getLevelsInGroup(userGroupNo: string, levelFlag: number) {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .input('LevelFlag', sql.Int, levelFlag)
            .execute('mp_UserGroupLevelGet');
        return result.recordset.map((row: any) => ({
            levelGroupNo: row.LevelGroupNo,
            nameAll: row.NameAll
        }));
    }

    async getLevelCombo(levelFlag: number, userGroupNo: string) {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('LevelFlag', sql.Int, levelFlag)
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .execute('mp_LevelGroupGetWithFlag');
        return result.recordset.map((row: any) => ({
            levelGroupNo: row.LevelGroupNo,
            nameAll: row.NameAll
        }));
    }

    async insertLevelInGroup(userGroupNo: string, levelGroupNo: string, createBy: string) {
        const pool = await poolPromise;

        const checkResult = await pool.request()
            .input('LevelGroupNo', sql.NVarChar, levelGroupNo)
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .execute('mp_LevelInGroupCheckExist');

        if (checkResult.recordset.length > 0 && checkResult.recordset[0].CountExist > 0) {
            return false;
        }

        await pool.request()
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .input('LevelGroupNo', sql.NVarChar, levelGroupNo)
            .input('BeginDate', sql.Date, new Date())
            .input('EndDate', sql.Date, new Date('9999-12-31'))
            .input('CreateBy', sql.NVarChar, createBy)
            .input('CreateDate', sql.DateTime, new Date())
            .execute('mp_LevelInGroupInsert');

        return true;
    }

    async getAllUsers() {
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('mp_UserGet');
        return result.recordset.map((row: any) => ({
            employeeID: row.EmployeeID,
            nameAll: row.NameAll || row.Name
        }));
    }

    async getUsersInGroup(userGroupNo: string) {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .execute('mp_UserInGroupGet');
        return result.recordset.map((row: any) => ({
            employeeID: row.EmployeeID,
            nameAll: row.NameAll || row.Name,
            userGroupNo: row.UserGroupNo
        }));
    }

    async insertUserInGroup(userGroupNo: string, employeeID: string, createBy: string) {
        const pool = await poolPromise;

        const checkResult = await pool.request()
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .input('EmployeeID', sql.NVarChar, employeeID)
            .execute('mp_UserInGroupCheckExist');

        if (checkResult.recordset.length > 0 && checkResult.recordset[0].CountExist > 0) {
            return false;
        }

        await pool.request()
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .input('EmployeeID', sql.NVarChar, employeeID)
            .input('BeginDate', sql.Date, new Date())
            .input('EndDate', sql.Date, new Date('9999-12-31'))
            .input('CreateBy', sql.NVarChar, createBy)
            .input('CreateDate', sql.DateTime, new Date())
            .execute('mp_UserInGroupInsert');

        return true;
    }

    async deleteUserInGroup(userGroupNo: string, employeeID: string, updateBy: string) {
        const pool = await poolPromise;

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        await pool.request()
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .input('EmployeeID', sql.NVarChar, employeeID)
            .input('EndDate', sql.Date, yesterday)
            .input('UpdateBy', sql.NVarChar, updateBy)
            .input('UpdateDate', sql.DateTime, new Date())
            .execute('mp_UserInGroupUpdate');
    }

    async deleteLevelInGroup(userGroupNo: string, levelGroupNo: string, updateBy: string) {
        const pool = await poolPromise;

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        await pool.request()
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .input('LevelGroupNo', sql.NVarChar, levelGroupNo)
            .input('EndDate', sql.Date, yesterday)
            .input('UpdateBy', sql.NVarChar, updateBy)
            .input('UpdateDate', sql.DateTime, new Date())
            .execute('mp_LevelInGroupUpdate');
    }

    async getGroupsForUser(employeeID: string) {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('EmployeeID', sql.NVarChar, employeeID)
            .execute('mp_UserInGroupByEmployeeID');
        return result.recordset.map((row: any) => ({
            userGroupNo: row.UserGroupNo,
            userGroupName: row.UserGroupName
        }));

    }
}

export default new UserGroupService();
