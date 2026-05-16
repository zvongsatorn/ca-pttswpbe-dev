import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const servicesDir = path.join(process.cwd(), "services");

test("service layer does not embed direct SQL query calls", async () => {
    const serviceFiles = (await readdir(servicesDir))
        .filter((fileName) => fileName.endsWith(".ts"))
        .sort();

    const offenders: string[] = [];

    for (const fileName of serviceFiles) {
        const source = await readFile(path.join(servicesDir, fileName), "utf8");
        if (/\.query\s*\(/.test(source)) {
            offenders.push(fileName);
        }
    }

    assert.deepEqual(offenders, []);
});
