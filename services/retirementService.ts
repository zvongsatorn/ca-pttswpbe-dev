import { sql, poolPromise } from '../config/db.js';
import { queryAllowlistedSql, toAllowlistedSql } from './sqlSafetyUtils.js';

interface RetirementRateInput {
    year: number;
    rate: number;
    base?: number;
    typeRate?: number;
}

interface RetirementLevelOption {
    LevelGroupNo: string;
    LevelGroupName: string;
    LevelDelayOrder: number | null;
}

interface LevelOptionQueryConfig {
    sqlText: string;
    bindAsOfDate?: boolean;
}

interface MpLevelGroupColumnResolution {
    activeColumn: string | null;
    orderColumn: string | null;
}

interface RateUpsertParams {
    transaction: sql.Transaction;
    effectiveYear: number;
    year: number;
    typeRate: number;
    rate: number;
    base: number;
    user: string;
    now: Date;
}

class RetirementService {
    private isTooManyArgumentsError(error: unknown): boolean {
        const message = String((error as { message?: unknown })?.message || error || '').toLowerCase();
        return message.includes('mp_busupportrateupsert') && message.includes('too many arguments');
    }

    private async supportsTypeRateInUpsertSP(transaction: sql.Transaction): Promise<boolean> {
        try {
            const result = await new sql.Request(transaction).query(`
                SELECT TOP (1) 1 AS HasTypeRate
                FROM sys.parameters p
                INNER JOIN sys.procedures s ON s.object_id = p.object_id
                WHERE s.name = 'mp_BUSupportRateUpsert'
                  AND p.name = '@TypeRate'
            `);
            return Array.isArray(result.recordset) && result.recordset.length > 0;
        } catch {
            // If metadata inspection fails, keep old behavior and fallback by catching runtime error.
            return true;
        }
    }

    private async upsertRateByStoredProcedure(params: RateUpsertParams) {
        const { transaction, effectiveYear, year, typeRate, rate, base, user, now } = params;
        await new sql.Request(transaction)
            .input('EffectiveYear', sql.Int, effectiveYear)
            .input('Year', sql.Int, year)
            .input('TypeRate', sql.Int, typeRate)
            .input('Rate', sql.Decimal(18, 2), rate)
            .input('Base', sql.Int, base)
            .input('User', sql.VarChar(20), user)
            .input('Now', sql.DateTime, now)
            .execute('mp_BUSupportRateUpsert');
    }

    private async upsertRateByDirectTable(params: RateUpsertParams) {
        const { transaction, effectiveYear, year, typeRate, rate, base, user, now } = params;
        await new sql.Request(transaction)
            .input('EffectiveYear', sql.Int, effectiveYear)
            .input('Year', sql.Int, year)
            .input('TypeRate', sql.Int, typeRate)
            .input('Rate', sql.Decimal(18, 2), rate)
            .input('Base', sql.Int, base)
            .input('User', sql.VarChar(20), user)
            .input('Now', sql.DateTime, now)
            .query(`
                IF EXISTS (
                    SELECT 1
                    FROM MP_BUSupportRate
                    WHERE EffectiveYear = @EffectiveYear
                      AND [Year] = @Year
                      AND TypeRate = @TypeRate
                )
                BEGIN
                    UPDATE MP_BUSupportRate
                    SET Rate = @Rate,
                        Base = @Base,
                        BUSupportRateStatus = COALESCE(BUSupportRateStatus, 1),
                        UpdateBy = @User,
                        UpdateDate = @Now
                    WHERE EffectiveYear = @EffectiveYear
                      AND [Year] = @Year
                      AND TypeRate = @TypeRate;
                END
                ELSE
                BEGIN
                    INSERT INTO MP_BUSupportRate (
                        EffectiveYear,
                        [Year],
                        TypeRate,
                        Rate,
                        Base,
                        BUSupportRateStatus,
                        CreateBy,
                        CreateDate,
                        UpdateBy,
                        UpdateDate
                    )
                    VALUES (
                        @EffectiveYear,
                        @Year,
                        @TypeRate,
                        @Rate,
                        @Base,
                        1,
                        @User,
                        @Now,
                        @User,
                        @Now
                    );
                END
            `);
    }

    private normalizeLevelGroupNo(value: unknown): string {
        return String(value || '').trim();
    }

