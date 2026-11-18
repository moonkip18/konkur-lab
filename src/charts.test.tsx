import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { TrendChart, CountChart, BaselineChart } from './components/charts';
import type { Series } from './components/charts';

/** Collects the rendered text of every left/right axis tick label. */
function tickTexts(): string[] {
  const out: string[] = [];
  document.querySelectorAll('.recharts-cartesian-axis-tick-value').forEach((el) => {
    out.push(el.textContent ?? '');
  });
  return out;
}

describe('TrendChart axes', () => {
  const series: Series[] = [{ key: 'a', label: 'A', color: '#ffffff', axis: 'left' }];
  const data = [
    { d: '1', a: 10 },
    { d: '2', a: 60 },
  ];

  it('spreads left ticks across a forced domain', () => {
    const { unmount } = render(
      <TrendChart data={data} series={series} xKey="d" leftDomain={[-40, 100]} leftTicks={5} />,
    );
    const texts = tickTexts();
    expect(texts).toContain('-40%');
    expect(texts).toContain('30%');
    expect(texts).toContain('100%');
    unmount();
  });

  it('emits evenly spaced integer ticks for a count domain', () => {
    const { unmount } = render(
      <TrendChart
        data={data}
        series={series}
        xKey="d"
        leftDomain={[0, 40]}
        leftTicks={6}
        leftSuffix=""
      />,
    );
    const texts = tickTexts();
    expect(texts).toContain('0');
    expect(texts).toContain('8');
    expect(texts).toContain('40');
    unmount();
  });
});

describe('other chart shells render', () => {
  it('CountChart and BaselineChart mount without crashing', () => {
    const bars = [{ key: 'e', label: 'Easy', color: '#ffffff' }];
    const data = [{ d: '1', e: 3 }];
    render(<CountChart data={data} bars={bars} xKey="d" />);
    render(
      <BaselineChart
        data={data}
        series={[{ key: 'e', label: 'Easy', color: '#ffffff' }]}
        xKey="d"
        baseline={() => 50}
        baselineLabel="expected"
      />,
    );
    expect(document.querySelector('.chart-box')).not.toBeNull();
  });
});
