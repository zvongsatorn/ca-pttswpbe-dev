import { sql, poolPromise } from '../config/db.js';

interface MenuItem {
    MenuID: number;
    MenuKey: string;
    MenuName: string;
    MenuTitle: string | null;
    SortNumber: number;
    MenuPath: string | null;
    SubMenu: boolean;
    ShowCounter: boolean;
    Expanded: boolean;
    MenuIcon: string | null;
    ParentID: number | null;
    children?: MenuItem[];
}

class MenuService {
    private normalizeRoleValue(rawRole: unknown): string {
        const role = String(rawRole ?? '').trim();
        return role;
    }

    private getRoleFromRow(row: Record<string, unknown> | undefined): string {
        if (!row || typeof row !== 'object') return '';
        const roleCandidates = [
            row.UserGroupRole,
            row.userGroupRole,
            row.USERGROUPROLE,
            row.Role,
            row.role
        ];

        for (const roleCandidate of roleCandidates) {
            const normalized = this.normalizeRoleValue(roleCandidate);
            if (normalized) return normalized;
        }

        return '';
    }

    async getMenuForRole(userGroupRole: string) {
        const bestRole = this.normalizeRoleValue(userGroupRole);
        if (!bestRole) return [];

        const pool = await poolPromise;
        const menuResult = await pool.request()
            .input('UserGroupRole', sql.NVarChar, bestRole)
            .execute('mp_MenuSidebarGet');

        const rawMenuItems: MenuItem[] = Array.isArray(menuResult.recordset)
            ? menuResult.recordset as MenuItem[]
            : [];

        return this.buildMenuTree(rawMenuItems);
    }

    async getMenuForUser(employeeID: string, preferredRole?: string) {
        const pool = await poolPromise;

        let bestRole = '';
        try {
            const roleResult = await pool.request()
                .input('EmployeeID', sql.NVarChar, employeeID)
                .execute('mp_UserGroupRoleGet');

            if (Array.isArray(roleResult.recordset) && roleResult.recordset.length > 0) {
                bestRole = this.getRoleFromRow(roleResult.recordset[0] as Record<string, unknown>);
            }
        } catch (error) {
            console.error(`[MenuService] Failed to resolve role from mp_UserGroupRoleGet for employee ${employeeID}:`, error);
        }

        if (!bestRole) {
            bestRole = this.normalizeRoleValue(preferredRole);
        }

        if (!bestRole) {
            return [];
        }

        try {
            return await this.getMenuForRole(bestRole);
        } catch (error) {
            const fallbackRole = this.normalizeRoleValue(preferredRole);
            if (fallbackRole && fallbackRole !== bestRole) {
                console.warn(`[MenuService] Falling back to preferred role ${fallbackRole} for employee ${employeeID}`);
                return await this.getMenuForRole(fallbackRole);
            }
            throw error;
        }
    }

    private buildMenuTree(items: MenuItem[]): MenuItem[] {
        const itemMap = new Map<number, MenuItem>();
        const tree: MenuItem[] = [];

        items.forEach(item => {
            itemMap.set(item.MenuID, { ...item, children: [] });
        });

        items.forEach(item => {
            const node = itemMap.get(item.MenuID)!;
            if (item.ParentID) {
                const parent = itemMap.get(item.ParentID);
                if (parent) {
                    parent.children = parent.children || [];
                    parent.children.push(node);
                    parent.children.sort((a, b) => a.SortNumber - b.SortNumber);
                }
            } else {
                tree.push(node);
            }
        });

        tree.sort((a, b) => a.SortNumber - b.SortNumber);

        return tree;
    }

    private findMenuByKey(items: MenuItem[], menuKey: string): MenuItem | null {
        const targetKey = menuKey.trim().toLowerCase();
        if (!targetKey) return null;

        const stack: MenuItem[] = [...items];
        while (stack.length > 0) {
            const current = stack.shift()!;
            if ((current.MenuKey || '').trim().toLowerCase() === targetKey) {
                return current;
            }
            if (current.children && current.children.length > 0) {
                stack.push(...current.children);
            }
        }
        return null;
    }

