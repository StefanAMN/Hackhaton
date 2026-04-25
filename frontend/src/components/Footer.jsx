export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="footer" id="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <div className="footer-brand-logo">
            <span style={{ color: 'var(--accent-cyan)' }}>◉</span>
            CodeLens
          </div>
          <p className="footer-brand-desc">
            Stop burning API credits on legacy code. CodeLens maps your codebase 
            and sends AI only the 20 lines that matter.
          </p>
        </div>

        <div className="footer-column">
          <h4 className="footer-column-title">Product</h4>
          <a href="#how-it-works" className="footer-link">How It Works</a>
          <a href="#workspace" className="footer-link">Workspace</a>
          <a href="#metrics" className="footer-link">Impact</a>
          <a href="#" className="footer-link" id="footer-pricing-link">Pricing</a>
        </div>

        <div className="footer-column">
          <h4 className="footer-column-title">Developers</h4>
          <a href="#" className="footer-link" id="footer-docs-link">Documentation</a>
          <a href="#" className="footer-link" id="footer-api-link">API Reference</a>
          <a href="#" className="footer-link" id="footer-github-link">GitHub</a>
          <a href="#" className="footer-link" id="footer-changelog-link">Changelog</a>
        </div>

        <div className="footer-column">
          <h4 className="footer-column-title">Company</h4>
          <a href="#" className="footer-link" id="footer-about-link">About</a>
          <a href="#" className="footer-link" id="footer-blog-link">Blog</a>
          <a href="#" className="footer-link" id="footer-careers-link">Careers</a>
          <a href="#" className="footer-link" id="footer-contact-link">Contact</a>
        </div>
      </div>

      <div className="footer-bottom">
        <span>© {year} CodeLens. Built for developers who inherit chaos.</span>
        <div className="footer-socials">
          <a href="#" className="footer-social-link" id="social-github" aria-label="GitHub">
            ⌘
          </a>
          <a href="#" className="footer-social-link" id="social-twitter" aria-label="Twitter">
            𝕏
          </a>
          <a href="#" className="footer-social-link" id="social-discord" aria-label="Discord">
            💬
          </a>
        </div>
      </div>
    </footer>
  );
}
