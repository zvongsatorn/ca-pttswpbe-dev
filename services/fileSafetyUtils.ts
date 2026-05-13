import * as fs from 'fs';
import * as path from 'path';

export type SafeFilePath = {
    readonly absolutePath: string;
    readonly rootPath: string;
    readonly __safeFilePath: unique symbol;
};

const isWithinRoot = (root: string, candidate: string): boolean => (
    candidate === root || candidate.startsWith(`${root}${path.sep}`)
);

const toAbsolutePath = (filePath: SafeFilePath): string => {
    const safeRoot = path.resolve(filePath.rootPath);
    const safePath = path.resolve(filePath.absolutePath);
    if (!isWithinRoot(safeRoot, safePath)) {
        throw new Error('Invalid file path');
    }
    return safePath;
};

export const safeFilePathToString = (filePath: SafeFilePath): string => toAbsolutePath(filePath);

export const resolveSafeChildPath = (root: string | SafeFilePath, segments: readonly string[]): SafeFilePath => {
    const safeRoot = path.resolve(typeof root === 'string' ? root : root.absolutePath);
    const fullPath = path.resolve(safeRoot, ...segments);
    if (isWithinRoot(safeRoot, fullPath)) {
        return {
            absolutePath: fullPath,
            rootPath: safeRoot
        } as SafeFilePath;
    }
    throw new Error('Invalid file path');
};

export const safeExistsSync = (filePath: SafeFilePath): boolean => fs.existsSync(toAbsolutePath(filePath));

export const safeMkdirSync = (dirPath: SafeFilePath): void => {
    fs.mkdirSync(toAbsolutePath(dirPath), { recursive: true });
};

export const safeMkdirAsync = async (dirPath: SafeFilePath): Promise<void> => {
    await fs.promises.mkdir(toAbsolutePath(dirPath), { recursive: true });
};

export const safeReadFileSync = (filePath: SafeFilePath): Uint8Array<ArrayBuffer> => {
    const buffer = fs.readFileSync(toAbsolutePath(filePath));
    const data = new Uint8Array(buffer.byteLength);
    data.set(buffer);
    return data;
};

export const safeWriteFileSync = (filePath: SafeFilePath, data: NodeJS.ArrayBufferView): void => {
    fs.writeFileSync(toAbsolutePath(filePath), data);
};

export const safeWriteTextFileAsync = (filePath: SafeFilePath, data: string, encoding: BufferEncoding = 'utf8'): Promise<void> => {
    return fs.promises.writeFile(toAbsolutePath(filePath), data, { encoding });
};

export const safeReadFileAsync = (filePath: SafeFilePath): Promise<Buffer> => {
    return fs.promises.readFile(toAbsolutePath(filePath));
};

export const safeStatAsync = (filePath: SafeFilePath): Promise<fs.Stats> => {
    return fs.promises.stat(toAbsolutePath(filePath));
};

export const safeCopyFileSync = (sourcePath: SafeFilePath, targetPath: SafeFilePath): void => {
    fs.copyFileSync(toAbsolutePath(sourcePath), toAbsolutePath(targetPath));
};

export const safeUnlinkSync = (filePath: SafeFilePath): void => {
    fs.unlinkSync(toAbsolutePath(filePath));
};
