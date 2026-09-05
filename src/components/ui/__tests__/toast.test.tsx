import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useRef } from 'react';
import { render, screen, within, cleanup, fireEvent } from '@testing-library/react';
import { ToastProvider, useToast } from '../toast';

// fireEvent (not userEvent) throughout: userEvent's internal pointer-delay bookkeeping fights
// fake timers and hangs the click, and every interaction here is a plain synchronous DOM event
// anyway — there is nothing userEvent's realism buys this suite.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Each click fires a distinct title so the queue-cap test can tell items apart. */
function Harness() {
  const { toast } = useToast();
  const count = useRef(0);
  return (
    <button
      onClick={() => {
        count.current += 1;
        toast({ tone: 'neutral', title: `Toast ${count.current}` });
      }}
    >
      Show toast
    </button>
  );
}

function setup() {
  render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  );
  return screen.getByRole('button', { name: 'Show toast' });
}

describe('ToastProvider / useToast', () => {
  it('renders toast content in a role="status" region', () => {
    const button = setup();
    fireEvent.click(button);

    expect(within(screen.getByRole('status')).getByText('Toast 1')).toBeTruthy();
  });

  it('auto-dismisses after 5 seconds', async () => {
    const button = setup();
    fireEvent.click(button);
    const region = screen.getByRole('status');
    expect(within(region).getByText('Toast 1')).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(within(region).queryByText('Toast 1')).toBeNull();
  });

  it('pauses the dismiss timer while hovered', async () => {
    const button = setup();
    fireEvent.click(button);
    const region = screen.getByRole('status');
    const toastEl = region.firstElementChild as HTMLElement;

    fireEvent.mouseEnter(toastEl);
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(within(region).getByText('Toast 1')).toBeTruthy();

    fireEvent.mouseLeave(toastEl);
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(within(region).queryByText('Toast 1')).toBeNull();
  });

  it('caps the queue at 3 items', () => {
    const button = setup();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    const region = screen.getByRole('status');
    expect(within(region).queryByText('Toast 1')).toBeNull();
    expect(within(region).getByText('Toast 2')).toBeTruthy();
    expect(within(region).getByText('Toast 3')).toBeTruthy();
    expect(within(region).getByText('Toast 4')).toBeTruthy();
  });
});
