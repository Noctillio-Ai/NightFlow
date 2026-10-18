import test from 'node:test';
import assert from 'node:assert/strict';
import { pickTestAcc, testMetricsFromScalars, toTestOnlyCommand, commandSteps } from '../src/utils/testMetrics.js';

test('pickTestAcc tries each AutoTimm accuracy key in order', () => {
  assert.equal(pickTestAcc({ 'test/accuracy': 0.82, 'test/acc': 0.1 }), 0.82);
  assert.equal(pickTestAcc({ 'test/MulticlassAccuracy': 0.7 }), 0.7);
  assert.equal(pickTestAcc({ 'test/loss': 0.5 }), null);
  assert.equal(pickTestAcc({ 'test/accuracy': NaN }), null);
  assert.equal(pickTestAcc(undefined), null);
});

test('testMetricsFromScalars keeps the latest test/* values only', () => {
  const m = testMetricsFromScalars({
    'val/accuracy': [{ epoch: 9, value: 0.69 }],
    'test/accuracy': [{ epoch: 0, value: 0.80 }, { epoch: 0, value: 0.823 }],
    'test/loss': [0.51],
    'test/confusion_matrix': { matrix: [[1]] },
    'test/f1': [],
  });
  assert.deepEqual(m, { 'test/accuracy': 0.823, 'test/loss': 0.51 });
});

test('toTestOnlyCommand rewrites only the steps', () => {
  const cmd = '__STEPS_JSON__:{"mode":"conda","env_path":"~/p/.venv","config_path":"~/p/config.yaml","steps":"fit+test"}';
  const out = toTestOnlyCommand(cmd);
  assert.deepEqual(JSON.parse(out.slice('__STEPS_JSON__:'.length)), { mode: 'conda', env_path: '~/p/.venv', config_path: '~/p/config.yaml', steps: 'test' });
  assert.equal(commandSteps(cmd), 'fit+test');
  assert.equal(toTestOnlyCommand('python train.py'), null);
  assert.equal(commandSteps('__STEPS_JSON__:{broken'), '');
});