    private toBEYear(value: unknown): number {
        const year = Number(value);
        if (!Number.isFinite(year)) return new Date().getFullYear() + 543;
        return year < 2500 ? Math.trunc(year) + 543 : Math.trunc(year);
    }

    private toADYear(value: unknown): number {
        const year = Number(value);
        if (!Number.isFinite(year)) return new Date().getFullYear();
        return year > 2500 ? Math.trunc(year) - 543 : Math.trunc(year);
    }

    private escapeSqlIdentifier(value: string): string {
        return `[${String(value || '').replace(/]/g, ']]')}]`;
    }

    private async resolveMpLevelGroupColumns(pool: sql.ConnectionPool): Promise<MpLevelGroupColumnResolution> {
        try {
            const result = await pool.request()
                .query(`
                    SELECT c.name AS ColumnName
                    FROM sys.columns c
                    INNER JOIN sys.objects o ON o.object_id = c.object_id
                    WHERE o.type = 'U'
                      AND o.name = 'MP_LevelGroup'
                `);

            const rows = Array.isArray(result.recordset) ? result.recordset as Array<Record<string, unknown>> : [];
            const columnMap = new Map<string, string>();
            rows.forEach((row) => {
                const name = String(row.ColumnName || '').trim();
                if (!name) return;
                columnMap.set(name.toLowerCase(), name);
            });

            const activeColumn =
                columnMap.get('leveldelayactiive') ||
                columnMap.get('leveldelayactive') ||
                columnMap.get('leveldalayactive') ||
                null;

            const orderColumn =
                columnMap.get('leveldelayorder') ||
                columnMap.get('leveldalayorder') ||
                columnMap.get('levelgrouporder') ||
                null;

            return { activeColumn, orderColumn };
        } catch {
            return { activeColumn: null, orderColumn: null };
        }
    }

    private mapRetirementLevelOptions(rows: Array<Record<string, unknown>>): RetirementLevelOption[] {
        return rows
            .map((row) => ({
                LevelGroupNo: this.normalizeLevelGroupNo(row.LevelGroupNo),
                LevelGroupName: String(row.LevelGroupName || '').trim(),
                LevelDelayOrder: row.LevelDelayOrder === null || row.LevelDelayOrder === undefined
                    ? null
                    : Number(row.LevelDelayOrder)
            }))
            .filter((row) => row.LevelGroupNo && row.LevelGroupName);
    }

    private async getRetirementLevelOptions(pool: sql.ConnectionPool, effectiveYear: number): Promise<RetirementLevelOption[]> {
        const asOfDate = `${this.toADYear(effectiveYear)}-01-01`;
        const resolvedColumns = await this.resolveMpLevelGroupColumns(pool);
        const activeFilter = resolvedColumns.activeColumn
            ? `
                      AND ISNULL(TRY_CONVERT(int, ${this.escapeSqlIdentifier(resolvedColumns.activeColumn)}), 0) = 1`
            : '';
        const delayOrderExpression = resolvedColumns.orderColumn
            ? `TRY_CONVERT(int, ${this.escapeSqlIdentifier(resolvedColumns.orderColumn)})`
            : 'NULL';
        const queryPlans: LevelOptionQueryConfig[] = [
            {
                sqlText: `
                    SELECT
                        LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(16)))) AS LevelGroupNo,
                        LTRIM(RTRIM(CAST(LevelGroupName AS nvarchar(255)))) AS LevelGroupName,
                        ${delayOrderExpression} AS LevelDelayOrder
                    FROM MP_LevelGroup
                    WHERE 1 = 1${activeFilter}
                    ORDER BY
                        COALESCE(${delayOrderExpression}, -9999) DESC,
                        LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(16))))
                `
            },
            {
                sqlText: `
                    SELECT
                        LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(16)))) AS LevelGroupNo,
                        LTRIM(RTRIM(CAST(LevelGroupName AS nvarchar(255)))) AS LevelGroupName,
                        ${delayOrderExpression} AS LevelDelayOrder
                    FROM MP_LevelGroup
                    WHERE
                        @AsOfDate BETWEEN
                        COALESCE(TRY_CONVERT(date, BeginDate), @AsOfDate) AND
                        COALESCE(TRY_CONVERT(date, EndDate), @AsOfDate)${activeFilter}
                    ORDER BY
                        COALESCE(${delayOrderExpression}, -9999) DESC,
                        LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(16))))
                `,
                bindAsOfDate: true
            },
            {
                sqlText: `
                    SELECT
                        LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(16)))) AS LevelGroupNo,
                        LTRIM(RTRIM(CAST(LevelGroupName AS nvarchar(255)))) AS LevelGroupName,
                        CAST(NULL AS int) AS LevelDelayOrder
                    FROM MP_LevelGroup
                    WHERE 1 = 1${activeFilter}
                    ORDER BY
                        LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(16))))
                `
            }
        ];

        for (const plan of queryPlans) {
            try {
                const request = pool.request();
                if (plan.bindAsOfDate) {
                    request.input('AsOfDate', sql.Date, asOfDate);
                }

                const result = await queryAllowlistedSql(request, toAllowlistedSql(plan.sqlText));
                const rows = Array.isArray(result.recordset) ? result.recordset as Array<Record<string, unknown>> : [];
                const options = this.mapRetirementLevelOptions(rows);
                if (options.length > 0) {
                    return options;
                }
            } catch {
                // Fallback to next query plan.
            }
        }

        return [];
    }

