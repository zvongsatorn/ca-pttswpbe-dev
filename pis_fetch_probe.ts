import * as http from 'node:http';
import * as https from 'node:https';
import { writeFile } from 'node:fs/promises';

type HttpMethod = 'GET' | 'POST';

interface CliArgs {
    endpoint: string;
    employeeCode: string;
    bearerToken: string;
    tokenUrl: string;
    username: string;
    password: string;
    insecure: boolean;
    timeoutMs: number;
    csv: boolean;
    outputPath: string;
    excelSafe: boolean;
    allPages: boolean;
    maxPages: number;
    pageSize: number;
    idsOnly: boolean;
}

interface HttpResponse {
    statusCode: number;
    body: string;
}

const DEFAULT_ENDPOINT =
    'https://pttapigw-prd.pttplc.com/PTT_PIS/PersonelInfo/S4/1.0.0/PersonelInfo';

function printUsage() {
    console.log(`
Usage:
  npm run test:pis -- [--employeeCode <EMP_ID>] [options]

Options:
  --employeeCode, -e   Employee code for Search_EmployeeCode query parameter (optional)
  --endpoint           PIS endpoint URL (default = provided DEV URL)
  --token              Bearer token for PIS API
  --tokenUrl           OAuth token URL (used when --token is not provided)
  --user               OAuth username (used with --tokenUrl)
  --pass               OAuth password (used with --tokenUrl)
  --timeoutMs          Request timeout in milliseconds (default: 30000)
  --secure             Enable TLS certificate validation (default is insecure)
  --csv                Export all returned rows to CSV file
  --out                Output CSV path (default: pis_personel_<timestamp>.csv)
  --rawCsv             Disable Excel-safe text mode in CSV
  --singlePage         Disable auto-pagination (default: auto when no employeeCode)
  --pageSize           Expected page size for offset/page probing (default: 50)
  --maxPages           Max pages to fetch in auto-pagination mode (default: 200)
  --idsOnly            CSV output only one column: EmployeeID (unique)

Environment fallback:
  PIS_EMPLOYEE_CODE, PIS_ENDPOINT, PIS_BEARER_TOKEN,
  PIS_TOKEN_URL, PIS_USER, PIS_PASS, PIS_OUT_FILE,
  PIS_ALL_PAGES, PIS_PAGE_SIZE, PIS_MAX_PAGES, PIS_IDS_ONLY
`);
}

function parseCliArgs(): CliArgs {
    const raw = process.argv.slice(2);
    const map = new Map<string, string>();

    for (let i = 0; i < raw.length; i += 1) {
        const key = raw[i];
        if (!key.startsWith('-')) continue;

        const next = raw[i + 1];
        if (!next || next.startsWith('-')) {
            map.set(key, 'true');
            continue;
        }
        map.set(key, next);
        i += 1;
    }

    const endpoint = map.get('--endpoint') || process.env.PIS_ENDPOINT || DEFAULT_ENDPOINT;
    const employeeCode =
        map.get('--employeeCode') ||
        map.get('-e') ||
        process.env.PIS_EMPLOYEE_CODE ||
        '';
    const bearerToken = map.get('--token') || process.env.PIS_BEARER_TOKEN || '';
    const tokenUrl = map.get('--tokenUrl') || process.env.PIS_TOKEN_URL || '';
    const username = map.get('--user') || process.env.PIS_USER || '';
    const password = map.get('--pass') || process.env.PIS_PASS || '';
    const insecure = !map.has('--secure');
    const timeoutRaw = map.get('--timeoutMs') || process.env.PIS_TIMEOUT_MS || '30000';
    const timeoutMs = Number.parseInt(timeoutRaw, 10);
    const csv = map.has('--csv');
    const outputPath = map.get('--out') || process.env.PIS_OUT_FILE || defaultCsvPath();
    const excelSafe = !map.has('--rawCsv');
    const allPages =
        map.has('--singlePage')
            ? false
            : (map.get('--allPages') || process.env.PIS_ALL_PAGES || (!employeeCode ? 'true' : 'false')) ===
              'true';
    const pageSizeRaw = map.get('--pageSize') || process.env.PIS_PAGE_SIZE || '50';
    const maxPagesRaw = map.get('--maxPages') || process.env.PIS_MAX_PAGES || '200';
    const pageSize = Number.parseInt(pageSizeRaw, 10);
    const maxPages = Number.parseInt(maxPagesRaw, 10);
    const idsOnly = (map.get('--idsOnly') || process.env.PIS_IDS_ONLY || 'false') === 'true' || map.has('--idsOnly');

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error(`Invalid timeoutMs: ${timeoutRaw}`);
    }
    if (!Number.isFinite(pageSize) || pageSize <= 0) {
        throw new Error(`Invalid pageSize: ${pageSizeRaw}`);
    }
    if (!Number.isFinite(maxPages) || maxPages <= 0) {
        throw new Error(`Invalid maxPages: ${maxPagesRaw}`);
    }

    return {
        endpoint,
        employeeCode,
        bearerToken,
        tokenUrl,
        username,
        password,
        insecure,
        timeoutMs,
        csv,
        outputPath,
        excelSafe,
        allPages,
        maxPages,
        pageSize,
        idsOnly
    };
}

