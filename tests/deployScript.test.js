import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requirementsFor, deviceOptions, defaultDevice, generateInferenceScript } from '../src/components/deploy/script.js';

test('pip line matches format, device and task', () => {
  assert.equal(requirementsFor('torchscript', 'cpu', 'Classification'), 'pip install torch torchvision numpy pillow');
  assert.equal(requirementsFor('onnx', 'cuda', 'Classification'), 'pip install onnxruntime-gpu numpy pillow');
  assert.equal(requirementsFor('onnx', 'directml', 'Classification'), 'pip install onnxruntime-directml numpy pillow');
  assert.equal(requirementsFor('tensorrt', 'cuda', 'Object Detection'), 'pip install tensorrt pycuda numpy pillow matplotlib');
});

test('device options depend on format and OS', () => {
  assert.deepEqual(deviceOptions('tensorrt', 'linux'), []);
  assert.deepEqual(deviceOptions('torchscript', 'linux').map((d) => d.id), ['cuda', 'cpu']);
  assert.deepEqual(deviceOptions('onnx', 'windows').map((d) => d.id), ['cuda', 'cpu', 'directml']);
  assert.ok(deviceOptions('torchscript', 'macos').some((d) => d.id === 'mps'));
});

test('default device prefers GPU, then Apple, then CPU', () => {
  assert.equal(defaultDevice('linux', true), 'cuda');
  assert.equal(defaultDevice('macos', false), 'mps');
  assert.equal(defaultDevice('linux', false), 'cpu');
});

test('script embeds model path and class names', () => {
  const s = generateInferenceScript({
    taskType: 'Classification', backbone: 'resnet18', numClasses: 2, imageSize: 224,
    modelPath: 'run1.onnx', imagePath: 'x.jpg', device: 'cpu', confThreshold: 0.5,
    classNames: 'cat, dog', exportFormat: 'onnx',
  });
  assert.match(s, /model_path: str = "run1\.onnx"/);
  assert.match(s, /class_names: tuple = \("cat", "dog",\)/);
  assert.match(s, /import onnxruntime as ort/);
});
