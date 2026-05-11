import { sql } from '../config/db.js';

const normalizeText = (value: unknown): string => String(value ?? '').trim();

const uniqueTransactionNos = (transactionNos: string[]): string[] =>
    Array.from(
        new Set(
            (transactionNos || [])
                .map((txNo) => normalizeText(txNo).substring(0, 10))
                .filter((txNo) => /^[A-Za-z0-9_-]+$/.test(txNo))
                .filter(Boolean)
        )
    );

export const resetSentSapStatusForTransactions = async (
    transaction: sql.Transaction,
    transactionNos: string[]
): Promise<number> => {
    const normalizedTransactionNos = uniqueTransactionNos(transactionNos);
    if (normalizedTransactionNos.length === 0) {
        return 0;
    }

    const request = new sql.Request(transaction);
    request.input('TransactionNosCsv', sql.VarChar(sql.MAX), normalizedTransactionNos.join(','));

    const result = await request.query(`
        WITH TargetSendSap AS (
            SELECT DISTINCT
                CAST(t.EffectiveDate AS date) AS EffectiveDate,
                LTRIM(RTRIM(t.UnitReceive)) AS OrgUnitNo
            FROM MP_Transactions t WITH (NOLOCK)
            WHERE t.TransactionNo IN (
                SELECT LTRIM(RTRIM(value))
                FROM STRING_SPLIT(@TransactionNosCsv, ',')
                WHERE LTRIM(RTRIM(value)) <> ''
            )
              AND NULLIF(LTRIM(RTRIM(t.UnitReceive)), '') IS NOT NULL
        )
        UPDATE sap
        SET sap.SendSapStatus = 1
        FROM MP_SendSap sap
        INNER JOIN TargetSendSap target
            ON CAST(sap.EffectiveDate AS date) = target.EffectiveDate
           AND LTRIM(RTRIM(sap.OrgUnitNo)) = target.OrgUnitNo
        WHERE sap.SendSapStatus = 2;
    `);

    return (result.rowsAffected || []).reduce((total, count) => total + count, 0);
};
