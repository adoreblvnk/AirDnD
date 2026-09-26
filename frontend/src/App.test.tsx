import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./CesiumField', () => ({ default: () => null }));

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('training route', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/training');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('starts a real run with the explicit bounded configuration', async () => {
    const fetcher = vi.spyOn(window, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ id: 'run-17', status: 'queued', config: { seed: 7, samples: 512, epochs: 12 }, metrics: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'run-17', status: 'running', config: { seed: 7, samples: 512, epochs: 12 }, metrics: [{ epoch: 1, train_loss: 0.9, heldout_loss: 1.1 }] }));

    render(<App />);
    fireEvent.change(screen.getByLabelText('Seed'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Samples'), { target: { value: '512' } });
    fireEvent.change(screen.getByLabelText('Epochs'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'START TRAINING' }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/training/runs', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed: 7, samples: 512, epochs: 12 }),
    })));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/training/runs/run-17'));
    expect(await screen.findByText('RUNNING')).toBeInTheDocument();
    expect(screen.getByText('EPOCH 1 / 12')).toBeInTheDocument();
    expect(screen.getByText('0.9')).toBeInTheDocument();
    expect(screen.getByText('1.1')).toBeInTheDocument();
  });

  it('shows the completion report and only artifacts returned by the API', async () => {
    vi.spyOn(window, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ id: 'run-18', status: 'queued', seed: 42, samples: 1000, epochs: 20 }))
      .mockResolvedValueOnce(jsonResponse({
        id: 'run-18', status: 'completed', config: { seed: 17, samples: 256, epochs: 30 },
        metrics: [{ epoch: 30, train_loss: 0.125, heldout_loss: 0.25 }],
        report: { best_epoch: 19, duration_seconds: 4.75 },
        artifacts: [{ format: 'pytorch', path: 'training/run-18/belief-model.pt', size_bytes: 2048, sha256: 'abc123' }],
      }));

    render(<App />);
    expect(screen.queryByText('training/run-18/belief-model.pt')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'START TRAINING' }));

    expect(await screen.findByText('COMPLETED')).toBeInTheDocument();
    expect(screen.getByText('best epoch')).toBeInTheDocument();
    expect(screen.getByText('19')).toBeInTheDocument();
    expect(screen.getByText('training/run-18/belief-model.pt')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'training/run-18/belief-model.pt' })).not.toBeInTheDocument();
    expect(screen.getByText('pytorch')).toBeInTheDocument();
    expect(screen.getByText('2,048 bytes')).toBeInTheDocument();
    expect(screen.getByText('abc123')).toBeInTheDocument();
  });

  it('reports API errors without inventing progress or artifacts', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValueOnce(jsonResponse({ detail: 'samples exceeds configured limit' }, 422));

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'START TRAINING' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('samples exceeds configured limit');
    expect(screen.queryByText(/EPOCH \d/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /artifact/i })).not.toBeInTheDocument();
  });

  it('links training from worldview and evidence navigation', () => {
    window.history.pushState({}, '', '/');
    const { unmount } = render(<App />);
    expect(screen.getByTestId('nav-training')).toHaveAttribute('href', '/training');
    unmount();

    window.history.pushState({}, '', '/evidence');
    render(<App />);
    expect(screen.getByTestId('nav-training')).toHaveAttribute('href', '/training');
  });
});