    private async getRateRowsByStoredProcedure(pool: sql.ConnectionPool, effectiveYearBE: number): Promise<Array<Record<string, unknown>>> {
        const ratesResult = await pool.request()
            .input('EffectiveYear', sql.Int, effectiveYearBE)
            .execute('mp_BUSupportRateGet');
        return Array.isArray(ratesResult.recordset) ? ratesResult.recordset : [];
    }

    private rateRowsNeedDirectFallback(rates: Array<Record<string, unknown>>): boolean {
        const hasTypeRate = rates.some((row) => row.TypeRate !== null && row.TypeRate !== undefined);
        const hasBase = rates.some((row) => row.Base !== null && row.Base !== undefined);
        return !hasTypeRate || !hasBase;
    }

    private buildRateRowsSql(targetEffectiveYear?: number): string {
        const effectiveYearExpr = targetEffectiveYear === undefined ? 'EffectiveYear' : '@TargetEffectiveYear AS EffectiveYear';
        const yearExpr = targetEffectiveYear === undefined
            ? '[Year]'
            : [
                'CASE',
                '    WHEN TRY_CONVERT(int, [Year]) < 2500 THEN TRY_CONVERT(int, [Year]) + 543',
                '    ELSE TRY_CONVERT(int, [Year])',
                'END AS [Year]'
            ].join('\n');

        return [
            'SELECT',
            '    BUSupportRateID,',
            '    ' + effectiveYearExpr + ',',
            '    ' + yearExpr + ',',
            '    TypeRate,',
            '    Rate,',
            '    Base,',
            '    BUSupportRateStatus,',
            '    CreateBy,',
            '    CreateDate,',
            '    UpdateBy,',
            '    UpdateDate',
            'FROM MP_BUSupportRate',
            'WHERE EffectiveYear = @EffectiveYear',
            'ORDER BY [Year], TypeRate'
        ].join('\n');
    }

    private async getRateRowsFromTable(
        pool: sql.ConnectionPool,
        sourceEffectiveYear: number,
        targetEffectiveYear?: number
    ): Promise<Array<Record<string, unknown>>> {
        const request = pool.request().input('EffectiveYear', sql.Int, sourceEffectiveYear);
        if (targetEffectiveYear !== undefined) {
            request.input('TargetEffectiveYear', sql.Int, targetEffectiveYear);
        }

        const result = await queryAllowlistedSql(request, toAllowlistedSql(this.buildRateRowsSql(targetEffectiveYear)));
        return Array.isArray(result.recordset) ? result.recordset : [];
    }

    private async getRetirementRateRows(
        pool: sql.ConnectionPool,
        effectiveYearBE: number,
        legacyEffectiveYearAD: number
    ): Promise<Array<Record<string, unknown>>> {
        let rates = await this.getRateRowsByStoredProcedure(pool, effectiveYearBE);

        // Some DB environments/SP versions may not return TypeRate.
        // Fallback to direct table query so BU/Support can still be split correctly.
        if (this.rateRowsNeedDirectFallback(rates)) {
            rates = await this.getRateRowsFromTable(pool, effectiveYearBE);
        }

        if (!rates.length && legacyEffectiveYearAD !== effectiveYearBE) {
            try {
                rates = await this.getRateRowsFromTable(pool, legacyEffectiveYearAD, effectiveYearBE);
            } catch {
                rates = [];
            }
        }

        return rates;
    }

