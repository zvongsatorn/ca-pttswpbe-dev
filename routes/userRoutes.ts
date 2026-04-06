import { Hono } from 'hono';
import * as userController from '../controllers/userController.js';

const router = new Hono();

router.get('/other', userController.getUserOther);
router.post('/other', userController.insertUserOther);
router.delete('/other/:employeeId', userController.deleteUserOther);

export default router;