function defaultCsvPath(): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `pis_personel_${stamp}.csv`;
}

function requestUrl(
    url: string,
    method: HttpMethod,
    headers: Record<string, string>,
    body: string | undefined,
    insecure: boolean,
    timeoutMs: number
): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const lib = parsed.protocol === 'https:' ? https : http;

        const req = lib.request(
            {
                protocol: parsed.protocol,
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: parsed.pathname + parsed.search,
                method,
                headers,
                timeout: timeoutMs,
                rejectUnauthorized: !insecure
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
                res.on('end', () => {
                    resolve({
                        statusCode: res.statusCode || 0,
                        body: Buffer.concat(chunks).toString('utf8')
                    });
                });
            }
        );

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy(new Error(`Request timeout (${timeoutMs} ms)`));
        });

        if (body) req.write(body);
        req.end();
    });
}

async function getTokenWithPasswordGrant(args: CliArgs): Promise<string> {
    const credentials = Buffer.from(`${args.username}:${args.password}`).toString('base64');
    const formBody = new URLSearchParams({ grant_type: 'client_credentials' }).toString();

    const response = await requestUrl(
        args.tokenUrl,
        'POST',
        {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(formBody).toString()
        },
        formBody,
        args.insecure,
        args.timeoutMs
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`Token request failed (${response.statusCode}): ${response.body}`);
    }

    let json: any;
    try {
        json = JSON.parse(response.body);
    } catch {
        throw new Error(`Token response is not JSON: ${response.body}`);
    }

    if (!json?.access_token) {
        throw new Error(`access_token not found in token response: ${response.body}`);
    }

    return json.access_token as string;
}

function buildEndpointUrl(endpoint: string, employeeCode: string): string {
    if (!employeeCode) return endpoint;
    const separator = endpoint.includes('?') ? '&' : '?';
    return `${endpoint}${separator}Search_EmployeeCode=${encodeURIComponent(employeeCode.replace(/^0+/, ''))}`;
}

function parseEntries(data: any): any[] {
    const entries = data?.Entries?.Entry || data?.entries?.entry || [];
    if (Array.isArray(entries)) return entries;
    return entries ? [entries] : [];
}

function extractNextLink(data: any): string {
    const candidate =
        data?.['@odata.nextLink'] ||
        data?.nextLink ||
        data?.NextLink ||
        data?.next ||
        data?.Next ||
        data?.d?.__next ||
        data?.paging?.next ||
        data?.page?.next ||
        data?.links?.next?.href;

    return typeof candidate === 'string' ? candidate : '';
}

const EMPLOYEE_ID_KEYS_NORMALIZED = [
    'CODE',
    'EMPLOYEEID',
    'EMPID',
    'EMPLOYEECODE',
    'EMP_CODE',
    'EMPNO',
    'PERSONNELNUMBER'
];

