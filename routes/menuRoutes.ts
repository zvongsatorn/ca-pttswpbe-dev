import { Hono } from 'hono';
import menuController from '../controllers/menuController.js';

const menuRoutes = new Hono();

menuRoutes.get('/', menuController.getSidebarMenu);
menuRoutes.get('/rights/:role', menuController.getMenuRights);
menuRoutes.post('/rights', menuController.saveMenuRights);
menuRoutes.get('/submenu/:menuKey', menuController.getSubMenu);

export default menuRoutes;
