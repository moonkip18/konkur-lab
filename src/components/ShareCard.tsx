import { useCallback, useState } from 'react';
import { SUBJECTS, formatDate, formatIndex, formatPercent, type DateDisplayMode } from '../lib/scoring';
import type { ExamPoint } from '../lib/chartData';
import type { ExamRecord } from '../lib/db/models';
import { Chip } from './primitives';

/**
 * Shareable summary of the latest completed exam.
 *
 * Two outputs, one source of truth: a PNG card rendered on a canvas in the
 * app's own dark style, and a plain-text fallback for places that don't take
 * images. Both carry the estimation line so a shared card can never imply
 * official results.
 */

const W = 1000;
const H = 525;

export function buildShareText(point: ExamPoint, mode: DateDisplayMode): string {
  const lines = [
    `Konkur Progress Lab — ${formatDate(point.date, mode)}`,
    ...SUBJECTS.map((s) => {
      const sub = point.subjects[s.id];
      return `${s.nameEn} ${s.nameFa}: raw ${formatPercent(sub.rawNet, 1)}`;
    }),
    `Weighted raw: ${formatPercent(point.rawWeighted, 1)}`,
    `Difficulty-adjusted index (estimation): ${formatIndex(point.overallIndex)}`,
    'Self-tracked estimate from a fixed toy model — not an official تراز, rank, or real data.',
  ];
  return lines.join('\n');
}

export function renderShareCard(canvas: HTMLCanvasElement, point: ExamPoint, mode: DateDisplayMode): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = 2;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  // background + hairline frame
  ctx.fillStyle = '#050506';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.strokeRect(14.5, 14.5, W - 29, H - 29);
  ctx.fillStyle = '#c8433c';
  ctx.fillRect(14, 14, 3, 72);

  // header
  ctx.fillStyle = '#e9eaec';
  ctx.font = '300 30px Georgia, "Times New Roman", serif';
  ctx.fillText('Konkur Progress Lab', 40, 62);
  ctx.fillStyle = '#8b8f97';
  ctx.font = '400 15px ui-monospace, monospace';
  ctx.fillText(formatDate(point.date, mode), 40, 92);

  // subject columns
  const colW = (W - 80) / SUBJECTS.length;
  SUBJECTS.forEach((s, i) => {
    const sub = point.subjects[s.id];
    const x = 40 + i * colW;
    ctx.fillStyle = '#565a61';
    ctx.font = '500 11px ui-monospace, monospace';
    ctx.fillText(`${s.nameEn} · ${s.nameFa}`, x, 150);
    ctx.fillStyle = '#e9eaec';
    ctx.font = '300 44px Georgia, serif';
    ctx.fillText(formatPercent(sub.rawNet, 1), x, 200);
    ctx.fillStyle = '#8b8f97';
    ctx.font = '400 13px ui-monospace, monospace';
    ctx.fillText(
      `τ ${formatIndex(sub.index)} · ${sub.correct}C ${sub.wrong}W ${sub.blank}B`,
      x,
      228,
    );
  });

  // divider
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(40, 268);
  ctx.lineTo(W - 40, 268);
  ctx.stroke();

  // index row
  ctx.fillStyle = '#565a61';
  ctx.font = '500 11px ui-monospace, monospace';
  ctx.fillText('DIFFICULTY-ADJUSTED INDEX · ESTIMATION', 40, 300);
  ctx.fillStyle = '#c8433c';
  ctx.font = '300 76px Georgia, serif';
  ctx.fillText(formatIndex(point.overallIndex), 36, 380);
  ctx.fillStyle = '#8b8f97';
  ctx.font = '400 14px ui-monospace, monospace';
  ctx.fillText(
    `weighted raw ${formatPercent(point.rawWeighted, 1)} · accuracy ${formatPercent(point.accuracy ?? 0, 0)}`,
    40,
    412,
  );

  // disclaimer
  ctx.fillStyle = '#565a61';
  ctx.font = '400 13px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(
    'Self-tracked estimate from a fixed toy model — not an official rank or real data.',
    40,
    H - 44,
  );
}

export function ShareCard({ exam, point, mode }: { exam: ExamRecord; point: ExamPoint; mode: DateDisplayMode }): JSX.Element {
  const [status, setStatus] = useState<string | null>(null);

  const download = useCallback(() => {
    const canvas = document.createElement('canvas');
    renderShareCard(canvas, point, mode);
    canvas.toBlob((blob) => {
      if (!blob) {
        setStatus('Could not render the card.');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `konkur-${exam.date}.png`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('Card saved.');
    }, 'image/png');
  }, [exam.date, point, mode]);

  const share = useCallback(async () => {
    const text = buildShareText(point, mode);
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: 'Konkur Progress Lab', text });
        setStatus('Shared.');
        return;
      } catch {
        /* user cancelled — fall through to clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Summary copied to clipboard.');
    } catch {
      setStatus(text); // last resort: show it so the user can copy manually
    }
  }, [point, mode]);

  return (
    <div className="row row-wrap" style={{ gap: 8, alignItems: 'center' }}>
      <button className="btn btn-sm" type="button" onClick={download}>
        Save share card (PNG)
      </button>
      <button className="btn btn-sm btn-ghost" type="button" onClick={() => void share()}>
        Share / copy summary
      </button>
      {status ? (
        status.length > 60 ? (
          <textarea
            className="textarea mono"
            readOnly
            rows={6}
            value={status}
            aria-label="Share text"
            style={{ maxWidth: 460 }}
          />
        ) : (
          <Chip>{status}</Chip>
        )
      ) : null}
    </div>
  );
}
