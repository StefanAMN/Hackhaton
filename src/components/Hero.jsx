import { motion } from 'framer-motion';

const codeLines = [
  { num: 1, tokens: [{ type: 'keyword', text: 'def ' }, { type: 'function', text: 'calculate_total' }, { type: 'plain', text: '(cart):' }] },
  { num: 2, tokens: [{ type: 'plain', text: '    total = ' }, { type: 'variable', text: 'get_subtotal' }, { type: 'plain', text: '(cart)' }] },
  { num: 3, tokens: [{ type: 'plain', text: '    tax = ' }, { type: 'variable', text: 'apply_tax' }, { type: 'plain', text: '(total)' }] },
  { num: 4, tokens: [{ type: 'plain', text: '    discount = ' }, { type: 'variable', text: 'check_promo' }, { type: 'plain', text: '(cart)' }] },
  { num: 5, tokens: [{ type: 'keyword', text: '    return ' }, { type: 'plain', text: 'total + tax - discount' }] },
  { num: 6, tokens: [] },
  { num: 7, tokens: [{ type: 'keyword', text: 'def ' }, { type: 'function', text: 'get_subtotal' }, { type: 'plain', text: '(cart):' }] },
  { num: 8, tokens: [{ type: 'comment', text: '    # Legacy: do not modify' }] },
  { num: 9, tokens: [{ type: 'keyword', text: '    return ' }, { type: 'function', text: 'sum' }, { type: 'plain', text: '(i.' }, { type: 'variable', text: 'price' }, { type: 'keyword', text: ' for ' }, { type: 'plain', text: 'i' }, { type: 'keyword', text: ' in ' }, { type: 'plain', text: 'cart)' }] },
  { num: 10, tokens: [] },
  { num: 11, tokens: [{ type: 'keyword', text: 'def ' }, { type: 'function', text: 'apply_tax' }, { type: 'plain', text: '(amount):' }] },
  { num: 12, tokens: [{ type: 'keyword', text: '    return ' }, { type: 'plain', text: 'amount * ' }, { type: 'string', text: '0.19' }] },
];

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08, delayChildren: 0.6 },
  },
};

const wordVariants = {
  hidden: { opacity: 0, y: 30, filter: 'blur(8px)' },
  visible: { 
    opacity: 1, y: 0, filter: 'blur(0px)',
    transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (delay = 0) => ({
    opacity: 1, y: 0,
    transition: { duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] },
  }),
};

export default function Hero() {
  return (
    <section className="hero" id="hero">
      <div className="hero-bg-gradient" />

      <div className="hero-content">
        {/* Left — Text */}
        <div className="hero-text">
          <motion.div
            className="hero-badge"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <span className="pulse-dot" />
            AI-Powered Code Archaeology
          </motion.div>

          <motion.h1
            className="hero-title"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            <span className="line">
              <motion.span variants={wordVariants} style={{ display: 'inline-block', marginRight: '0.3em' }}>5,000</motion.span>
              <motion.span variants={wordVariants} style={{ display: 'inline-block', marginRight: '0.3em' }}>Pages.</motion.span>
            </span>
            <span className="line">
              <motion.span variants={wordVariants} className="gradient-text" style={{ display: 'inline-block', marginRight: '0.3em' }}>Zero</motion.span>
              <motion.span variants={wordVariants} className="gradient-text" style={{ display: 'inline-block' }}>Confusion.</motion.span>
            </span>
          </motion.h1>

          <motion.p
            className="hero-description"
            variants={fadeUp}
            custom={0.8}
            initial="hidden"
            animate="visible"
          >
            Stop burning API credits on legacy code. CodeLens maps your codebase 
            and gives AI only the lines that matter — saving 90% on costs with zero hallucinations.
          </motion.p>

          <motion.div
            className="hero-ctas"
            variants={fadeUp}
            custom={1.0}
            initial="hidden"
            animate="visible"
          >
            <a href="#workspace" className="btn btn-primary btn-lg" id="hero-cta-demo">
              Try Workspace ↓
            </a>
            <a href="#how-it-works" className="btn btn-ghost btn-lg" id="hero-cta-learn">
              How It Works
            </a>
          </motion.div>

          <motion.div
            className="hero-stats"
            variants={fadeUp}
            custom={1.3}
            initial="hidden"
            animate="visible"
          >
            <div className="hero-stat">
              <div className="hero-stat-value">90%</div>
              <div className="hero-stat-label">Cost Reduction</div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-value">&lt;1s</div>
              <div className="hero-stat-label">Response Time</div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-value">~0%</div>
              <div className="hero-stat-label">Hallucination Rate</div>
            </div>
          </motion.div>
        </div>

        {/* Right — Code Visual */}
        <motion.div
          className="hero-visual"
          initial={{ opacity: 0, x: 60 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="code-window">
            <div className="code-window-header">
              <div className="code-window-dot" />
              <div className="code-window-dot" />
              <div className="code-window-dot" />
              <span className="code-window-title">legacy_checkout.py</span>
            </div>
            <div className="code-window-body">
              {codeLines.map((line) => (
                <div className="code-line" key={line.num}>
                  <span className="code-line-number">{line.num}</span>
                  <span>
                    {line.tokens.map((token, i) => (
                      <span key={i} className={`code-${token.type}`}>{token.text}</span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Floating graph nodes */}
          <div className="floating-node">🔗</div>
          <div className="floating-node">📊</div>
          <div className="floating-node">⚡</div>
        </motion.div>
      </div>
    </section>
  );
}
