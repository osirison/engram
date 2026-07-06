import { describe, expect, it, vi, beforeEach } from 'vitest';

import { downloadBase64Zip } from './download-zip';

describe('downloadBase64Zip (WP3 T8)', () => {
  beforeEach(() => {
    // happy-dom does not implement object URLs; stub them.
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  it('decodes base64 and downloads via a transient anchor named after the file', () => {
    const downloads: string[] = [];
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      downloads.push(this.download);
    });

    downloadBase64Zip(btoa('fake-zip-bytes'), 'memories.zip');

    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(downloads).toEqual(['memories.zip']);
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    // The transient anchor is cleaned up after clicking.
    expect(document.querySelector('a[download]')).toBeNull();

    clickSpy.mockRestore();
  });
});
