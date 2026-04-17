import { Context } from 'hono';
import menuService from '../services/menuService.js';
interface VerifiedTokenPayload {
    id?: string | number;
    groups?: Array<{
        userGroupRole?: string;
        UserGroupRole?: string;
        role?: string;
    }>;
}

class MenuController {
    private internalServerError(c: Context, error: unknown, logPrefix: string) {
        console.error(logPrefix, error);
        const details = error instanceof Error ? error.message : String(error);
        if (process.env.NODE_ENV === 'local' || process.env.NODE_ENV === 'dev') {
            return c.json({ error: 'Internal Server Error', details }, 500);
        }
        return c.json({ error: 'Internal Server Error' }, 500);
    }

    private getEmployeeID(c: Context): string | null {
        const user = (c.req as any).user as VerifiedTokenPayload | undefined;
        const rawId = user?.id;
        if (typeof rawId !== 'string' && typeof rawId !== 'number') {
            return null;
        }
        const employeeID = String(rawId).trim();
        return employeeID || null;
    }

    private getPreferredRole(c: Context): string {
        const user = (c.req as any).user as VerifiedTokenPayload | undefined;
        const groups = Array.isArray(user?.groups) ? user!.groups : [];
        for (const group of groups) {
            const roleCandidate = String(
                group?.userGroupRole ??
                group?.UserGroupRole ??
                group?.role ??
                ''
            ).trim();
            if (roleCandidate) return roleCandidate;
        }
        return '';
    }

    async getSidebarMenu(c: Context) {
        try {
            const employeeID = this.getEmployeeID(c);
            if (!employeeID) {
                return c.json({ error: 'Unauthorized' }, 401);
            }
            const preferredRole = this.getPreferredRole(c);

            const menu = await menuService.getMenuForUser(employeeID, preferredRole);
            return c.json(menu);

        } catch (error) {
            return this.internalServerError(c, error, 'Error fetching menu:');
        }
    }

    async getMenuRights(c: Context) {
        try {
            const role = c.req.param('role');
            if (!role) return c.json({ error: 'Role is required' }, 400);

            const rights = await menuService.getMenuRights(role);
            return c.json(rights);
        } catch (error) {
            return this.internalServerError(c, error, 'Error fetching menu rights:');
        }
    }

    async saveMenuRights(c: Context) {
        try {
            const body = await c.req.json();
            const { userGroupRole, menuID, hasRight } = body;
            
            if (!userGroupRole || !menuID) {
                return c.json({ error: 'Invalid data' }, 400);
            }

            await menuService.saveMenuRights(userGroupRole, menuID);
            return c.json({ success: true });

        } catch (error) {
           return this.internalServerError(c, error, 'Error saving menu rights:');
        }
    }
    async getSubMenu(c: Context) {
        try {
            const menuKey = c.req.param('menuKey');
            if (!menuKey) return c.json({ error: 'Menu Key is required' }, 400);

            const employeeID = this.getEmployeeID(c);
            if (!employeeID) return c.json({ error: 'Unauthorized' }, 401);
            const preferredRole = this.getPreferredRole(c);

            const subMenu = await menuService.getSubMenu(menuKey, employeeID, preferredRole);
            return c.json(subMenu);
        } catch (error) {
            return this.internalServerError(c, error, 'Error fetching submenu:');
        }
    }
}

const menuController = new MenuController();

export default {
    getSidebarMenu: menuController.getSidebarMenu.bind(menuController),
    getMenuRights: menuController.getMenuRights.bind(menuController),
    saveMenuRights: menuController.saveMenuRights.bind(menuController),
    getSubMenu: menuController.getSubMenu.bind(menuController)
};