    private normalizeRetirementRateRows(
        rates: Array<Record<string, unknown>>,
        effectiveYearBE: number
    ): Array<Record<string, unknown>> {
        return rates.map((row) => {
            const parsedTypeRate = Number(row.TypeRate);
            const parsedBase = Number(row.Base);
            return {
                ...row,
                EffectiveYear: this.toBEYear(row.EffectiveYear ?? effectiveYearBE),
                Year: this.toBEYear(row.Year),
                TypeRate: parsedTypeRate === 2 ? 2 : 1,
                Base: Number.isFinite(parsedBase) && parsedBase > 0 ? Math.trunc(parsedBase) : 1
            };
        });
    }

    private mapRemarkRow(row: Record<string, unknown> | undefined) {
        return {
            remark: String(row?.Remark || '').trim(),
            levelGroupNo: this.normalizeLevelGroupNo(row?.LevelGroupNo)
        };
    }

    private async getRemarkFromStoredProcedure(pool: sql.ConnectionPool, effectiveYearBE: number) {
        const remarkResult = await pool.request()
            .input('EffectiveYear', sql.Int, effectiveYearBE)
            .execute('mp_BUSupportRateRemarkGet');
        return this.mapRemarkRow(remarkResult.recordset?.[0] as Record<string, unknown> | undefined);
    }

    private buildRemarkSql(): string {
        return [
            'SELECT TOP (1)',
            '    LTRIM(RTRIM(CAST(Remark AS nvarchar(500)))) AS Remark,',
            '    LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(16)))) AS LevelGroupNo',
            'FROM MP_BUSupportRateRemark',
            'WHERE EffectiveYear = @EffectiveYear',
            'ORDER BY TRY_CONVERT(bigint, BUSupportRateRemarkID) DESC'
        ].join('\n');
    }

    private async getRemarkFromTable(pool: sql.ConnectionPool, effectiveYear: number) {
        const request = pool.request().input('EffectiveYear', sql.Int, effectiveYear);
        const result = await queryAllowlistedSql(request, toAllowlistedSql(this.buildRemarkSql()));

        if (!Array.isArray(result.recordset) || result.recordset.length === 0) return null;
        return this.mapRemarkRow(result.recordset[0] as Record<string, unknown>);
    }

    private async getRetirementRemark(
        pool: sql.ConnectionPool,
        effectiveYearBE: number,
        legacyEffectiveYearAD: number
    ) {
        let { remark, levelGroupNo } = await this.getRemarkFromStoredProcedure(pool, effectiveYearBE);

        try {
            const fallback = await this.getRemarkFromTable(pool, effectiveYearBE);
            if (fallback) {
                remark = fallback.remark;
                levelGroupNo = fallback.levelGroupNo;
            }
        } catch {
            // Keep SP result when direct table fallback is not available.
        }

        if (!remark && legacyEffectiveYearAD !== effectiveYearBE) {
            try {
                const legacyFallback = await this.getRemarkFromTable(pool, legacyEffectiveYearAD);
                if (legacyFallback) {
                    remark = legacyFallback.remark;
                    levelGroupNo = legacyFallback.levelGroupNo;
                }
            } catch {
                // Ignore legacy lookup errors.
            }
        }

        return { remark, levelGroupNo };
    }

    async getRetirementData(effectiveYear: number) {
        const pool = await poolPromise;
        try {
            const effectiveYearBE = this.toBEYear(effectiveYear);
            const legacyEffectiveYearAD = this.toADYear(effectiveYearBE);
            const rateRows = await this.getRetirementRateRows(pool, effectiveYearBE, legacyEffectiveYearAD);
            const rates = this.normalizeRetirementRateRows(rateRows, effectiveYearBE);
            const { remark, levelGroupNo } = await this.getRetirementRemark(pool, effectiveYearBE, legacyEffectiveYearAD);
            const levelGroups = await this.getRetirementLevelOptions(pool, effectiveYearBE);

            return { rates, remark, levelGroupNo, levelGroups };
        } catch (err) {
            console.error('Error in RetirementService.getRetirementData:', err);
            throw err;
        }
    }