function normalizeKey(key: string): string {
    return key.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function detectEmployeeIdKey(row: any): string {
    if (!row || typeof row !== 'object') return '';
    const keys = Object.keys(row);
    for (const preferred of EMPLOYEE_ID_KEYS_NORMALIZED) {
        const match = keys.find((k) => normalizeKey(k) === normalizeKey(preferred));
        if (match) return match;
    }
    return '';
}

function getEmployeeId(row: any, detectedKey: string): string {
    if (!row || typeof row !== 'object') return '';
    if (detectedKey && row[detectedKey] !== undefined && row[detectedKey] !== null) {
        return String(row[detectedKey]).trim();
    }

    const key = detectEmployeeIdKey(row);
    if (!key) return '';
    const value = row[key];
    return value === undefined || value === null ? '' : String(value).trim();
}

function pageSignature(rows: any[], detectedIdKey: string): string {
    if (rows.length === 0) return 'EMPTY';
    const ids = rows
        .map((r) => getEmployeeId(r, detectedIdKey))
        .filter((v) => v)
        .slice(0, 10)
        .join('|');

    if (ids) return `IDS:${ids}|LEN:${rows.length}`;
    return `ROW0:${JSON.stringify(rows[0])}|LEN:${rows.length}`;
}

function withQueryParams(baseUrl: string, params: Record<string, string>): string {
    const u = new URL(baseUrl);
    for (const [k, v] of Object.entries(params)) {
        u.searchParams.set(k, v);
    }
    return u.toString();
}

type OffsetStrategy = {
    name: string;
    makeUrl: (baseUrl: string, page: number, pageSize: number) => string;
};

const OFFSET_STRATEGIES: OffsetStrategy[] = [
    {
        name: 'CurrentPage',
        makeUrl: (baseUrl, page) =>
            withQueryParams(baseUrl, {
                CurrentPage: String(page)
            })
    },
    {
        name: 'CurrentPage/PageSize',
        makeUrl: (baseUrl, page, size) =>
            withQueryParams(baseUrl, {
                CurrentPage: String(page),
                PageSize: String(size)
            })
    },
    {
        name: 'currentpage/pagesize',
        makeUrl: (baseUrl, page, size) =>
            withQueryParams(baseUrl, {
                currentpage: String(page),
                pagesize: String(size)
            })
    },
    {
        name: '$skip/$top',
        makeUrl: (baseUrl, page, size) =>
            withQueryParams(baseUrl, {
                $skip: String((page - 1) * size),
                $top: String(size)
            })
    },
    {
        name: 'skip/top',
        makeUrl: (baseUrl, page, size) =>
            withQueryParams(baseUrl, {
                skip: String((page - 1) * size),
                top: String(size)
            })
    },
    {
        name: 'offset/limit',
        makeUrl: (baseUrl, page, size) =>
            withQueryParams(baseUrl, {
                offset: String((page - 1) * size),
                limit: String(size)
            })
    },
    {
        name: 'page/limit',
        makeUrl: (baseUrl, page, size) =>
            withQueryParams(baseUrl, {
                page: String(page),
                limit: String(size)
            })
    },
    {
        name: 'page/pageSize',
        makeUrl: (baseUrl, page, size) =>
            withQueryParams(baseUrl, {
                page: String(page),
                pageSize: String(size)
            })
    },
    {
        name: 'pageNo/pageSize',
        makeUrl: (baseUrl, page, size) =>
            withQueryParams(baseUrl, {
                pageNo: String(page),
                pageSize: String(size)
            })
    },
    {
        name: 'pageNumber/pageSize',
        makeUrl: (baseUrl, page, size) =>
            withQueryParams(baseUrl, {
                pageNumber: String(page),
                pageSize: String(size)
            })
    },
    {
        name: 'CurrentPage',
        makeUrl: (baseUrl, page) =>
            withQueryParams(baseUrl, {
                CurrentPage: String(page)
            })
    }
];

type FlatRow = Record<string, string>;

function flattenRecord(input: any, prefix: string = '', out: FlatRow = {}): FlatRow {
    if (input === null || input === undefined) return out;

    for (const [key, value] of Object.entries(input)) {
        const path = prefix ? `${prefix}.${key}` : key;

        if (value === null || value === undefined) {
            out[path] = '';
            continue;
        }

        if (Array.isArray(value)) {
            out[path] = JSON.stringify(value);
            continue;
        }

        if (typeof value === 'object') {
            flattenRecord(value, path, out);
            continue;
        }

        out[path] = String(value);
    }

    return out;
}

function escapeCsv(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

function asExcelSafeText(value: string): string {
    const escaped = value.replace(/"/g, '""');
    return `="${escaped}"`;
}

function toCsvRows(rows: any[], excelSafe: boolean): string {
    const flattenedRows = rows.map((row) => flattenRecord(row));
    const headers: string[] = [];
    const headerSet = new Set<string>();

    for (const row of flattenedRows) {
        for (const key of Object.keys(row)) {
            if (headerSet.has(key)) continue;
            headerSet.add(key);
            headers.push(key);
        }
    }

    const lines: string[] = [];
    lines.push(headers.map((h) => escapeCsv(h)).join(','));

    for (const row of flattenedRows) {
        const line = headers
            .map((header) => {
                const raw = row[header] ?? '';
                const value = excelSafe ? asExcelSafeText(raw) : raw;
                return escapeCsv(value);
            })
            .join(',');
        lines.push(line);
    }

    return `\uFEFF${lines.join('\n')}`;
}

function toIdCsv(ids: string[], excelSafe: boolean): string {
    const lines: string[] = ['"EmployeeID"'];
    for (const id of ids) {
        const value = excelSafe ? asExcelSafeText(id) : id;
        lines.push(escapeCsv(value));
    }
    return `\uFEFF${lines.join('\n')}`;
}

async function fetchPayload(
    url: string,
    token: string,
    args: CliArgs
): Promise<{ payload: any; entries: any[]; statusCode: number }> {
    const response = await requestUrl(
        url,
        'GET',
        {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json'
        },
        undefined,
        args.insecure,
        args.timeoutMs
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`PIS request failed (${response.statusCode}): ${response.body}`);
    }

    let payload: any;
    try {
        payload = JSON.parse(response.body);
    } catch {
        throw new Error(`Response is not JSON: ${response.body}`);
    }

    return {
        payload,
        entries: parseEntries(payload),
        statusCode: response.statusCode
    };
}

async function run() {
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
        printUsage();
        process.exit(0);
    }

    const args = parseCliArgs();
    let token = args.bearerToken;

    if (!token) {
        if (!args.tokenUrl || !args.username || !args.password) {
            printUsage();
            throw new Error(
                'Missing auth input: provide --token or (--tokenUrl + --user + --pass)'
            );
        }
        token = await getTokenWithPasswordGrant(args);
    }

    const requestUrlFinal = buildEndpointUrl(args.endpoint, args.employeeCode);
    console.log(`Request URL: ${requestUrlFinal}`);
    console.log(`TLS verify: ${args.insecure ? 'disabled (--secure to enable)' : 'enabled'}`);
    console.log(
        `Auto-pagination: ${args.allPages ? `enabled (pageSize=${args.pageSize}, maxPages=${args.maxPages})` : 'disabled'}`
    );

    const firstPage = await fetchPayload(requestUrlFinal, token, args);
    console.log(`HTTP Status: ${firstPage.statusCode}`);

    let detectedIdKey = detectEmployeeIdKey(firstPage.entries[0]);
    const allEntries: any[] = [...firstPage.entries];
    const seenPageUrls = new Set<string>([requestUrlFinal]);

    let pageCount = 1;
    const shouldPaginate = args.allPages && !args.employeeCode;

    if (shouldPaginate) {
        let nextUrl = extractNextLink(firstPage.payload);

        if (nextUrl) {
            while (nextUrl && pageCount < args.maxPages) {
                if (seenPageUrls.has(nextUrl)) break;
                seenPageUrls.add(nextUrl);
                const page = await fetchPayload(nextUrl, token, args);
                pageCount += 1;
                if (page.entries.length === 0) break;
                allEntries.push(...page.entries);
                if (!detectedIdKey) detectedIdKey = detectEmployeeIdKey(page.entries[0]);
                nextUrl = extractNextLink(page.payload);
            }
        } else {
            const firstSig = pageSignature(firstPage.entries, detectedIdKey);
            let chosen: OffsetStrategy | null = null;
            let secondPageRows: any[] = [];

            for (const strategy of OFFSET_STRATEGIES) {
                const candidateUrl = strategy.makeUrl(requestUrlFinal, 2, args.pageSize);
                if (seenPageUrls.has(candidateUrl)) continue;
                seenPageUrls.add(candidateUrl);

                const page = await fetchPayload(candidateUrl, token, args);
                const sig = pageSignature(page.entries, detectedIdKey);

                if (page.entries.length === 0) {
                    continue;
                }
                if (sig === firstSig) {
                    continue;
                }

                chosen = strategy;
                secondPageRows = page.entries;
                console.log(`Pagination strategy detected: ${chosen.name} (page 2 returned new data)`);
                break;
            }

            if (chosen) {
                pageCount += 1;
                allEntries.push(...secondPageRows);

                for (let pageNo = 3; pageNo <= args.maxPages; pageNo += 1) {
                    const pageUrl = chosen.makeUrl(requestUrlFinal, pageNo, args.pageSize);
                    if (seenPageUrls.has(pageUrl)) break;
                    seenPageUrls.add(pageUrl);

                    const page = await fetchPayload(pageUrl, token, args);
                    if (page.entries.length === 0) break;

                    const sig = pageSignature(page.entries, detectedIdKey);
                    if (sig === firstSig) break;

                    pageCount += 1;
                    allEntries.push(...page.entries);
                    console.log(`Fetched page ${pageNo}: +${page.entries.length} rows`);
                }
                console.log(`Pagination strategy: ${chosen.name}`);
            } else {
                console.log('Pagination strategy: not detected from response/query probing');
            }
        }
    }

    const uniqueRowsByKey = new Map<string, any>();
    for (let i = 0; i < allEntries.length; i += 1) {
        const row = allEntries[i];
        const employeeId = getEmployeeId(row, detectedIdKey);
        const rowKey = employeeId ? `id:${employeeId}` : `row:${JSON.stringify(row)}`;
        if (!uniqueRowsByKey.has(rowKey)) {
            uniqueRowsByKey.set(rowKey, row);
        }
    }
    const uniqueEntries = Array.from(uniqueRowsByKey.values());

    const uniqueEmployeeIds = Array.from(
        new Set(
            uniqueEntries
                .map((row) => getEmployeeId(row, detectedIdKey))
                .filter((id) => id)
        )
    );

    console.log(`Page fetched: ${pageCount}`);
    console.log(`Row count (raw): ${allEntries.length}`);
    console.log(`Row count (dedup): ${uniqueEntries.length}`);
    if (detectedIdKey) {
        console.log(`Employee ID key: ${detectedIdKey}`);
    } else {
        console.log('Employee ID key: not detected');
    }
    console.log(`Unique employee IDs: ${uniqueEmployeeIds.length}`);

    if (args.csv) {
        const csv = args.idsOnly
            ? toIdCsv(uniqueEmployeeIds, args.excelSafe)
            : toCsvRows(uniqueEntries, args.excelSafe);
        await writeFile(args.outputPath, csv, 'utf8');
        console.log(`CSV file saved: ${args.outputPath}`);
        console.log(`CSV mode: ${args.idsOnly ? 'employee IDs only' : 'full rows'}`);
        console.log(`Excel-safe mode: ${args.excelSafe ? 'enabled' : 'disabled (--rawCsv)'}`);
        return;
    }

    if (uniqueEntries.length > 0) {
        console.log('First entry:');
        console.log(JSON.stringify(uniqueEntries[0], null, 2));
    } else {
        console.log('No entries returned from API');
    }
}

run().catch((error) => {
    console.error('PIS test failed:', error instanceof Error ? error.message : error);
    process.exit(1);
});
