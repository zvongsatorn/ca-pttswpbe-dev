export type Report7FormulaField =
    | 'q_4'
    | 'q_5'
    | 'q_6'
    | 'q_7'
    | 'q_total'
    | 'contract_out'
    | 'mp_vp'
    | 'mp_dm'
    | 'mp_sr'
    | 'mp_jr'
    | 'mp_total'
    | 'shape_vp'
    | 'shape_dm'
    | 'shape_sr'
    | 'shape_jr'
    | 'shape_total';

type Report7ShapeRule =
    | { type: 'direct'; field: Report7FormulaField }
    | {
        type: 'ratio_x_sum';
        numerator: Report7FormulaField;
        denominator: Report7FormulaField[];
        multiplier: Report7FormulaField[];
    }
    | { type: 'sum'; fields: Report7FormulaField[] };

type Report7GapMetricField = 'gap_vp' | 'gap_dm' | 'gap_sr' | 'gap_jr' | 'gap_total';

type Report7GapRule =
    | {
        type: 'ratio';
        baseField: Report7FormulaField;
        shapeField: Report7FormulaField;
    }
    | {
        type: 'sum';
        fields: Report7GapMetricField[];
    };

export type Report7FormulaConfig = {
    shape: {
        vp: Report7ShapeRule;
        dm: Report7ShapeRule;
        sr: Report7ShapeRule;
        jr: Report7ShapeRule;
        total: Report7ShapeRule;
    };
    gap: {
        vp: Report7GapRule;
        dm: Report7GapRule;
        sr: Report7GapRule;
        jr: Report7GapRule;
        total: Report7GapRule;
    };
};

export type Report7FormulaInputs = Partial<Record<Report7FormulaField, number>>;

export type Report7CalculatedMetrics = {
    shape_vp: number;
    shape_dm: number;
    shape_sr: number;
    shape_jr: number;
    shape_total: number;
    gap_vp: number;
    gap_dm: number;
    gap_sr: number;
    gap_jr: number;
    gap_total: number;
};

const REPORT7_GAP_FIELDS: Report7GapMetricField[] = [
    'gap_vp',
    'gap_dm',
    'gap_sr',
    'gap_jr',
    'gap_total'
];

const REPORT7_FIELDS: Report7FormulaField[] = [
    'q_4',
    'q_5',
    'q_6',
    'q_7',
    'q_total',
    'contract_out',
    'mp_vp',
    'mp_dm',
    'mp_sr',
    'mp_jr',
    'mp_total',
    'shape_vp',
    'shape_dm',
    'shape_sr',
    'shape_jr',
    'shape_total'
];

const toFiniteNumber = (value: unknown): number => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
};

const safeRatio = (numerator: number, denominator: number): number => {
    if (!Number.isFinite(denominator) || denominator === 0) return 0;
    return numerator / denominator;
};

const getFieldValue = (
    values: Record<Report7FormulaField, number>,
    field: Report7FormulaField
): number => toFiniteNumber(values[field]);

const sumFields = (
    values: Record<Report7FormulaField, number>,
    fields: Report7FormulaField[]
): number => fields.reduce((sum, field) => sum + getFieldValue(values, field), 0);

const evaluateShapeRule = (
    values: Record<Report7FormulaField, number>,
    rule: Report7ShapeRule
): number => {
    if (rule.type === 'direct') {
        return getFieldValue(values, rule.field);
    }
    if (rule.type === 'sum') {
        return sumFields(values, rule.fields);
    }
    return safeRatio(
        getFieldValue(values, rule.numerator),
        sumFields(values, rule.denominator)
    ) * sumFields(values, rule.multiplier);
};

const evaluateGapRule = (
    values: Record<Report7FormulaField, number>,
    gaps: Record<Report7GapMetricField, number>,
    rule: Report7GapRule
): number => {
    if (rule.type === 'sum') {
        return rule.fields.reduce((sum, field) => sum + toFiniteNumber(gaps[field]), 0);
    }
    const base = getFieldValue(values, rule.baseField);
    const shape = getFieldValue(values, rule.shapeField);
    return safeRatio(base - shape, shape);
};

const isField = (value: unknown): value is Report7FormulaField =>
    typeof value === 'string' && REPORT7_FIELDS.includes(value as Report7FormulaField);

const isFieldArray = (value: unknown): value is Report7FormulaField[] =>
    Array.isArray(value) && value.every((item) => isField(item));

const isGapMetricField = (value: unknown): value is Report7GapMetricField =>
    typeof value === 'string' && REPORT7_GAP_FIELDS.includes(value as Report7GapMetricField);

const isGapMetricFieldArray = (value: unknown): value is Report7GapMetricField[] =>
    Array.isArray(value) && value.every((item) => isGapMetricField(item));

const isShapeRule = (value: unknown): value is Report7ShapeRule => {
    if (!value || typeof value !== 'object') return false;
    const rule = value as Record<string, unknown>;
    if (rule.type === 'direct') {
        return isField(rule.field);
    }
    if (rule.type === 'sum') {
        return isFieldArray(rule.fields);
    }
    if (rule.type === 'ratio_x_sum') {
        return (
            isField(rule.numerator) &&
            isFieldArray(rule.denominator) &&
            isFieldArray(rule.multiplier)
        );
    }
    return false;
};

const isGapRule = (value: unknown): value is Report7GapRule => {
    if (!value || typeof value !== 'object') return false;
    const rule = value as Record<string, unknown>;
    // backward compatible with old payload (no `type`)
    if ((rule.type === undefined || rule.type === null || rule.type === 'ratio') && isField(rule.baseField) && isField(rule.shapeField)) {
        return true;
    }
    if (rule.type === 'sum') {
        return isGapMetricFieldArray(rule.fields);
    }
    return false;
};

