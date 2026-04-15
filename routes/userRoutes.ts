import { Hono } from 'hono';
import { getUserOther, insertUserOther, deleteUserOther, uploadProfilePicture, getProfilePicture } from '../controllers/userController.js';

const router = new Hono();

router.get('/other', getUserOther);
router.post('/other', insertUserOther);
router.delete('/other/:employeeId', deleteUserOther);
router.post('/profile-picture', uploadProfilePicture);
router.get('/profile-picture/:filename', getProfilePicture);

export default router;
