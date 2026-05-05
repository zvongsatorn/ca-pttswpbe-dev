import test from "node:test";
import assert from "node:assert/strict";
import {
    calculateReport7ShapeGapMetrics,
    parseReport7FormulaConfig,
    report7FormulaConfig
} from "../config/report7FormulaConfig.ts";

const assertClose = (actual: number, expected: number) => {
    assert.ok(Math.abs(actual - expected) < 0.000001, `expected ${actual} to be close to ${expected}`);
};

test("Report 7 distributes DM/SR/JR shape by manpower ratio and calculates gaps", () => {
    const metrics = calculateReport7ShapeGapMetrics({
        q_4: 10,
        q_5: 30,
        q_6: 20,
        q_7: 10,
        mp_dm: 2,
        mp_sr: 1,
        mp_jr: 1
    });

    assert.equal(metrics.shape_vp, 10);
    assert.equal(metrics.shape_dm, 30);
    assert.equal(metrics.shape_sr, 15);
    assert.equal(metrics.shape_jr, 15);
    assert.equal(metrics.shape_total, 70);
    assert.equal(metrics.gap_vp, 0);
    assert.equal(metrics.gap_dm, 0);
    assertClose(metrics.gap_sr, 1 / 3);
    assertClose(metrics.gap_jr, -1 / 3);
    assert.equal(metrics.gap_total, 0);
});

test("Report 7 formula guards zero manpower denominator", () => {
    const metrics = calculateReport7ShapeGapMetrics({ q_4: 5, q_5: 10, q_6: 10, q_7: 10 });

    assert.equal(metrics.shape_dm, 0);
    assert.equal(metrics.shape_sr, 0);
    assert.equal(metrics.shape_jr, 0);
    assert.equal(metrics.gap_dm, 0);
    assert.equal(metrics.gap_sr, 0);
    assert.equal(metrics.gap_jr, 0);
});

test("Report 7 formula config accepts the production config and rejects invalid rules", () => {
    assert.equal(parseReport7FormulaConfig(report7FormulaConfig), report7FormulaConfig);
    assert.equal(parseReport7FormulaConfig({ shape: {}, gap: {} }), null);
});
