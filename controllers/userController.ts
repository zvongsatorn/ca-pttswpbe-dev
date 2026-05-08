import { Context } from 'hono';
import * as userService from '../services/userService.js';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import userGroupService from '../services/userGroupService.js';

const PROFILE_PICTURE_MAX_BYTES = 5 * 1024 * 1024;
const PROFILE_PICTURE_CONTENT_TYPES: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp'
};

const isAllowedProfilePictureExtension = (extension: string): boolean => {
    return Object.prototype.hasOwnProperty.call(PROFILE_PICTURE_CONTENT_TYPES, extension);
};

const resolveProfilePicturePath = (filename: string): string | null => {
    const safeFilename = path.basename(filename || '');
    if (!safeFilename || safeFilename !== filename) return null;

    const extension = path.extname(safeFilename).toLowerCase();
    if (!isAllowedProfilePictureExtension(extension)) return null;

    const uploadDir = path.resolve(process.cwd(), 'uploads', 'profile_pictures');
    const filePath = path.resolve(uploadDir, safeFilename);
    return filePath.startsWith(`${uploadDir}${path.sep}`) ? filePath : null;
};


const buildProfilePictureToken = (employeeId: string, userData: any, userGroups: unknown[], safeName: string) => {
    const secretKey = process.env.JWT_SECRET;
    if (!secretKey) return null;

    return jwt.sign(
        {
            id: employeeId,
            role: "user",
            groups: userGroups,
            name: userData.FullName || userData.fullName || userData.Name || userData.NAME || userData.FULLNAMETH || userData.FULLNAMEENG || userData.name || "",
            email: userData.Email || "",
            position: userData.Position || "",
            orgUnit: userData.OrgUnit || "",
            profilePicture: safeName,
        },
        secretKey,
        { expiresIn: "1d" }
    );
};

const deleteProfilePictureIfExists = (oldFilename: string | null | undefined): void => {
    if (!oldFilename) return;

    const oldPath = path.join(process.cwd(), "uploads", "profile_pictures", oldFilename);
    if (!fs.existsSync(oldPath)) return;

    try {
        fs.unlinkSync(oldPath);
        console.log("Deleted old profile picture: " + oldFilename);
    } catch (err) {
        console.error("Failed to delete old profile picture " + oldFilename + ":", err);
    }
};
const isValidEmailAddress = (email: string): boolean => {
    if (!email || email.length > 254 || email.includes(' ')) return false;

    const atIndex = email.indexOf('@');
    if (atIndex <= 0 || atIndex !== email.lastIndexOf('@') || atIndex === email.length - 1) return false;

    const localPart = email.slice(0, atIndex);
    const domain = email.slice(atIndex + 1);
    if (!localPart || !domain || !domain.includes('.')) return false;
    if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return false;

    return true;
};

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

        if (!isValidEmailAddress(normalizedEmail)) {
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
        const employeeId = String(c.req.param('employeeId') || '').trim();
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
        const employeeId = String(c.req.param('employeeId') || '').trim();
        const body = await c.req.json();
        const { fullName, email, updateBy } = body;
        
        const normalizedFullName = String(fullName || '').trim();
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const normalizedUpdateBy = String(updateBy || '').trim();

        if (!employeeId || !normalizedFullName || !normalizedEmail || !normalizedUpdateBy) {
            return c.json({ success: false, message: 'Missing required parameters' }, 400);
        }

        if (!isValidEmailAddress(normalizedEmail)) {
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

        const fileName = String(file.name || '');
        const extension = path.extname(fileName).toLowerCase();
        if (!isAllowedProfilePictureExtension(extension)) {
            return c.json({ success: false, message: 'Unsupported image file type' }, 400);
        }

        const fileBuffer = Buffer.from(await file.arrayBuffer());
        if (fileBuffer.byteLength > PROFILE_PICTURE_MAX_BYTES) {
            return c.json({ success: false, message: 'Image file is too large' }, 400);
        }

        const uploadDir = path.resolve(process.cwd(), 'uploads', 'profile_pictures');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const safeName = `${randomUUID()}${extension}`;
        const filePath = path.join(uploadDir, safeName);
        fs.writeFileSync(filePath, fileBuffer);

        await userService.updateUserProfilePicture(employeeId, safeName);

        // Regenerate Token for frontend persistence
        const userGroups = await userGroupService.getGroupsForUser(employeeId);
        const token = buildProfilePictureToken(employeeId, userData, userGroups, safeName);

        // Delete old file if it exists
        deleteProfilePictureIfExists(oldFilename);

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

        const filePath = resolveProfilePicturePath(filename);
        if (!filePath) return c.json({ message: 'Invalid filename' }, 400);

        if (!fs.existsSync(filePath)) {
            return c.json({ message: 'File not found' }, 404);
        }

        const fileBuffer = fs.readFileSync(filePath);
        const ext = path.extname(filename).toLowerCase();
        const contentType = PROFILE_PICTURE_CONTENT_TYPES[ext] || 'application/octet-stream';

        return c.body(fileBuffer, 200, {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff'
        });
    } catch (error: any) {
        console.error('Error getting profile picture:', error);
        return c.json({ success: false, message: 'Internal server error' }, 500);
    }
};