    private normalizeMenuPath(pathValue: string | null | undefined): string {
        let normalized = String(pathValue || '').trim();
        if (!normalized || normalized === '#') return '';

        normalized = normalized.split('?')[0].split('#')[0].trim();
        if (!normalized) return '';

        if (!normalized.startsWith('/')) {
            normalized = `/${normalized}`;
        }

        normalized = normalized.replace(/\/{2,}/g, '/');
        if (normalized.length > 1) {
            normalized = normalized.replace(/\/+$/g, '');
        }

        return normalized.toLowerCase();
    }

    private collectMenuPaths(items: MenuItem[], acc: Set<string>) {
        for (const item of items) {
            const menuPath = this.normalizeMenuPath(item.MenuPath);
            if (menuPath) acc.add(menuPath);
            if (item.children && item.children.length > 0) {
                this.collectMenuPaths(item.children, acc);
            }
        }
    }

    async getSubMenuForUser(employeeID: string, menuKey: string, preferredRole?: string) {
        const menuTree = await this.getMenuForUser(employeeID, preferredRole);
        const targetMenu = this.findMenuByKey(menuTree, menuKey);
        return targetMenu?.children || [];
    }

    async hasMenuPathAccessForUser(employeeID: string, requiredPaths: string | string[], preferredRole?: string) {
        const requiredList = (Array.isArray(requiredPaths) ? requiredPaths : [requiredPaths])
            .map((pathValue) => this.normalizeMenuPath(pathValue))
            .filter((pathValue) => !!pathValue);

        if (requiredList.length === 0) return false;

        const menuTree = await this.getMenuForUser(employeeID, preferredRole);
        const allowedPaths = new Set<string>();
        this.collectMenuPaths(menuTree, allowedPaths);

        return requiredList.some((pathValue) => allowedPaths.has(pathValue));
    }

    async getMenuRights(userGroupRole: string) {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('UserGroupRole', sql.NVarChar, userGroupRole)
            .execute('mp_MenuRightbyUserGroupRole');

        return this.buildMenuRightTree(result.recordset);
    }

    async saveMenuRights(userGroupRole: string, menuID: number) {
        const pool = await poolPromise;
        
        await pool.request()
            .input('UserGroupRole', sql.NVarChar, userGroupRole)
            .input('MenuID', sql.Int, menuID)
            .execute('mp_MenuPermissionUpdate');
    }

    private buildMenuRightTree(items: any[]): any[] {
        const itemMap = new Map<number, any>();
        const tree: any[] = [];

        items.forEach(item => {
            itemMap.set(item.MenuID, { ...item, children: [], hasRight: !!item.checkright });
        });

        items.forEach(item => {
            const node = itemMap.get(item.MenuID)!;
            if (item.ParentID) {
                const parent = itemMap.get(item.ParentID);
                if (parent) {
                    parent.children.push(node);
                    parent.children.sort((a: any, b: any) => (a.SortNumber || a.MenuID) - (b.SortNumber || b.MenuID));
                } else {
                    if (!item.ParentID) tree.push(node); 
                }
            } else {
                tree.push(node);
            }
        });
        tree.sort((a, b) => (a.SortNumber || a.MenuID) - (b.SortNumber || b.MenuID));

        for (const node of itemMap.values()) {
            // Menu rights page should always show real hierarchy from ParentID,
            // even when SubMenu flag is false (e.g. Report menu).
            if (!node.children || node.children.length === 0) {
                delete node.children;
            }
        }

        return tree;
    }

    async getSubMenu(menuKey: string, employeeID?: string, preferredRole?: string) {
        if (employeeID) {
            return this.getSubMenuForUser(employeeID, menuKey, preferredRole);
        }

        const pool = await poolPromise;
        const result = await pool.request()
            .input('MenuKey', sql.NVarChar, menuKey)
            .execute('mp_MenuSubGet');

        return result.recordset;
    }
}

export default new MenuService();