    private buildRateUpsertParams(
        transaction: sql.Transaction,
        item: RetirementRateInput,
        effectiveYearBE: number,
        user: string,
        now: Date
    ): RateUpsertParams {
        const parsedTypeRate = Number(item.typeRate);
        const typeRate = parsedTypeRate === 2 ? 2 : 1;
        const year = Number(item.year);
        const rate = Number(item.rate);
        const base = Number(item.base);

        return {
            transaction,
            effectiveYear: effectiveYearBE,
            year: Number.isFinite(year) ? this.toBEYear(year) : effectiveYearBE,
            typeRate,
            rate: Number.isFinite(rate) ? rate : 0,
            base: Number.isFinite(base) && base > 0 ? Math.trunc(base) : 1,
            user,
            now
        };
    }

    private async upsertRateItem(upsertParams: RateUpsertParams, useStoredProcedureWithTypeRate: boolean): Promise<boolean> {
        if (useStoredProcedureWithTypeRate) {
            try {
                await this.upsertRateByStoredProcedure(upsertParams);
                return true;
            } catch (error) {
                if (!this.isTooManyArgumentsError(error)) {
                    throw error;
                }
            }
        }

        await this.upsertRateByDirectTable(upsertParams);
        return false;
    }

    async saveRetirementData(
        effectiveYear: number,
        rates: RetirementRateInput[],
        remark: string,
        levelGroupNo: string,
        user: string
    ) {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const effectiveYearBE = this.toBEYear(effectiveYear);
            const now = new Date();
            const normalizedLevelGroupNo = this.normalizeLevelGroupNo(levelGroupNo);
            let useStoredProcedureWithTypeRate = await this.supportsTypeRateInUpsertSP(transaction);

            // 1. Upsert rates in MP_BUSupportRate
            for (const item of rates) {
                const upsertParams = this.buildRateUpsertParams(transaction, item, effectiveYearBE, user, now);
                useStoredProcedureWithTypeRate = await this.upsertRateItem(upsertParams, useStoredProcedureWithTypeRate);
            }

            // 2. Upsert remark in MP_BUSupportRateRemark
            await new sql.Request(transaction)
                .input('EffectiveYear', sql.Int, effectiveYearBE)
                .input('Remark', sql.VarChar(500), remark)
                .input('User', sql.VarChar(20), user)
                .input('Now', sql.DateTime, now)
                .execute('mp_BUSupportRateRemarkUpsert');

            await new sql.Request(transaction)
                .input('EffectiveYear', sql.Int, effectiveYearBE)
                .input('LevelGroupNo', sql.VarChar(4), normalizedLevelGroupNo || null)
                .query(`
                    UPDATE MP_BUSupportRateRemark
                    SET LevelGroupNo = @LevelGroupNo
                    WHERE EffectiveYear = @EffectiveYear
                `);

            await transaction.commit();
            return { success: true };
        } catch (err) {
            await transaction.rollback();
            console.error('Error in RetirementService.saveRetirementData:', err);
            throw err;
        }
    }

    async copyRetirementData(fromYear: number, toYear: number, user: string) {
        const fromYearBE = this.toBEYear(fromYear);
        const toYearBE = this.toBEYear(toYear);
        const data = await this.getRetirementData(fromYearBE);
        if (data.rates.length === 0) {
            return { success: false, message: 'No data found for the source year.' };
        }

        const newRates = data.rates.map((r) => {
            const sourceYear = Number(r.Year);
            const sourceRate = Number(r.Rate);
            return {
                year: toYearBE + ((Number.isFinite(sourceYear) ? this.toBEYear(sourceYear) : fromYearBE) - fromYearBE),
                rate: Number.isFinite(sourceRate) ? sourceRate : 0,
                base: Number.isFinite(Number(r.Base)) && Number(r.Base) > 0 ? Math.trunc(Number(r.Base)) : 1,
                typeRate: Number(r.TypeRate) === 2 ? 2 : 1
            };
        });

        return this.saveRetirementData(toYearBE, newRates, data.remark, data.levelGroupNo || '', user);
    }
}

export default new RetirementService();
