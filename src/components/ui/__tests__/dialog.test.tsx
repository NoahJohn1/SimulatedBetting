import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ConfirmDialog } from '../dialog';

/**
 * jsdom does not implement `<dialog>`'s `showModal`/`close` (still true as of jsdom 27 — see
 * jsdom/jsdom#3294) or the platform's Escape-cancels-then-closes chain ConfirmDialog leans on
 * (D79's comment: "ESC-to-close needs no keydown listener because the platform already fires
 * it"). This polyfill gives HTMLDialogElement just enough of that platform behaviour — the
 * `open` attribute, a `close` event, Escape closing the top modal dialog — for the component's
 * real wiring to run unmodified. It is test-environment plumbing, not a component change.
 */
function installDialogPolyfill() {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { __polyfilled?: boolean };
  if (proto.__polyfilled) return;
  const openDialogs = new Set<HTMLDialogElement>();

  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
    openDialogs.add(this);
    // Real showModal() autofocuses the first focusable descendant (or the dialog itself);
    // ConfirmDialog relies on that platform behaviour rather than focusing anything by hand.
    const focusable = this.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? this).focus();
  };
  proto.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    openDialogs.delete(this);
    this.dispatchEvent(new Event('close'));
  };
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || openDialogs.size === 0) return;
    const top = [...openDialogs].at(-1)!;
    top.dispatchEvent(new Event('cancel', { cancelable: true }));
    top.close();
  });
  proto.__polyfilled = true;
}

beforeAll(() => installDialogPolyfill());
afterEach(() => cleanup());

/** Mirrors real usage: a controlled dialog whose `open` state lives with the invoking button. */
function Harness({ onConfirm }: { onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open dialog</button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={onConfirm}
        title="Call it off?"
        body="This cancels the wager."
        confirmLabel="Call it off"
      />
    </>
  );
}

describe('ConfirmDialog', () => {
  it('opens via showModal', async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={vi.fn()} />);

    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));

    expect(showModal).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Call it off?' })).toBeTruthy();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    expect(screen.getByRole('heading', { name: 'Call it off?' })).toBeTruthy();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('heading', { name: 'Call it off?' })).toBeNull();
  });

  it('returns focus to the invoking element on close', async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={vi.fn()} />);

    const opener = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(opener);
    expect(document.activeElement).not.toBe(opener);

    await user.keyboard('{Escape}');

    expect(document.activeElement).toBe(opener);
  });

  it('fires onConfirm exactly once when confirmed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    await user.click(screen.getByRole('button', { name: 'Call it off' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { name: 'Call it off?' })).toBeNull();
  });
});
