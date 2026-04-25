import { motion } from 'framer-motion';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import HowItWorks from './components/HowItWorks';
import CodeUpload from './components/CodeUpload';
import GraphView from './components/GraphView';
import AskAI from './components/AskAI';
import Metrics from './components/Metrics';
import Footer from './components/Footer';
import Particles from './components/Particles';
import useScrollReveal from './hooks/useScrollReveal';

function Workspace() {
  const [ref, isVisible] = useScrollReveal({ threshold: 0.05 });

  return (
    <section className="workspace" id="workspace">
      <div className="workspace-inner" ref={ref}>
        <motion.div
          className="workspace-header"
          initial={{ opacity: 0, y: 30 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="section-label" style={{ margin: '0 auto var(--space-6)' }}>✦ Your Workspace</div>
          <h2 className="section-title">Everything in One View</h2>
          <p className="section-subtitle" style={{ margin: '0 auto' }}>
            Upload code, explore the dependency graph, and ask AI — all in a single, seamless workspace.
          </p>
        </motion.div>

        <motion.div
          className="workspace-panels"
          initial={{ opacity: 0, y: 40 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <CodeUpload />
          <GraphView />
          <AskAI />
        </motion.div>
      </div>
    </section>
  );
}

function CTASection() {
  const [ref, isVisible] = useScrollReveal({ threshold: 0.2 });

  return (
    <section className="cta-section" id="cta">
      <div className="cta-inner" ref={ref}>
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <h2 className="cta-title font-display">
            Ready to Stop <span style={{ color: 'var(--accent-cyan)' }}>Reading the Whole Book?</span>
          </h2>
          <p className="cta-description">
            Join developers who are already saving 90% on API costs and getting 
            instant, accurate answers from their code inspection workflows.
          </p>
          <div className="cta-buttons">
            <button className="btn btn-primary btn-lg" id="cta-get-started">
              Get Started — It's Free
            </button>
            <button className="btn btn-ghost btn-lg" id="cta-book-demo">
              Book a Demo
            </button>
          </div>
          <p className="cta-note">No credit card required · Free tier available · Setup in 2 minutes</p>
        </motion.div>
      </div>
    </section>
  );
}

export default function App() {
  return (
    <>
      <Particles />
      <Navbar />
      <main>
        <Hero />
        <hr className="section-divider" />
        <HowItWorks />
        <hr className="section-divider" />
        <Workspace />
        <hr className="section-divider" />
        <Metrics />
        <hr className="section-divider" />
        <CTASection />
      </main>
      <Footer />
    </>
  );
}