// สูตรอ้างอิงจากไฟล์ legacy/รายงาน Manpower Landscape_Calsheet.xlsx
// Shape Ratio
// VP    : =M  (14-15)
// DM    : =(DM/(DM+SR+JR))*(รวม-(21+18-20+16-17+14-15))  => q5+q6+q7
// SR    : =(SR/(DM+SR+JR))*(รวม-(21+18-20+16-17+14-15))  => q5+q6+q7
// JR    : =(JR/(DM+SR+JR))*(รวม-(21+18-20+16-17+14-15))  => q5+q6+q7
// Total : =SUM(VP:JR)
// %Gap
// VP    : =(q4-shape_vp)/shape_vp
// DM    : =(q5-shape_dm)/shape_dm
// SR    : =(q6-shape_sr)/shape_sr
// JR    : =(q7-shape_jr)/shape_jr
// Total : =SUM(gap_vp:gap_jr)
export const report7FormulaConfig: Report7FormulaConfig = {
    shape: {
        vp: { type: 'direct', field: 'q_4' },
        dm: {
            type: 'ratio_x_sum',
            numerator: 'mp_dm',
            denominator: ['mp_dm', 'mp_sr', 'mp_jr'],
            multiplier: ['q_5', 'q_6', 'q_7']
        },
        sr: {
            type: 'ratio_x_sum',
            numerator: 'mp_sr',
            denominator: ['mp_dm', 'mp_sr', 'mp_jr'],
            multiplier: ['q_5', 'q_6', 'q_7']
        },
        jr: {
            type: 'ratio_x_sum',
            numerator: 'mp_jr',
            denominator: ['mp_dm', 'mp_sr', 'mp_jr'],
            multiplier: ['q_5', 'q_6', 'q_7']
        },
        total: {
            type: 'sum',
            fields: ['shape_vp', 'shape_dm', 'shape_sr', 'shape_jr']
        }
    },
    gap: {
        vp: { type: 'ratio', baseField: 'q_4', shapeField: 'shape_vp' },
        dm: { type: 'ratio', baseField: 'q_5', shapeField: 'shape_dm' },
        sr: { type: 'ratio', baseField: 'q_6', shapeField: 'shape_sr' },
        jr: { type: 'ratio', baseField: 'q_7', shapeField: 'shape_jr' },
        total: { type: 'sum', fields: ['gap_vp', 'gap_dm', 'gap_sr', 'gap_jr'] }
    }
};

export const isReport7FormulaConfig = (value: unknown): value is Report7FormulaConfig => {
    if (!value || typeof value !== 'object') return false;
    const config = value as Record<string, unknown>;
    if (!config.shape || typeof config.shape !== 'object') return false;
    if (!config.gap || typeof config.gap !== 'object') return false;

    const shape = config.shape as Record<string, unknown>;
    const gap = config.gap as Record<string, unknown>;

    return (
        isShapeRule(shape.vp) &&
        isShapeRule(shape.dm) &&
        isShapeRule(shape.sr) &&
        isShapeRule(shape.jr) &&
        isShapeRule(shape.total) &&
        isGapRule(gap.vp) &&
        isGapRule(gap.dm) &&
        isGapRule(gap.sr) &&
        isGapRule(gap.jr) &&
        isGapRule(gap.total)
    );
};

export const parseReport7FormulaConfig = (value: unknown): Report7FormulaConfig | null =>
    isReport7FormulaConfig(value) ? value : null;

export const calculateReport7ShapeGapMetrics = (
    inputs: Report7FormulaInputs,
    config: Report7FormulaConfig = report7FormulaConfig
): Report7CalculatedMetrics => {
    const values: Record<Report7FormulaField, number> = {
        q_4: 0,
        q_5: 0,
        q_6: 0,
        q_7: 0,
        q_total: 0,
        contract_out: 0,
        mp_vp: 0,
        mp_dm: 0,
        mp_sr: 0,
        mp_jr: 0,
        mp_total: 0,
        shape_vp: 0,
        shape_dm: 0,
        shape_sr: 0,
        shape_jr: 0,
        shape_total: 0
    };

    (Object.keys(inputs) as Report7FormulaField[]).forEach((field) => {
        values[field] = toFiniteNumber(inputs[field]);
    });

    values.mp_total = values.mp_vp + values.mp_dm + values.mp_sr + values.mp_jr;

    values.shape_vp = evaluateShapeRule(values, config.shape.vp);
    values.shape_dm = evaluateShapeRule(values, config.shape.dm);
    values.shape_sr = evaluateShapeRule(values, config.shape.sr);
    values.shape_jr = evaluateShapeRule(values, config.shape.jr);
    values.shape_total = evaluateShapeRule(values, config.shape.total);

    const gaps: Record<Report7GapMetricField, number> = {
        gap_vp: 0,
        gap_dm: 0,
        gap_sr: 0,
        gap_jr: 0,
        gap_total: 0
    };
    gaps.gap_vp = evaluateGapRule(values, gaps, config.gap.vp);
    gaps.gap_dm = evaluateGapRule(values, gaps, config.gap.dm);
    gaps.gap_sr = evaluateGapRule(values, gaps, config.gap.sr);
    gaps.gap_jr = evaluateGapRule(values, gaps, config.gap.jr);
    gaps.gap_total = evaluateGapRule(values, gaps, config.gap.total);

    return {
        shape_vp: values.shape_vp,
        shape_dm: values.shape_dm,
        shape_sr: values.shape_sr,
        shape_jr: values.shape_jr,
        shape_total: values.shape_total,
        gap_vp: gaps.gap_vp,
        gap_dm: gaps.gap_dm,
        gap_sr: gaps.gap_sr,
        gap_jr: gaps.gap_jr,
        gap_total: gaps.gap_total
    };
};
