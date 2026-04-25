import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import useScrollReveal from '../hooks/useScrollReveal';

function AnimatedCounter({ target, suffix = '', prefix = '', duration = 2000 }) {
  const [count, setCount] = useState(0);
  const [ref, isVisible] = useScrollReveal({ threshold: 0.3 });
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!isVisible || hasAnimated.current) return;
    hasAnimated.current = true;

    const start = performance.now();
    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      // Ease out quart
      const eased = 1 - Math.pow(1 - progress, 4);
      setCount(Math.floor(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [isVisible, target, duration]);

  return (
    <span ref={ref}>
      {prefix}{count}{suffix}
    </span>
  );
}

const metrics = [
  {
    icon: '💰',
    value: 90,
    suffix: '%',
    label: 'Cost Reduction',
    before: { label: 'Before', value: 100, color: 'var(--accent-rose)' },
    after: { label: 'After', value: 10, color: 'var(--accent-emerald)' },
  },
  {
    icon: '📉',
    value: 20,
    suffix: '',
    label: 'Lines Sent to AI',
    before: { label: 'Classic', value: 100, color: 'var(--accent-rose)' },
    after: { label: 'CodeLens', value: 2, color: 'var(--accent-emerald)' },
  },
  {
    icon: '🎯',
    value: 0,
    suffix: '%',
    prefix: '~',
    label: 'Hallucination Rate',
    before: { label: 'Classic', value: 35, color: 'var(--accent-rose)' },
    after: { label: 'CodeLens', value: 1, color: 'var(--accent-emerald)' },
  },
  {
    icon: '⚡',
    value: 1,
    suffix: 's',
    prefix: '<',
    label: 'Response Time',
    before: { label: 'Classic', value: 80, color: 'var(--accent-rose)' },
    after: { label: 'CodeLens', value: 8, color: 'var(--accent-emerald)' },
  },
];

const cardVariants = {
  hidden: { opacity: 0, y: 40, scale: 0.95 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.5,
      delay: i * 0.12,
      ease: [0.16, 1, 0.3, 1],
    },
  }),
};

export default function Metrics() {
  const [ref, isVisible] = useScrollReveal({ threshold: 0.1 });

  return (
    <section className="metrics" id="metrics">
      <div className="metrics-inner" ref={ref}>
        <motion.div
          className="metrics-header"
          initial={{ opacity: 0, y: 30 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="section-label" style={{ margin: '0 auto var(--space-6)' }}>✦ Impact</div>
          <h2 className="section-title">The Numbers Don't Lie</h2>
          <p className="section-subtitle" style={{ margin: '0 auto' }}>
            Real performance gains when you stop dumping entire codebases into AI.
          </p>
        </motion.div>

        <div className="metrics-grid">
          {metrics.map((metric, i) => (
            <motion.div
              key={metric.label}
              className="metric-card"
              variants={cardVariants}
              custom={i}
              initial="hidden"
              animate={isVisible ? 'visible' : 'hidden'}
            >
              <div className="metric-icon">{metric.icon}</div>
              <div className="metric-value">
                <AnimatedCounter
                  target={metric.value}
                  suffix={metric.suffix}
                  prefix={metric.prefix || ''}
                />
              </div>
              <div className="metric-label">{metric.label}</div>

              <div className="metric-comparison">
                <div className="comparison-bar">
                  <span className="comparison-bar-label">{metric.before.label}</span>
                  <div className="comparison-bar-track">
                    <div
                      className="comparison-bar-fill before"
                      style={{
                        width: isVisible ? `${metric.before.value}%` : '0%',
                        transition: `width 1.2s cubic-bezier(0.16, 1, 0.3, 1) ${i * 0.15 + 0.5}s`,
                      }}
                    />
                  </div>
                </div>
                <div className="comparison-bar">
                  <span className="comparison-bar-label">{metric.after.label}</span>
                  <div className="comparison-bar-track">
                    <div
                      className="comparison-bar-fill after"
                      style={{
                        width: isVisible ? `${metric.after.value}%` : '0%',
                        transition: `width 1.2s cubic-bezier(0.16, 1, 0.3, 1) ${i * 0.15 + 0.7}s`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
