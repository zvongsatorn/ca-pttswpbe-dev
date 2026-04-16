import { sql, poolPromise } from '../config/db.js';

interface RetirementRateInput {
    year: number;
    rate: number;
    typeRate?: number;
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
        user: string,
        now: Date
    ) {
        await new sql.Request(transaction)
            .input('EffectiveYear', sql.Int, effectiveYear)
            .input('Year', sql.Int, year)
            .input('TypeRate', sql.Int, typeRate)
            .input('Rate', sql.Decimal(18, 2), rate)
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
        user: string,
        now: Date
    ) {
        await new sql.Request(transaction)
            .input('EffectiveYear', sql.Int, effectiveYear)
            .input('Year', sql.Int, year)
            .input('TypeRate', sql.Int, typeRate)
            .input('Rate', sql.Decimal(18, 2), rate)
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
                        1,
                        @User,
                        @Now,
                        @User,
                        @Now
                    );
                END
            `);
    }

    async getRetirementData(effectiveYear: number) {
        const pool = await poolPromise;
        try {
            const ratesResult = await pool.request()
                .input('EffectiveYear', sql.Int, effectiveYear)
                .execute('mp_BUSupportRateGet');

            let rates: Array<Record<string, unknown>> = Array.isArray(ratesResult.recordset) ? ratesResult.recordset : [];
            const hasTypeRate = rates.some((row: { TypeRate?: unknown }) => row.TypeRate !== null && row.TypeRate !== undefined);

            // Some DB environments/SP versions may not return TypeRate.
            // Fallback to direct table query so BU/Support can still be split correctly.
            if (!hasTypeRate) {
                const fallbackRatesResult = await pool.request()
                    .input('EffectiveYear', sql.Int, effectiveYear)
                    .query(`
                        SELECT
                            BUSupportRateID,
                            EffectiveYear,
                            [Year],
                            TypeRate,
                            Rate,
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
                return {
                    ...row,
                    TypeRate: parsedTypeRate === 2 ? 2 : 1
                };
            });
            let remark = '';

            const remarkResult = await pool.request()
                .input('EffectiveYear', sql.Int, effectiveYear)
                .execute('mp_BUSupportRateRemarkGet');

            if (remarkResult.recordset.length > 0) {
                remark = remarkResult.recordset[0].Remark;
            }

            return { rates, remark };
        } catch (err) {
            console.error('Error in RetirementService.getRetirementData:', err);
            throw err;
        }
    }

    async saveRetirementData(effectiveYear: number, rates: RetirementRateInput[], remark: string, user: string) {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const now = new Date();
            let useStoredProcedureWithTypeRate = await this.supportsTypeRateInUpsertSP(transaction);

            // 1. Upsert rates in MP_BUSupportRate
            for (const item of rates) {
                const parsedTypeRate = Number(item.typeRate);
                const typeRate = parsedTypeRate === 2 ? 2 : 1;
                const year = Number(item.year);
                const rate = Number(item.rate);

                const safeYear = Number.isFinite(year) ? year : effectiveYear;
                const safeRate = Number.isFinite(rate) ? rate : 0;

                if (useStoredProcedureWithTypeRate) {
                    try {
                        await this.upsertRateByStoredProcedure(
                            transaction,
                            effectiveYear,
                            safeYear,
                            typeRate,
                            safeRate,
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
                typeRate: Number(r.TypeRate) === 2 ? 2 : 1
            };
        });

        return this.saveRetirementData(toYear, newRates, data.remark, user);
    }
}

export default new RetirementService();
