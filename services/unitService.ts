import { sql, poolPromise } from '../config/db.js';
import { queryAllowlistedSql, toAllowlistedSql } from './sqlSafetyUtils.js';

const toSqlDateOnly = (value: Date | string): Date => {
    const parsed = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
        const now = new Date();
        return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0));
    }
    return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 0, 0, 0, 0));
};

const normalizeUserGroupNo = (value: string): string => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    return /^\d+$/.test(trimmed) ? trimmed.padStart(2, '0') : trimmed.toUpperCase();
};

const isOtherUserGroup = (roleId: string): boolean => {
    const normalized = normalizeUserGroupNo(roleId);
    return normalized === '08' || normalized === '99' || normalized === 'OTHER';
};

const normalizeEmployeeCodeNoLeadingZero = (employeeId: string): string => {
    const trimmed = String(employeeId || '').trim();
    if (!trimmed) return '';
    const withoutLeadingZero = trimmed.replace(/^0+/, '');
    return withoutLeadingZero || '0';
};

const toTrimmedText = (value: unknown): string => String(value || '').trim();

const getOtherUnitsFromInfoData = async (pool: sql.ConnectionPool, empId: string) => {
    const employeeId = String(empId || '').trim();
    if (!employeeId) return [];

    const employeeCodeNoZero = normalizeEmployeeCodeNoLeadingZero(employeeId);

    const infoReq = new sql.Request(pool);
    infoReq.input('EmployeeID', sql.VarChar(32), employeeId);
    infoReq.input('EmployeeIDNoZero', sql.VarChar(32), employeeCodeNoZero);

    let infoResult;
    try {
        infoResult = await queryAllowlistedSql(infoReq, toAllowlistedSql(`
            SELECT DISTINCT
                LTRIM(RTRIM(CAST(UNITCODE AS varchar(20)))) AS OrgUnitNo
            FROM dbo.InfoData
            WHERE NULLIF(LTRIM(RTRIM(CAST(UNITCODE AS varchar(20)))), '') IS NOT NULL
              AND LTRIM(RTRIM(CAST(CODE AS varchar(20)))) IN (@EmployeeID, @EmployeeIDNoZero)
        `));
    } catch (error: any) {
        const message = String(error?.message || '').toLowerCase();
        if (!message.includes('invalid object name')) {
            throw error;
        }
        infoResult = await queryAllowlistedSql(infoReq, toAllowlistedSql(`
            SELECT DISTINCT
                LTRIM(RTRIM(CAST(UNITCODE AS varchar(20)))) AS OrgUnitNo
            FROM dbo.infodata
            WHERE NULLIF(LTRIM(RTRIM(CAST(UNITCODE AS varchar(20)))), '') IS NOT NULL
              AND LTRIM(RTRIM(CAST(CODE AS varchar(20)))) IN (@EmployeeID, @EmployeeIDNoZero)
        `));
    }

    const orgUnitNos = Array.from(
        new Set<string>(
            (infoResult.recordset || [])
                .map((row: any) => toTrimmedText(row?.OrgUnitNo))
                .filter((code: string) => code !== '')
        )
    );

    if (orgUnitNos.length === 0) {
        return [];
    }

    const unitReq = new sql.Request(pool);
    unitReq.input('EffectiveDate', sql.Date, toSqlDateOnly(new Date()));
    const unitResult = await unitReq.execute('mp_UnitGetByEffectiveDate');

    const unitMap = new Map<string, any>();
    (unitResult.recordset || []).forEach((row: any) => {
        const orgUnitNo = toTrimmedText(row?.OrgUnitNo);
        if (!orgUnitNo) return;
        unitMap.set(orgUnitNo, row);
    });

    return orgUnitNos.map((orgUnitNo) => {
        const unit = unitMap.get(orgUnitNo);
        const unitName = toTrimmedText(unit?.UnitName) || orgUnitNo;
        const unitText = toTrimmedText(unit?.UnitText) || `${orgUnitNo} ${unitName}`.trim();
        const parentOrgUnitNo = toTrimmedText(unit?.ParentOrgUnitNo) || null;

        return {
            id: orgUnitNo,
            name: unitName,
            unitText,
            parentOrgUnitNo,
            ParentOrgUnitNo: parentOrgUnitNo,
            IsAssistant: 0,
            IsUnder: 0,
            IsSecondment: 0
        };
    });
};


/**
 * Service to execute the mp_UserInUnitAndGroupByEmployeeID stored procedure
 * @param empId Employee ID (e.g. 10471192)
 * @param roleId User Group No (e.g. 05)
 * @returns List of units/departments mapped to frontend structure ({ id, name, unitText })
 */
export const getUnitsByRoleService = async (empId: string, roleId: string) => {
    try {
        const pool = await poolPromise;
        if (isOtherUserGroup(roleId)) {
            const unitsFromInfoData = await getOtherUnitsFromInfoData(pool, empId);
            if (unitsFromInfoData.length > 0) {
                return unitsFromInfoData;
            }
        }

        const request = new sql.Request(pool);

        // Bind parameters matching the SP exactly: @EmployeeID, @UserGroupNo
        request.input('EmployeeID', empId);
        request.input('UserGroupNo', roleId);

        // Execute the SP
        const result = await request.execute('mp_UserInUnitAndGroupByEmployeeID');
        
        // Map the structure so Frontend can easily consume it in Select Dropdowns
        if (result && result.recordset) {
            return result.recordset.map(row => ({
                id: row.OrgUnitNo,
                name: row.UnitName,
                unitText: row.UnitText, // e.g. "OrgUnitNo UnitName (Abbr)"
                parentOrgUnitNo: row.ParentOrgUnitNo ? String(row.ParentOrgUnitNo).trim() : null,
                ParentOrgUnitNo: row.ParentOrgUnitNo ? String(row.ParentOrgUnitNo).trim() : null,
                IsAssistant: row.IsAssistant ?? 0,
                IsUnder: row.IsUnder ?? 0,
                IsSecondment: row.IsSecondment ?? 0
            }));
        }
        
        return [];
    } catch (error) {
        console.error('Error executing mp_UserInUnitAndGroupByEmployeeID:', error);
        throw error;
    }
};

