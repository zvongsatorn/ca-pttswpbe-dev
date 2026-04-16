import { Context } from 'hono';
import * as userService from '../services/userService.js';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import userGroupService from '../services/userGroupService.js';

export const getUserOther = async (c: Context) => {
    try {
        const result = await userService.getUserOtherService();
        return c.json({ success: true, data: result });
    } catch (error: any) {
        console.error('Error in getUserOther controller:', error);
        return c.json({ success: false, message: error.message }, 500);
    }
};

export const insertUserOther = async (c: Context) => {
    try {
        const body = await c.req.json();
        const { employeeId, fullName, email, createBy } = body;
        const normalizedEmployeeId = String(employeeId || '').trim();
        const normalizedFullName = String(fullName || '').trim();
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const normalizedCreateBy = String(createBy || '').trim();

        if (!normalizedEmployeeId || !normalizedFullName || !normalizedEmail || !normalizedCreateBy) {
            return c.json({ success: false, message: 'Missing required parameters' }, 400);
        }

        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(normalizedEmail)) {
            return c.json({ success: false, message: 'Invalid email format' }, 400);
        }

        const result = await userService.insertUserOtherService(
            normalizedEmployeeId,
            normalizedFullName,
            normalizedEmail,
            normalizedCreateBy
        );
        
        // Follow legacy logic: if result[0].CheckUser == "1", it means user already exists
        if (result && result.length > 0 && result[0].CheckUser === "1") {
            return c.json({ success: false, message: 'มี EmployeeID นี้ในระบบแล้ว', code: 'DUP' });
        }

        return c.json({ success: true, message: 'ทำการเพิ่มข้อมูลเรียบร้อย', data: result });
    } catch (error: any) {
        console.error('Error in insertUserOther controller:', error);
        return c.json({ success: false, message: error.message }, 500);
    }
};

export const deleteUserOther = async (c: Context) => {
    try {
        const employeeId = c.req.param('employeeId');
        const updateBy = c.req.query('updateBy') || '';

        if (!employeeId || !updateBy) {
            return c.json({ success: false, message: 'Missing required parameters' }, 400);
        }

        await userService.deleteUserOtherService(employeeId, updateBy);
        return c.json({ success: true, message: 'ลบข้อมูลเรียบร้อย' });
    } catch (error: any) {
        console.error('Error in deleteUserOther controller:', error);
        return c.json({ success: false, message: error.message }, 500);
    }
};

export const updateUserOther = async (c: Context) => {
    try {
        const employeeId = c.req.param('employeeId');
        const body = await c.req.json();
        const { fullName, email, updateBy } = body;
        
        const normalizedFullName = String(fullName || '').trim();
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const normalizedUpdateBy = String(updateBy || '').trim();

        if (!employeeId || !normalizedFullName || !normalizedEmail || !normalizedUpdateBy) {
            return c.json({ success: false, message: 'Missing required parameters' }, 400);
        }

        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(normalizedEmail)) {
            return c.json({ success: false, message: 'Invalid email format' }, 400);
        }

        await userService.updateUserOtherService(
            employeeId,
            normalizedFullName,
            normalizedEmail,
            normalizedUpdateBy
        );

        return c.json({ success: true, message: 'อัปเดตข้อมูลเรียบร้อย' });
    } catch (error: any) {
        console.error('Error in updateUserOther controller:', error);
        return c.json({ success: false, message: error.message }, 500);
    }
};

export const uploadProfilePicture = async (c: Context) => {
    try {
        const body = await c.req.parseBody();
        const file = body['file'] as any;
        const employeeId = body['employeeId'] as string;

        if (!file || !employeeId) {
            return c.json({ success: false, message: 'Missing file or employeeId' }, 400);
        }

        // Get old profile picture to delete later
        const userData = await userService.getUserWithPassword(employeeId);
        const oldFilename = userData?.ProfilePicture;

        const fileName = file.name;
        const fileBuffer = await file.arrayBuffer();

        const uploadDir = path.join(process.cwd(), 'uploads', 'profile_pictures');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        let extension = path.extname(fileName).toLowerCase();
        if (!extension) extension = ".jpg"; // Default extension

        const safeName = `${randomUUID()}${extension}`;
        const filePath = path.join(uploadDir, safeName);
        fs.writeFileSync(filePath, Buffer.from(fileBuffer));

        await userService.updateUserProfilePicture(employeeId, safeName);

        // Regenerate Token for frontend persistence
        const userGroups = await userGroupService.getGroupsForUser(employeeId);
        const SECRET_KEY = process.env.JWT_SECRET;
        let token = null;

        if (SECRET_KEY) {
            token = jwt.sign(
                {
                    id: employeeId,
                    role: 'user',
                    groups: userGroups,
                    name: userData.FullName || userData.fullName || userData.Name || userData.NAME || userData.FULLNAMETH || userData.FULLNAMEENG || userData.name || '',
                    email: userData.Email || '',
                    position: userData.Position || '',
                    orgUnit: userData.OrgUnit || '',
                    profilePicture: safeName,
                },
                SECRET_KEY,
                { expiresIn: '1d' }
            );
        }

        // Delete old file if it exists
        if (oldFilename) {
            const oldPath = path.join(process.cwd(), 'uploads', 'profile_pictures', oldFilename);
            if (fs.existsSync(oldPath)) {
                try {
                    fs.unlinkSync(oldPath);
                    console.log(`Deleted old profile picture: ${oldFilename}`);
                } catch (err) {
                    console.error(`Failed to delete old profile picture ${oldFilename}:`, err);
                }
            }
        }

        return c.json({ 
            success: true, 
            message: 'อัปโหลดรูปภาพสำเร็จ', 
            data: { 
                filename: safeName, 
                url: `/api/users/profile-picture/${safeName}`,
                token: token
            } 
        });
    } catch (error: any) {
        console.error('Error uploading profile picture:', error);
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};export const getProfilePicture = async (c: Context) => {
    try {
        const filename = c.req.param('filename');
        if (!filename) return c.json({ message: 'Missing filename' }, 400);

        const uploadDir = path.join(process.cwd(), 'uploads', 'profile_pictures');
        const filePath = path.join(uploadDir, filename);

        console.log(`[getProfilePicture] Request for ${filename}`);
        console.log(`[getProfilePicture] Checking path: ${filePath}`);

        if (!fs.existsSync(filePath)) {
            console.warn(`[getProfilePicture] File not found: ${filePath}`);
            return c.json({ message: 'File not found' }, 404);
        }

        const fileBuffer = fs.readFileSync(filePath);
        const ext = path.extname(filename).toLowerCase();
        let contentType = 'image/jpeg';
        if (ext === '.png') contentType = 'image/png';
        if (ext === '.webp') contentType = 'image/webp';
        if (ext === '.gif') contentType = 'image/gif';

        return c.body(fileBuffer, 200, {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000, immutable'
        });
    } catch (error: any) {
        console.error('Error getting profile picture:', error);
        return c.json({ success: false, message: 'Internal server error' }, 500);
    }
};
