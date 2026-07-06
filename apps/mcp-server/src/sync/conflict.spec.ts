import { isEngramNewer } from './conflict';

describe('isEngramNewer (D7 conflict decision)', () => {
  const lastImport = new Date('2026-07-01T00:00:00.000Z');

  it('is true when the memory was edited well after the last import', () => {
    expect(
      isEngramNewer(new Date('2026-07-05T00:00:00.000Z'), lastImport),
    ).toBe(true);
  });

  it('is false when the memory has not been edited since the import', () => {
    expect(isEngramNewer(lastImport, lastImport)).toBe(false);
  });

  it('tolerates sub-skew clock differences (memory written just after ledger)', () => {
    const memory = new Date(lastImport.getTime() + 3000); // < 5s default skew
    expect(isEngramNewer(memory, lastImport)).toBe(false);
  });

  it('flags a conflict just past the skew window', () => {
    const memory = new Date(lastImport.getTime() + 6000);
    expect(isEngramNewer(memory, lastImport)).toBe(true);
  });

  it('respects a custom skew', () => {
    const memory = new Date(lastImport.getTime() + 10_000);
    expect(isEngramNewer(memory, lastImport, 20_000)).toBe(false);
    expect(isEngramNewer(memory, lastImport, 5_000)).toBe(true);
  });
});
