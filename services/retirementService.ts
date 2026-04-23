import { sql, poolPromise } from '../config/db.js';

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

    private async upsertRateByStoredProcedure(
        transaction: sql.Transaction,
        effectiveYear: number,
        year: number,
        typeRate: number,
        rate: number,
        base: number,
        user: string,
        now: Date
    ) {
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

    private async upsertRateByDirectTable(
        transaction: sql.Transaction,
        effectiveYear: number,
        year: number,
        typeRate: number,
        rate: number,
        base: number,
        user: string,
        now: Date
    ) {
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
        const asOfDate = `${effectiveYear}-01-01`;
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

                const result = await request.query(plan.sqlText);
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

    async getRetirementData(effectiveYear: number) {
        const pool = await poolPromise;
        try {
            const ratesResult = await pool.request()
                .input('EffectiveYear', sql.Int, effectiveYear)
                .execute('mp_BUSupportRateGet');

            let rates: Array<Record<string, unknown>> = Array.isArray(ratesResult.recordset) ? ratesResult.recordset : [];
            const hasTypeRate = rates.some((row: { TypeRate?: unknown }) => row.TypeRate !== null && row.TypeRate !== undefined);
            const hasBase = rates.some((row: { Base?: unknown }) => row.Base !== null && row.Base !== undefined);

            // Some DB environments/SP versions may not return TypeRate.
            // Fallback to direct table query so BU/Support can still be split correctly.
            if (!hasTypeRate || !hasBase) {
                const fallbackRatesResult = await pool.request()
                    .input('EffectiveYear', sql.Int, effectiveYear)
                    .query(`
                        SELECT
                            BUSupportRateID,
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
                        FROM MP_BUSupportRate
                        WHERE EffectiveYear = @EffectiveYear
                        ORDER BY [Year], TypeRate
                    `);
                rates = Array.isArray(fallbackRatesResult.recordset) ? fallbackRatesResult.recordset : [];
            }

            rates = rates.map((row: { TypeRate?: unknown }) => {
                const parsedTypeRate = Number(row.TypeRate);
                const parsedBase = Number((row as { Base?: unknown }).Base);
                return {
                    ...row,
                    TypeRate: parsedTypeRate === 2 ? 2 : 1,
                    Base: Number.isFinite(parsedBase) && parsedBase > 0 ? Math.trunc(parsedBase) : 1
                };
            });
            let remark = '';
            let levelGroupNo = '';

            const remarkResult = await pool.request()
                .input('EffectiveYear', sql.Int, effectiveYear)
                .execute('mp_BUSupportRateRemarkGet');

            if (remarkResult.recordset.length > 0) {
                remark = remarkResult.recordset[0].Remark;
                levelGroupNo = this.normalizeLevelGroupNo(remarkResult.recordset[0].LevelGroupNo);
            }

            try {
                const remarkFallback = await pool.request()
                    .input('EffectiveYear', sql.Int, effectiveYear)
                    .query(`
                        SELECT TOP (1)
                            LTRIM(RTRIM(CAST(Remark AS nvarchar(500)))) AS Remark,
                            LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(16)))) AS LevelGroupNo
                        FROM MP_BUSupportRateRemark
                        WHERE EffectiveYear = @EffectiveYear
                        ORDER BY TRY_CONVERT(bigint, BUSupportRateRemarkID) DESC
                    `);

                if (Array.isArray(remarkFallback.recordset) && remarkFallback.recordset.length > 0) {
                    const row = remarkFallback.recordset[0] as Record<string, unknown>;
                    remark = String(row.Remark || '').trim();
                    levelGroupNo = this.normalizeLevelGroupNo(row.LevelGroupNo);
                }
            } catch {
                // Keep SP result when direct table fallback is not available.
            }

            const levelGroups = await this.getRetirementLevelOptions(pool, effectiveYear);

            return { rates, remark, levelGroupNo, levelGroups };
        } catch (err) {
            console.error('Error in RetirementService.getRetirementData:', err);
            throw err;
        }
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
            const now = new Date();
            const normalizedLevelGroupNo = this.normalizeLevelGroupNo(levelGroupNo);
            let useStoredProcedureWithTypeRate = await this.supportsTypeRateInUpsertSP(transaction);

            // 1. Upsert rates in MP_BUSupportRate
            for (const item of rates) {
                const parsedTypeRate = Number(item.typeRate);
                const typeRate = parsedTypeRate === 2 ? 2 : 1;
                const year = Number(item.year);
                const rate = Number(item.rate);
                const base = Number(item.base);

                const safeYear = Number.isFinite(year) ? year : effectiveYear;
                const safeRate = Number.isFinite(rate) ? rate : 0;
                const safeBase = Number.isFinite(base) && base > 0 ? Math.trunc(base) : 1;

                if (useStoredProcedureWithTypeRate) {
                    try {
                        await this.upsertRateByStoredProcedure(
                            transaction,
                            effectiveYear,
                            safeYear,
                            typeRate,
                            safeRate,
                            safeBase,
                            user,
                            now
                        );
                        continue;
                    } catch (error) {
                        if (!this.isTooManyArgumentsError(error)) {
                            throw error;
                        }

                        useStoredProcedureWithTypeRate = false;
                    }
                }

                await this.upsertRateByDirectTable(
                    transaction,
                    effectiveYear,
                    safeYear,
                    typeRate,
                    safeRate,
                    safeBase,
                    user,
                    now
                );
            }

            // 2. Upsert remark in MP_BUSupportRateRemark
            await new sql.Request(transaction)
                .input('EffectiveYear', sql.Int, effectiveYear)
                .input('Remark', sql.VarChar(500), remark)
                .input('User', sql.VarChar(20), user)
                .input('Now', sql.DateTime, now)
                .execute('mp_BUSupportRateRemarkUpsert');

            await new sql.Request(transaction)
                .input('EffectiveYear', sql.Int, effectiveYear)
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
        const data = await this.getRetirementData(fromYear);
        if (data.rates.length === 0) {
            return { success: false, message: 'No data found for the source year.' };
        }

        const newRates = (data.rates as Array<Record<string, unknown>>).map((r) => {
            const sourceYear = Number(r.Year);
            const sourceRate = Number(r.Rate);
            return {
                year: toYear + ((Number.isFinite(sourceYear) ? sourceYear : fromYear) - fromYear),
                rate: Number.isFinite(sourceRate) ? sourceRate : 0,
                base: Number.isFinite(Number(r.Base)) && Number(r.Base) > 0 ? Math.trunc(Number(r.Base)) : 1,
                typeRate: Number(r.TypeRate) === 2 ? 2 : 1
            };
        });

        return this.saveRetirementData(toYear, newRates, data.remark, data.levelGroupNo || '', user);
    }
}

export default new RetirementService();
