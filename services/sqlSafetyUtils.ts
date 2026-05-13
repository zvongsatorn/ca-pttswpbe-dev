import { sql } from '../config/db.js';

export type SqlInputParam = {
    name: string;
    type: unknown;
    value: unknown;
};

export type AllowlistedSql = string & { readonly __allowlistedSql: unique symbol };

type SqlRequestLike = {
    input: (name: string, type: any, value: unknown) => unknown;
};

const SQL_IDENTIFIER_PATTERN = /^[A-Za-z_]\w*$/;
const SQL_FRAGMENT_PATTERN = /^[\w\[\]@().=,\s]+$/;

export const escapeSqlIdentifier = (value: string): string => {
    if (!SQL_IDENTIFIER_PATTERN.test(value)) {
        throw new Error(`Unsupported SQL identifier: ${value}`);
    }
    return `[${value}]`;
};

export const buildAllowedObjectFullName = (
    schemaName: string,
    objectName: string,
    allowedSchemas: string[],
    allowedObjects: string[],
    sourceLabel = 'object'
): string => {
    const normalizedSchema = schemaName.trim().toLowerCase();
    const normalizedObject = objectName.trim().toLowerCase();
    const matchedSchema = allowedSchemas.find((schema) => schema === schemaName)
        || allowedSchemas.find((schema) => schema.toLowerCase() === normalizedSchema);
    const matchedObject = allowedObjects.find((object) => object === objectName)
        || allowedObjects.find((object) => object.toLowerCase() === normalizedObject);

    if (!matchedSchema || !matchedObject) {
        throw new Error(`Unsupported ${sourceLabel} source: ${schemaName}.${objectName}`);
    }

    return `${escapeSqlIdentifier(matchedSchema)}.${escapeSqlIdentifier(matchedObject)}`;
};

export const buildSqlInParams = (
    values: readonly unknown[],
    prefix: string,
    type: unknown = sql.NVarChar(128)
): { placeholders: string; params: SqlInputParam[] } => {
    const params = values.map((value, index) => ({
        name: `${prefix}${index}`,
        type,
        value
    }));

    return {
        placeholders: params.map((param) => `@${param.name}`).join(','),
        params
    };
};

export const bindSqlInputParams = <T extends SqlRequestLike>(request: T, params: SqlInputParam[]): T => {
    params.forEach((param) => request.input(param.name, param.type as any, param.value));
    return request;
};

export const toAllowlistedSql = (command: string): AllowlistedSql => {
    if (!String(command || '').trim()) {
        throw new Error('Empty SQL command');
    }
    return command as AllowlistedSql;
};

export const queryAllowlistedSql = <T = Record<string, unknown>>(
    request: sql.Request,
    command: AllowlistedSql
): Promise<sql.IResult<T>> => {
    return request.query<T>(command);
};

export const buildSqlFragmentList = (parts: string[]): string => {
    if (!parts.length) throw new Error('Empty SQL fragment list');
    parts.forEach((part) => {
        if (!SQL_FRAGMENT_PATTERN.test(part)) {
            throw new Error(`Unsupported SQL fragment: ${part}`);
        }
    });
    return parts.join(', ');
};

export const pickColumnName = (columns: Map<string, string>, candidates: string[]): string | null => {
    for (const candidate of candidates) {
        const found = columns.get(candidate.toLowerCase());
        if (found === candidate) return candidate;
    }

    for (const candidate of candidates) {
        const found = columns.get(candidate.toLowerCase());
        if (found && SQL_IDENTIFIER_PATTERN.test(found) && SQL_IDENTIFIER_PATTERN.test(candidate)) return candidate;
    }

    return null;
};
