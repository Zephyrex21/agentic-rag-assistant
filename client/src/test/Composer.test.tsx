import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from '../components/chat/Composer';

describe('Composer', () => {
  it('calls onSend with the trimmed text when the send button is clicked', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<Composer onSend={onSend} disabled={false} />);

    await user.type(screen.getByPlaceholderText(/ask a question/i), '  What is this about?  ');
    await user.click(screen.getByRole('button'));

    expect(onSend).toHaveBeenCalledWith('What is this about?');
  });

  it('sends on Enter without Shift', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<Composer onSend={onSend} disabled={false} />);

    await user.type(screen.getByPlaceholderText(/ask a question/i), 'Quick question{Enter}');

    expect(onSend).toHaveBeenCalledWith('Quick question');
  });

  it('does NOT send on Shift+Enter - inserts a newline instead', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<Composer onSend={onSend} disabled={false} />);

    const textarea = screen.getByPlaceholderText(/ask a question/i);
    await user.type(textarea, 'Line one{Shift>}{Enter}{/Shift}Line two');

    expect(onSend).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('Line one\nLine two');
  });

  it('does not call onSend for an empty or whitespace-only message', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<Composer onSend={onSend} disabled={false} />);

    await user.type(screen.getByPlaceholderText(/ask a question/i), '   {Enter}');

    expect(onSend).not.toHaveBeenCalled();
  });

  it('clears the input after a successful send', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<Composer onSend={onSend} disabled={false} />);

    const textarea = screen.getByPlaceholderText(/ask a question/i);
    await user.type(textarea, 'Hello{Enter}');

    expect(textarea).toHaveValue('');
  });

  it('disables the send button while a response is streaming (disabled=true)', () => {
    render(<Composer onSend={vi.fn()} disabled={true} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('does not send while disabled, even on Enter', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<Composer onSend={onSend} disabled={true} />);

    await user.type(screen.getByPlaceholderText(/ask a question/i), 'Should not send{Enter}');

    expect(onSend).not.toHaveBeenCalled();
  });
});
