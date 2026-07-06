import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ExpiryBadge } from './expiry-badge';

describe('ExpiryBadge (WP2 T3)', () => {
  it('renders a countdown for a future expiry', () => {
    const future = new Date(Date.now() + 3 * 3600_000).toISOString();
    render(<ExpiryBadge expiresAt={future} />);
    expect(screen.getByText(/expires in/)).toBeInTheDocument();
  });

  it('flags an imminent expiry (<15 min) as "Expiring soon"', () => {
    const soon = new Date(Date.now() + 5 * 60_000).toISOString();
    render(<ExpiryBadge expiresAt={soon} />);
    expect(screen.getByText(/Expiring soon/)).toBeInTheDocument();
  });

  it('renders nothing when there is no expiry', () => {
    const { container } = render(<ExpiryBadge expiresAt={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
