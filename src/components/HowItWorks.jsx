import { motion } from 'framer-motion';
import useScrollReveal from '../hooks/useScrollReveal';

const steps = [
  {
    num: '01',
    className: 'step-scan',
    icon: '🔍',
    title: 'Scan — Build the Map',
    description: 'Upload your legacy codebase. Our scanner parses the structure — functions, classes, variables, imports — and builds a dependency graph. No AI needed, zero cost.',
    costLabel: 'Cost: $0.00',
    visual: (
      <>
        <div style={{ color: 'var(--accent-cyan)', marginBottom: '4px' }}>$ codelens scan ./src</div>
        <div style={{ color: 'var(--text-dim)' }}>Parsing 847 files...</div>
        <div style={{ color: 'var(--text-dim)' }}>Found 2,341 functions</div>
        <div style={{ color: 'var(--text-dim)' }}>Found 567 classes</div>
        <div style={{ color: 'var(--accent-emerald)' }}>✓ Graph built — 4,208 nodes, 12,847 edges</div>
      </>
    ),
  },
  {
    num: '02',
    className: 'step-filter',
    icon: '🎯',
    title: 'Filter — Find the Route',
    description: 'Ask a question about any function or module. CodeLens traces the dependency graph and extracts only the relevant connected code — typically just 20 lines out of thousands.',
    costLabel: 'Cost: $0.00',
    visual: (
      <>
        <div style={{ color: 'var(--accent-amber)', marginBottom: '4px' }}>? "What happens if I modify apply_tax?"</div>
        <div style={{ color: 'var(--text-dim)' }}>Tracing dependencies...</div>
        <div style={{ color: 'var(--text-dim)' }}>→ calculate_total() calls apply_tax()</div>
        <div style={{ color: 'var(--text-dim)' }}>→ apply_tax() uses TAX_RATE constant</div>
        <div style={{ color: 'var(--accent-emerald)' }}>✓ Extracted 18 lines (from 10,000)</div>
      </>
    ),
  },
  {
    num: '03',
    className: 'step-answer',
    icon: '🤖',
    title: 'Answer — Ask the Expert',
    description: 'Only now does AI enter the scene. It receives just the filtered context — precise, small, relevant. The response is instant, accurate, and costs a fraction of traditional approaches.',
    costLabel: '~$0.002 per query',
    visual: (
      <>
        <div style={{ color: 'var(--accent-purple)', marginBottom: '4px' }}>AI analyzing 18 lines...</div>
        <div style={{ color: 'var(--text-secondary)', lineHeight: '1.6' }}>
          "Modifying apply_tax() will affect calculate_total() which is called by checkout_handler(). The tax rate is currently hardcoded at 19%..."
        </div>
      </>
    ),
  },
];

const cardVariants = {
  hidden: { opacity: 0, y: 50 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      delay: i * 0.2,
      ease: [0.16, 1, 0.3, 1],
    },
  }),
};

export default function HowItWorks() {
  const [ref, isVisible] = useScrollReveal({ threshold: 0.1 });

  return (
    <section className="how-it-works" id="how-it-works">
      <div className="how-it-works-inner" ref={ref}>
        <motion.div
          className="how-it-works-header"
          initial={{ opacity: 0, y: 30 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="section-label">✦ The Process</div>
          <h2 className="section-title">Three Steps. That's It.</h2>
          <p className="section-subtitle" style={{ margin: '0 auto' }}>
            From 10,000 lines of incomprehensible legacy code to a precise, 
            20-line AI-powered answer — in seconds.
          </p>
        </motion.div>

        <div className="steps-container">
          <div className="steps-beam" />

          {steps.map((step, i) => (
            <motion.div
              key={step.num}
              className={`step-card ${step.className}`}
              variants={cardVariants}
              custom={i}
              initial="hidden"
              animate={isVisible ? 'visible' : 'hidden'}
            >
              <div className="step-number">{step.num}</div>
              <div className={`step-icon`}>{step.icon}</div>
              <h3 className="step-title">{step.title}</h3>
              <p className="step-description">{step.description}</p>
              <div className="step-cost-badge">{step.costLabel}</div>
              <div className="step-visual">{step.visual}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
