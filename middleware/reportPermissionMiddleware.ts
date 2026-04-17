import { Context, Next } from 'hono';
import menuService from '../services/menuService.js';

const REPORT_API_PREFIX = '/api/report';

const resolveRequiredReportPaths = (requestPath: string): string[] => {
    const cleanPath = (requestPath || '').split('?')[0].replace(/\/+$/g, '').toLowerCase();
    if (!cleanPath) return [];

    const subPath = cleanPath.startsWith(REPORT_API_PREFIX)
        ? cleanPath.slice(REPORT_API_PREFIX.length)
        : cleanPath;

    const normalizedSubPath = subPath.startsWith('/') ? subPath : `/${subPath}`;

    if (normalizedSubPath === '/dashboard' || normalizedSubPath === '/dashboard/excel') {
        return ['/report/dashboard', '/report'];
    }

    const reportMatch = normalizedSubPath.match(/^\/report(\d+)(?:\/(excel|filters))?$/);
    if (reportMatch) {
        const reportNo = reportMatch[1];
        return [`/report/report${reportNo}`];
    }

    return [];
};

export const verifyReportMenuAccess = async (c: Context, next: Next) => {
    const decodedUser = (c.req as any).user as {
        id?: string | number;
        groups?: Array<{
            userGroupRole?: string;
            UserGroupRole?: string;
            role?: string;
        }>;
    } | undefined;
    const employeeID = String(decodedUser?.id || '').trim();
    if (!employeeID) {
        return c.json({ message: 'Unauthorized: Invalid user context' }, 401);
    }

    let preferredRole = '';
    if (Array.isArray(decodedUser?.groups)) {
        for (const group of decodedUser.groups) {
            const roleCandidate = String(
                group?.userGroupRole ??
                group?.UserGroupRole ??
                group?.role ??
                ''
            ).trim();
            if (roleCandidate) {
                preferredRole = roleCandidate;
                break;
            }
        }
    }

    // Keep this explicit so new report endpoints must be intentionally mapped.
    const requiredPaths = resolveRequiredReportPaths(c.req.path);
    if (requiredPaths.length === 0) {
        return c.json({ message: 'Forbidden: Report permission mapping not configured' }, 403);
    }

    const hasPermission = await menuService.hasMenuPathAccessForUser(employeeID, requiredPaths, preferredRole);
    if (!hasPermission) {
        return c.json({ message: 'Forbidden: You do not have permission to access this report' }, 403);
    }

    await next();
};
