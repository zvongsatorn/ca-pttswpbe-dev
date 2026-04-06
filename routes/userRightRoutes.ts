import { Hono } from 'hono';
import userRightController from '../controllers/userRightController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const app = new Hono();

app.get('/org-unit', verifyToken, userRightController.getOrgUnitInGroup);
app.get('/users-in-unit', verifyToken, userRightController.getOrgUnitInUser);
app.get('/unit-users', verifyToken, userRightController.getUsersByOrgUnit);

app.post('/add-user-to-unit', verifyToken, userRightController.insertOrgUnitUser);
app.post('/remove-user-from-unit', verifyToken, userRightController.deleteOrgUnitUser);
app.post('/remove-all-from-unit', verifyToken, userRightController.deleteAllOrgUnitUser);

app.post('/add-all-units', verifyToken, userRightController.addUserInAllUnit);
app.post('/add-bu-units', verifyToken, userRightController.addUserInBUAll);
app.post('/add-belong-units', verifyToken, userRightController.addUserInBelongAll);

// Combos
app.get('/combo/bg', verifyToken, userRightController.getBGCombo);
app.get('/combo/line', verifyToken, userRightController.getUnitLineAsst);
app.get('/combo/org-unit-belong', verifyToken, userRightController.getOrgUnitInBelong);
app.get('/combo/unit-all', verifyToken, userRightController.getUnitAllCombo);

app.post('/copy-org', verifyToken, userRightController.copyOrg);

export default app;
