import { maskPath, maskLogLine } from './maskPath';

describe('maskPath', () => {
  it('masks password in ntrip path', () => {
    expect(maskPath('user:pass@rtk2go.com:2101/MOUNT'))
      .toBe('user:***@rtk2go.com:2101/MOUNT');
  });
  it('leaves path unchanged when no password', () => {
    expect(maskPath('user@rtk2go.com:2101/MOUNT'))
      .toBe('user@rtk2go.com:2101/MOUNT');
  });
  it('leaves serial path unchanged', () => {
    expect(maskPath('/dev/ttyUSB0:115200'))
      .toBe('/dev/ttyUSB0:115200');
  });
  it('leaves tcp path unchanged', () => {
    expect(maskPath('192.168.1.1:9000'))
      .toBe('192.168.1.1:9000');
  });
  it('leaves empty string unchanged', () => {
    expect(maskPath('')).toBe('');
  });
  it('masks password with special characters', () => {
    expect(maskPath('admin:pass!123@host:2101/MP'))
      .toBe('admin:***@host:2101/MP');
  });
});

describe('maskLogLine', () => {
  it('masks credentials in log line', () => {
    expect(maskLogLine(
      '[CONF] path = "user:secret@153.121.59.53:2101/ECJ02"'
    )).toBe(
      '[CONF] path = "user:***@153.121.59.53:2101/ECJ02"'
    );
  });
  it('masks multiple credentials in one line', () => {
    expect(maskLogLine(
      'rover=user:p1@host1:2101 corr=user:p2@host2:2101'
    )).toBe(
      'rover=user:***@host1:2101 corr=user:***@host2:2101'
    );
  });
  it('leaves lines without credentials unchanged', () => {
    const line = '[INFO] mrtk run started';
    expect(maskLogLine(line)).toBe(line);
  });
});
