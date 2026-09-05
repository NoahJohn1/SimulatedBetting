import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Sheet } from '../sheet';

afterEach(() => cleanup());

/** Mirrors real usage: a controlled sheet whose `open` state lives with the invoking button. */
function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open slip</button>
      <Sheet
        open={open}
        onClose={() => {
          setOpen(false);
          onClose?.();
        }}
        label="Bet slip"
      >
        <p>Slip contents</p>
      </Sheet>
    </>
  );
}

describe('Sheet', () => {
  it('calls onClose on a scrim click', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open slip' }));
    const panel = screen.getByRole('dialog', { name: 'Bet slip' });
    const scrim = panel.parentElement;
    expect(scrim).not.toBeNull();

    fireEvent.click(scrim!);

    expect(screen.queryByRole('dialog', { name: 'Bet slip' })).toBeNull();
  });

  it('calls onClose on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open slip' }));
    expect(screen.getByRole('dialog', { name: 'Bet slip' })).toBeTruthy();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Bet slip' })).toBeNull();
  });

  it('locks body scroll while open and restores it after close', async () => {
    const user = userEvent.setup();
    const previousOverflow = document.body.style.overflow;
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open slip' }));
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');

    expect(document.body.style.overflow).toBe(previousOverflow);
  });

  it('moves focus into the sheet on open and restores it to the invoker on close', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const opener = screen.getByRole('button', { name: 'Open slip' });
    await user.click(opener);

    const panel = screen.getByRole('dialog', { name: 'Bet slip' });
    expect(document.activeElement).toBe(panel);

    await user.keyboard('{Escape}');

    expect(document.activeElement).toBe(opener);
  });
});
