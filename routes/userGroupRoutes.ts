import { Hono } from 'hono';
import userGroupController from '../controllers/userGroupController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const app = new Hono();

app.get('/', verifyToken, userGroupController.getAll);
app.get('/levels', verifyToken, userGroupController.getLevels);
app.get('/level-combo', verifyToken, userGroupController.getLevelCombo);
app.get('/all-users', verifyToken, userGroupController.getAllUsers);
app.get('/members', verifyToken, userGroupController.getMembers);

app.post('/level', verifyToken, userGroupController.addLevel);
app.post('/member', verifyToken, userGroupController.addMember);
app.post('/delete-member', verifyToken, userGroupController.deleteMember);
app.post('/delete-level', verifyToken, userGroupController.deleteLevel);

export default app;
