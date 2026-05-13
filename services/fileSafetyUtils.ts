import * as fs from 'fs';
import * as path from 'path';

export type SafeFilePath = string & { readonly __safeFilePath: unique symbol };

export const resolveSafeChildPath = (root: string, segments: readonly string[]): SafeFilePath => {
    const safeRoot = path.resolve(root);
    const fullPath = path.resolve(safeRoot, ...segments);
    if (fullPath === safeRoot || fullPath.startsWith(`${safeRoot}${path.sep}`)) {
        return fullPath as SafeFilePath;
    }
    throw new Error('Invalid file path');
};

export const safeExistsSync = (filePath: SafeFilePath): boolean => fs.existsSync(filePath);

export const safeMkdirSync = (dirPath: SafeFilePath): void => {
    fs.mkdirSync(dirPath, { recursive: true });
};

export const safeMkdirAsync = (dirPath: SafeFilePath): Promise<void> => {
    return fs.promises.mkdir(dirPath, { recursive: true }).then(() => undefined);
};

export const safeReadFileSync = (filePath: SafeFilePath): Uint8Array<ArrayBuffer> => {
    const buffer = fs.readFileSync(filePath);
    const data = new Uint8Array(buffer.byteLength);
    data.set(buffer);
    return data;
};

export const safeWriteFileSync = (filePath: SafeFilePath, data: NodeJS.ArrayBufferView): void => {
    fs.writeFileSync(filePath, data);
};

export const safeWriteTextFileAsync = (filePath: SafeFilePath, data: string, encoding: BufferEncoding = 'utf8'): Promise<void> => {
    return fs.promises.writeFile(filePath, data, { encoding });
};

export const safeReadFileAsync = (filePath: SafeFilePath): Promise<Buffer> => {
    return fs.promises.readFile(filePath);
};

export const safeStatAsync = (filePath: SafeFilePath): Promise<fs.Stats> => {
    return fs.promises.stat(filePath);
};

export const safeCopyFileSync = (sourcePath: SafeFilePath, targetPath: SafeFilePath): void => {
    fs.copyFileSync(sourcePath, targetPath);
};

export const safeUnlinkSync = (filePath: SafeFilePath): void => {
    fs.unlinkSync(filePath);
};
