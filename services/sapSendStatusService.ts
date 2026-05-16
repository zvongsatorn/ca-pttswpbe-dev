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

    const result = await request.execute('MP_SendSapResetStatusForTransactions');

    return (result.rowsAffected || []).reduce((total, count) => total + count, 0);
};
