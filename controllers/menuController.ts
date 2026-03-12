import { Context } from 'hono';
import menuService from '../services/menuService.js';
import { getCookie } from 'hono/cookie';
import { jwtDecode } from 'jwt-decode';

interface DecodedToken {
    id: string; // EmployeeID
    role: string;
}

class MenuController {
    async getSidebarMenu(c: Context) {
        try {
          
            const authHeader = c.req.header('Authorization');
            let token = authHeader && authHeader.split(' ')[1];

            if (!token) {
                token = getCookie(c, 'auth_token');
            }

            if (!token) {
                return c.json({ error: 'Unauthorized' }, 401);
            }

            let employeeID: string;
            try {
                const decoded = jwtDecode<DecodedToken>(token);
                employeeID = decoded.id;
            } catch (e) {
                return c.json({ error: 'Invalid token' }, 401);
            }

            const menu = await menuService.getMenuForUser(employeeID);
            return c.json(menu);

        } catch (error) {
            console.error('Error fetching menu:', error);
            return c.json({ error: 'Internal Server Error' }, 500);
        }
    }

    async getMenuRights(c: Context) {
        try {
            const role = c.req.param('role');
            if (!role) return c.json({ error: 'Role is required' }, 400);

            const rights = await menuService.getMenuRights(role);
            return c.json(rights);
        } catch (error) {
            console.error('Error fetching menu rights:', error);
            return c.json({ error: 'Internal Server Error' }, 500);
        }
    }

    async saveMenuRights(c: Context) {
        try {
            // Check auth
            const authHeader = c.req.header('Authorization');
            let token = authHeader && authHeader.split(' ')[1];
            if (!token) token = getCookie(c, 'auth_token');
            if (!token) return c.json({ error: 'Unauthorized' }, 401);
            
            let employeeID = '';
             try {
                const decoded = jwtDecode<DecodedToken>(token);
                employeeID = decoded.id;
            } catch (e) {
                return c.json({ error: 'Invalid token' }, 401);
            }

            const body = await c.req.json();
            const { userGroupRole, menuID, hasRight } = body;
            
            if (!userGroupRole || !menuID) {
                return c.json({ error: 'Invalid data' }, 400);
            }

            await menuService.saveMenuRights(userGroupRole, menuID);
            return c.json({ success: true });

        } catch (error) {
           console.error('Error saving menu rights:', error);
           return c.json({ error: 'Internal Server Error' }, 500);
        }
    }
    async getSubMenu(c: Context) {
        try {
            const menuKey = c.req.param('menuKey');
            if (!menuKey) return c.json({ error: 'Menu Key is required' }, 400);

            const subMenu = await menuService.getSubMenu(menuKey);
            return c.json(subMenu);
        } catch (error) {
            console.error('Error fetching submenu:', error);
            return c.json({ error: 'Internal Server Error' }, 500);
        }
    }
}

export default new MenuController();
