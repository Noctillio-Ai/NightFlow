import test from 'node:test';
import assert from 'node:assert/strict';
import { sshKeyPath, withSshKey, sshHost, isUsableKeyPath } from '../src/utils/sshCommand.js';

test('reads the key from -i in either form', () => {
  assert.equal(sshKeyPath('ssh user@host'), null);
  assert.equal(sshKeyPath('ssh -i /k/id_ed25519 user@host'), '/k/id_ed25519');
  assert.equal(sshKeyPath('ssh -p 2222 -i/k/work user@host'), '/k/work');
  assert.equal(sshKeyPath(''), null);
});

test('sets a key and pins IdentitiesOnly, keeping other flags', () => {
  assert.equal(
    withSshKey('ssh -p 2222 user@host', '/k/a'),
    'ssh -i /k/a -o IdentitiesOnly=yes -p 2222 user@host',
  );
});

test('replaces an existing key instead of adding a second one', () => {
  const once = withSshKey('ssh user@host', '/k/a');
  const twice = withSshKey(once, '/k/b');
  assert.equal(twice, 'ssh -i /k/b -o IdentitiesOnly=yes user@host');
  assert.equal(withSshKey('ssh -i/k/a -oIdentitiesOnly=yes user@host', '/k/c'), 'ssh -i /k/c -o IdentitiesOnly=yes user@host');
});

test('clearing the key restores ssh defaults but keeps unrelated -o options', () => {
  assert.equal(
    withSshKey('ssh -i /k/a -o IdentitiesOnly=yes -o ServerAliveInterval=30 user@host', null),
    'ssh -o ServerAliveInterval=30 user@host',
  );
});

test('a key with no command yet starts one', () => {
  assert.equal(withSshKey('', '/k/a'), 'ssh -i /k/a -o IdentitiesOnly=yes');
  assert.equal(withSshKey('', null), '');
});

test('host label skips flags', () => {
  assert.equal(sshHost('ssh -i /k/a -o IdentitiesOnly=yes ubuntu@gpu'), 'ubuntu@gpu');
  assert.equal(sshHost('ssh -p 22 gpu-box'), 'gpu-box');
  assert.equal(sshHost('ssh'), 'ssh');
});

test('paths with whitespace are not usable in commands', () => {
  assert.equal(isUsableKeyPath('/Users/me/.ssh/id'), true);
  assert.equal(isUsableKeyPath('/Users/me/My Keys/id'), false);
  assert.equal(isUsableKeyPath(''), false);
});
