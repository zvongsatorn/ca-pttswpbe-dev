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
    async getMenuForUser(employeeID: string) {
        const pool = await poolPromise;

        const roleResult = await pool.request()
            .input('EmployeeID', sql.NVarChar, employeeID)
            .execute('mp_UserGroupRoleGet');

        if (roleResult.recordset.length === 0) {
            return [];
        }

        const bestRole = roleResult.recordset[0].UserGroupRole;

        const menuResult = await pool.request()
            .input('UserGroupRole', sql.NVarChar, bestRole)
            .execute('mp_MenuSidebarGet');
        const rawMenuItems: MenuItem[] = menuResult.recordset;

        return this.buildMenuTree(rawMenuItems);
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
            if (!node.SubMenu || (node.children && node.children.length === 0)) {
                delete node.children;
            }
        }

        return tree;
    }

    async getSubMenu(menuKey: string) {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('MenuKey', sql.NVarChar, menuKey)
            .execute('mp_MenuSubGet');

        return result.recordset;
    }
}

export default new MenuService();
