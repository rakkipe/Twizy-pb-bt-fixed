const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture({ failWrite = false } = {}) {
  const elements = new Map(), sent = [], timers = new Map();
  let timerId = 0;
  function element(key) {
    if (!elements.has(key)) elements.set(key, {
      value: key === '#adapterMode' ? 'm5' : '', checked: false, disabled: false,
      textContent: '', style: {}, handlers: {}, classList: { toggle() {} },
      querySelector: () => element(key + ' span'),
      addEventListener(event, fn) { this.handlers[event] = fn; },
    });
    return elements.get(key);
  }
  const context = vm.createContext({
    document: { querySelector: element, querySelectorAll: () => [] }, navigator: {},
    TextEncoder, TextDecoder, Date, console, alert() {},
    setInterval: () => 0, clearInterval() {},
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    fakeWriter: { async write(bytes) { if (failWrite) throw Error('disconnected'); sent.push(new TextDecoder().decode(bytes)); }, releaseLock() {} },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8'), context);
  const run = (code) => vm.runInContext(code, context);
  run('port = {writable: {getWriter: () => fakeWriter}}');
  const ready = () => { element('#safetyCheck').checked = true; element('#safetyCode').value = 'V12'; };
  const arm = async () => { ready(); await element('#armButton').handlers.click(); };
  const ack = () => run('parseLine("ARMED for one transaction / 60 seconds")');
  return { element, run, ready, arm, ack, sent, timers };
}

test('manual commands cannot bypass guarded writes, including case and injected lines', async () => {
  const f = fixture(); f.ready();
  for (const command of ['arm V12', 'apply', 'ARM V12', 'apply\nstatus', 'status\narm V12']) {
    assert.equal(await f.run(`sendCommand(${JSON.stringify(command)})`), false);
  }
  assert.equal(f.sent.length, 0);
  assert.equal(await f.run('sendCommand("status")'), true);
  assert.deepEqual(f.sent, ['status\n']);
});

test('firmware acknowledgement, not successful USB transmission, enables APPLY', async () => {
  const f = fixture(); await f.arm();
  assert.equal(f.element('#applyButton').disabled, true);
  assert.deepEqual(f.sent, ['arm V12\n']);
  f.ack();
  assert.equal(f.element('#applyButton').disabled, false);
  assert.equal(f.timers.size, 0);
});

test('firmware denial clears pending arming and a late acknowledgement cannot rearm', async () => {
  const f = fixture(); await f.arm();
  f.run('parseLine("DENIED: vehicle must be stationary in Neutral")'); f.ack();
  assert.equal(f.element('#applyButton').disabled, true);
  assert.equal(f.run('armPending'), false);
});

test('timeout and transmission failure both keep APPLY locked', async () => {
  const f = fixture(); await f.arm(); [...f.timers.values()][0](); f.ack();
  assert.equal(f.element('#applyButton').disabled, true);
  const failed = fixture({failWrite: true}); await failed.arm(); failed.ack();
  assert.equal(failed.element('#applyButton').disabled, true);
  assert.equal(failed.timers.size, 0);
});

test('unsolicited ACK, changed confirmation, disconnection and expiry cannot grant writes', async () => {
  const f = fixture(); f.ready(); f.ack(); f.run('refreshSafety()');
  assert.equal(f.element('#applyButton').disabled, true);
  await f.arm(); f.ack(); f.element('#safetyCheck').checked = false;
  f.element('#safetyCheck').handlers.change(); f.element('#safetyCheck').checked = true;
  f.run('refreshSafety()'); assert.equal(f.element('#applyButton').disabled, true);
  await f.arm(); f.ack(); f.run('armedUntil = Date.now() - 1; refreshSafety()');
  assert.equal(await f.run('sendCommand("apply", {guardedWrite: true})'), false);
  await f.arm(); f.run('setConnected(false)'); f.ack();
  assert.equal(f.element('#applyButton').disabled, true);
});

test('APPLY consumes the arm window before sending and rechecks dialog prerequisites', async () => {
  const f = fixture(); await f.arm(); f.ack();
  f.element('#applyDialog').returnValue = 'confirm'; await f.element('#applyDialog').handlers.close();
  assert.equal(f.sent.filter(x => x === 'apply\n').length, 1);
  assert.equal(await f.run('sendCommand("apply", {guardedWrite: true})'), false);
  const changed = fixture(); await changed.arm(); changed.ack(); changed.element('#safetyCode').value = 'wrong';
  changed.element('#applyDialog').returnValue = 'confirm'; await changed.element('#applyDialog').handlers.close();
  assert.equal(changed.sent.includes('apply\n'), false);
});

test('fragmented legacy and real line endings parse identity and ARM acknowledgement', async () => {
  const f = fixture();
  f.run('consumeM5Data("product 0x1018.02 = 0x0712302D\\\\")');
  assert.notEqual(f.element('#controllerValue').textContent, '0712302D');
  f.run('consumeM5Data("n")');
  assert.equal(f.element('#controllerValue').textContent, '0712302D');
  await f.arm(); f.run('consumeM5Data("ARMED for one transaction / 60 seconds\\r")');
  assert.equal(f.element('#applyButton').disabled, true);
  f.run('consumeM5Data("\\n")'); assert.equal(f.element('#applyButton').disabled, false);
});

test('VLinker framing, whitespace parsing and read-only write policy remain correct', async () => {
  const f = fixture(); f.run('$("#adapterMode").value = "vlinker"');
  await f.run('writeSerialLine("ATI")'); assert.deepEqual(f.sent, ['ATI\r']);
  assert.equal(f.run('elmClean("SEARCHING...\\r\\n581 43 18 10 02 2D 30 12 07\\r\\nOK")[0]'), '581431810022D301207');
  f.run('vlinkerSdoRead = async (index, sub) => index + "." + sub');
  assert.equal(await f.run('handleVlinkerCommand("read 1018 02")'), '1018.02');
  f.ready(); assert.equal(await f.run('sendCommand("arm V12", {guardedWrite:true})'), false);
});

test('firmware replies no longer contain escaped textual newline delimiters', () => {
  const cpp=fs.readFileSync(path.join(__dirname, '../../tuner/src/main.cpp'), 'utf8');
  assert.equal(cpp.includes('\\\\n"'), false);
});