/**
 * Service to execute the mp_LevelGroupGetByUnit stored procedure
 * @param checkDate Effective Date or current Date
 * @param unit Unit Code (e.g. 80000032)
 * @param userGroupNo User Group No (e.g. '04')
 */
export const getLevelsByUnitService = async (checkDate: string, unit: string, userGroupNo: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        // Required parameters for mp_LevelGroupGetByUnit
        // declare @p_CheckDate as datetime = '20260301'
        // declare @p_Unit as varchar(8) = '80000032'
        // request.input('p_CheckDate', sql.DateTime, new Date(checkDate));
        
        const year = Number.parseInt(checkDate.substring(0, 4), 10);
        const month = Number.parseInt(checkDate.substring(4, 6), 10);
        const day = Number.parseInt(checkDate.substring(6, 8), 10);
        const checkDateValue = new Date(year, month - 1, day, 0, 0, 0, 0);

        request.input('p_CheckDate', sql.Date, toSqlDateOnly(checkDateValue));
        request.input('p_Unit', sql.VarChar(8), unit);
        request.input('p_UserGroupNo', sql.VarChar(2), userGroupNo);

        const result = await request.execute('mp_LevelGroupGetByUnit');
        
        // Map the structure for Frontend
        if (result && result.recordset) {
            return result.recordset.map(row => ({
                id: row.LevelGroupNo,
                name: row.LevelGroupName,
                nameEN: row.LevelGroupNameEN,
                order: row.LevelGroupOrder,
                top: row.UnitLevelGroupTop
            }));
        }
        
        return [];
    } catch (error) {
        console.error('Error executing mp_LevelGroupGetByUnit:', error);
        throw error;
    }
};

/**
 * Service to execute the mp_UnitGetByEffectiveDate stored procedure
 * Returns all units active on a given effective date
 * @param effectiveDate Date in 'YYYY-MM-DD' format
 */
export const getAllUnitsByEffectiveDateService = async (effectiveDate: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        request.input('EffectiveDate', sql.Date, toSqlDateOnly(effectiveDate));

        const result = await request.execute('mp_UnitGetByEffectiveDate');

        if (result && result.recordset) {
            return result.recordset.map(row => ({
                id: row.OrgUnitNo,
                name: row.UnitName || row.OrgUnitNo,
                shortName: row.UnitAbbr || row.OrgUnitNo,
                parentOrgUnitNo: row.ParentOrgUnitNo || null,
                unitText: row.UnitText || `${row.OrgUnitNo} ${row.UnitName || ''}`.trim(),
                BGNo: row.BGNo ? String(row.BGNo).trim() : null,
                // Legacy support for frontend tree building
                OrgUnitNo: row.OrgUnitNo,
                UnitName: row.UnitName || row.OrgUnitNo,
                UnitAbbr: row.UnitAbbr || row.OrgUnitNo,
                ParentOrgUnitNo: row.ParentOrgUnitNo || null,
            }));
        }

        return [];
    } catch (error) {
        console.error('Error executing mp_UnitGetByEffectiveDate:', error);
        throw error;
    }
};

export interface TransferUnitsByReceiveParams {
    effectiveDate: string;
    division: string;
    orgUnitReceive: string;
    userGroupNo: string;
    employeeId: string;
    selectType?: number;
}

const mapTransferUnitByReceiveRow = (row: any) => ({
    id: row.OrgUnitNo,
    name: row.UnitName || row.OrgUnitNo,
    unitText: row.UnitText || `${row.OrgUnitNo} ${row.UnitName || ""}`.trim(),
    parentOrgUnitNo: row.ParentOrgUnitNo ? String(row.ParentOrgUnitNo).trim() : null,
    ParentOrgUnitNo: row.ParentOrgUnitNo ? String(row.ParentOrgUnitNo).trim() : null,
    OrgUnitNo: row.OrgUnitNo,
    UnitName: row.UnitName || row.OrgUnitNo,
    UnitAbbr: row.UnitAbbr || row.OrgUnitNo,
});

/**
 * Service for transfer type 1 options (legacy parity with DataCombo/GetUnitComboByUnitReceive)
 * Executes mp_UnitGetByLineAndUnitLvlAndEffectivePeriod using:
 * - division (line org unit)
 * - orgUnitReceive
 * - user/group context
 * - effective date
 */
export const getTransferUnitsByReceiveService = async (params: TransferUnitsByReceiveParams) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        request.input('EffectiveDate', sql.Date, toSqlDateOnly(params.effectiveDate));
        request.input('division', sql.VarChar(8), params.division || null);
        request.input('OrgUnitNo', sql.VarChar(8), params.orgUnitReceive || null);
        request.input('UserGroupNO', sql.VarChar(2), params.userGroupNo);
        request.input('EmployeeID', sql.VarChar(8), params.employeeId);
        request.input('p_SelectType', sql.Int, Number.isFinite(params.selectType) ? Number(params.selectType) : 0);

        const result = await request.execute('mp_UnitGetByLineAndUnitLvlAndEffectivePeriod');

        if (result && result.recordset) {
            return result.recordset.map(mapTransferUnitByReceiveRow);
        }
        return [];
    } catch (error) {
        console.error('Error executing mp_UnitGetByLineAndUnitLvlAndEffectivePeriod:', error);
        throw error;
    }
};
